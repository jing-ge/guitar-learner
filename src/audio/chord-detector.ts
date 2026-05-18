/**
 * 和弦检测引擎（纯本地）
 * 原理：FFT 提取频谱 → 找出多个峰值频率 → 映射到 pitch class 集合 → 与和弦库匹配
 * 扫弦时多根弦同时振动，频谱中会出现多个能量峰值
 *
 * Round 5: 在输出层加入"节奏感稳定层"——滑动窗口投票 + 状态机
 * (idle → candidate → confirmed → committed)，加 hysteresis 和速率限制，
 * 避免每帧抖动出几十个和弦。
 */

import { SHARP_NAMES } from '../theory/notes';
import { CHORDS, type ChordDef } from '../theory/chords';

export interface ChordDetectResult {
  /** 检测到的 pitch class 集合 */
  detectedPcs: number[];
  /** 最佳匹配的和弦（null = 无法识别） */
  chord: ChordDef | null;
  /** 匹配得分 0-1（1=完美匹配） */
  confidence: number;
  /** 检测到的音名列表 */
  noteNames: string[];
  /** 当前帧检测到的频谱峰值数（用于权重计算） */
  peakCount: number;
  /** 12 维归一化 chroma 向量（Round 10：供 KeyDetector 等下游消费） */
  chroma: number[];
  /** Round 39: 低频段 (<220Hz) 归一化 bass chroma，供 KeyDetector 用低音域定调（更接近和弦根音线） */
  bassChroma?: number[];
  /** Round 16: 估计的调音偏移 (cents)，正值=偏高，约束在 ±50 之间 */
  tuningOffsetCents?: number;
  /** Round 17: 自适应噪声地板 (dB)，p10 估计，clamped 到 NOISE_FLOOR_MIN_DB */
  noiseFloorDb?: number;
  /** Round 17: 当前帧是否处于 onset 窗口内（最近一次能量跳变 ~150ms 内） */
  isOnset?: boolean;
  /** Round 19: top-K 候选和弦（按 adjusted 排序，confidence 仍为原始 sim） */
  candidates?: { chord: ChordDef; confidence: number }[];
}

export type DetectorProfile = 'practice' | 'live';
export type DetectorSensitivity = 'strict' | 'normal' | 'loose';
export type DetectorState = 'idle' | 'candidate' | 'confirmed' | 'committed';

export interface ChordDetectEvent {
  /** 每帧的原始检测结果（用于实时显示候选 / KeyDetector 喂数据），可能为 null（静音） */
  raw: ChordDetectResult | null;
  /** 状态机状态 */
  state: DetectorState;
  /** confirmed/committed 状态下的当前和弦 + 累计保持毫秒数 + 平均置信度 */
  active: { chord: ChordDef; confidence: number; heldMs: number } | null;
  /** 刚 commit 的和弦（一次性事件，下一帧重置 null）—— 用来 push 历史 */
  justCommitted: { chord: ChordDef; confidence: number; durationMs: number } | null;
  /** profile */
  profile: DetectorProfile;
  /** 当前进度（0-1），用于稳定度进度条：candidate 阶段相对于 minConfirm，confirmed 阶段相对于 minCommit */
  progress: number;
}

// ---- Stability constants ----
const SMOOTHING_WINDOW = 5;             // 帧平滑窗口
const MIN_CONFIRM_FRAMES = 12;          // ~200ms 进入 confirmed
const EXIT_HOLD_FRAMES = 6;             // 跌破 exit ≥ 6 帧才允许切换
const EXIT_THRESHOLD = 0.45;            // hysteresis 离开门槛
const SILENCE_FRAMES = 8;

// sensitivity 矩阵
const SENSITIVITY: Record<DetectorSensitivity, { enter: number; minCommitPractice: number; minCommitLive: number }> = {
  // Round 41: live profile minCommit 大幅下调（族折叠 + 真实曲目 1-2s/chord，原 36-44 帧 commit 永远不触发）
  strict: { enter: 0.70, minCommitPractice: 28, minCommitLive: 24 },
  normal: { enter: 0.62, minCommitPractice: 20, minCommitLive: 18 },
  loose:  { enter: 0.55, minCommitPractice: 14, minCommitLive: 12 },
};

const MAX_CHORDS_PER_SECOND_PRACTICE = 3;
const MAX_CHORDS_PER_SECOND_LIVE = 3;  // Round 39: 2 → 3 — 让 120BPM 一拍一和弦不被吞

// Round 41: 同根 + 同三度质量视为一族（F#m / F#m7 / F#sus2 都进 "F#-minor" 族）
//   投票按族计数，避免 variant 反复横跳导致状态机重置 → commit 几乎不触发
function familyKey(chord: ChordDef): string {
  // 解析 root pc：用 chord.id 首字母 + 可选 #/b
  let token = chord.id[0] ?? 'C';
  if (chord.id[1] === '#' || chord.id[1] === 'b') token = chord.id.slice(0, 2);
  // 简化 quality：minor/min7 → 'm'；dim → 'd'；其他视为 'M'（major/maj7/dom7/sus/aug）
  const q = chord.quality;
  let qFam: 'M' | 'm' | 'd';
  if (q === 'minor' || q === 'min7') qFam = 'm';
  else if (q === 'dim') qFam = 'd';
  else qFam = 'M';
  return `${token}-${qFam}`;
}

/** 频率 → pitch class (0-11) */
function freqToPc(freq: number): number {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return ((midi % 12) + 12) % 12;
}

/** 计算和弦的 pitch class 集合 */
function chordPitchClasses(chord: ChordDef): number[] {
  const shape = chord.shapes[0];
  const tuning = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4
  const pcs = new Set<number>();
  for (let i = 0; i < 6; i++) {
    const fret = shape.frets[i];
    if (fret < 0) continue;
    const midi = tuning[i] + fret;
    pcs.add(((midi % 12) + 12) % 12);
  }
  return [...pcs];
}

/** 两个 pitch class 集合的匹配度 (F1 score) */
function matchScore(detected: Set<number>, chordPcs: number[]): number {
  if (detected.size === 0 || chordPcs.length === 0) return 0;
  let hits = 0;
  for (const pc of chordPcs) if (detected.has(pc)) hits++;
  const recall = hits / chordPcs.length;
  const precision = hits / detected.size;
  if (recall + precision === 0) return 0;
  return 2 * recall * precision / (recall + precision);
}

// ---- Round 10/11: chroma + 程序化模板匹配 ----

const CHROMA_MIN_FREQ = 70;
const CHROMA_MAX_FREQ = 2000;
const CHROMA_BASS_FREQ = 220;          // Round 12: 低频段截止，用于 bass chroma
const CHROMA_MATCH_THRESHOLD = 0.5;
const CHROMA_TOP_K = 4;
const CHROMA_TOP_RATIO = 0.4;
const CHROMA_EMA_ALPHA = 0.4;          // Round 12: EMA 平滑系数
const BASS_BIAS = 0.5;                 // Round 12: 模板根音 bass 偏置

// ---- Round 16: Tuning offset estimation ----
const TUNING_EMA_ALPHA = 0.05;
const TUNING_COLD_START_FRAMES = 30;
const TUNING_MIN_PEAKS = 3;
const TUNING_CLAMP = 50;

// ---- Round 17: Adaptive noise floor & onset detection ----
const ENERGY_HISTORY_LEN = 60;
const NOISE_FLOOR_OFFSET_DB = 6;
const NOISE_FLOOR_MIN_DB = -70;
const NOISE_FLOOR_COLD_DB = -60;
const NOISE_FLOOR_COLD_FRAMES = 60;
const ONSET_STEP_DB = 8;
const ONSET_WINDOW_MS = 150;

// ---- Round 18: Key prior boost ----
const KEY_PRIOR_BOOST = 0.10;

// ---- Round 19: Top-K candidates ----
const CANDIDATE_MIN_THRESHOLD = 0.40;
const CANDIDATE_TOP_K = 3;

type TemplateQuality = 'maj' | 'min' | '7' | 'maj7' | 'm7' | 'sus2' | 'sus4' | 'dim' | 'aug' | 'm7b5' | '6' | '9' | 'add9';

// diatonic 集合（每个调的 7 个顺阶和弦：[pc 偏移 from key root, quality]）
const DIATONIC_MAJOR: Array<[number, TemplateQuality]> = [
  [0, 'maj'], [2, 'min'], [4, 'min'], [5, 'maj'], [7, 'maj'], [9, 'min'], [11, 'dim'],
];
const DIATONIC_MINOR: Array<[number, TemplateQuality]> = [
  [0, 'min'], [2, 'dim'], [3, 'maj'], [5, 'min'], [7, 'min'], [8, 'maj'], [10, 'maj'],
];

const QUALITY_INTERVALS: Record<TemplateQuality, Array<[number, number]>> = {
  // [interval_semitones, weight]
  maj:   [[0, 1.0], [4, 1.0], [7, 0.5]],
  min:   [[0, 1.0], [3, 1.0], [7, 0.5]],
  '7':   [[0, 1.0], [4, 1.0], [7, 0.5], [10, 0.6]],
  maj7:  [[0, 1.0], [4, 1.0], [7, 0.5], [11, 0.6]],
  m7:    [[0, 1.0], [3, 1.0], [7, 0.5], [10, 0.6]],
  sus2:  [[0, 1.0], [2, 0.9], [7, 0.5]],
  sus4:  [[0, 1.0], [5, 0.9], [7, 0.5]],
  dim:   [[0, 1.0], [3, 1.0], [6, 0.7]],
  aug:   [[0, 1.0], [4, 1.0], [8, 0.7]],
  // Round 21: 4 个新 quality（14 度在 buildVec 里 mod 12）
  m7b5:  [[0, 1.0], [3, 1.0], [6, 0.7], [10, 0.6]],
  '6':   [[0, 1.0], [4, 1.0], [7, 0.5], [9, 0.6]],
  '9':   [[0, 1.0], [4, 1.0], [7, 0.5], [10, 0.6], [14, 0.5]],
  add9:  [[0, 1.0], [4, 1.0], [7, 0.5], [14, 0.5]],
};

const QUALITY_TO_CHORD_DEF_QUALITY: Record<TemplateQuality, ChordDef['quality']> = {
  maj: 'major', min: 'minor', '7': 'dom7', maj7: 'maj7', m7: 'min7',
  sus2: 'sus', sus4: 'sus', dim: 'dim', aug: 'aug',
  // Round 21: 最近邻映射到现有 quality 类型
  m7b5: 'min7', '6': 'major', '9': 'dom7', add9: 'major',
};

function nameFor(rootPc: number, q: TemplateQuality): string {
  const root = SHARP_NAMES[rootPc];
  switch (q) {
    case 'maj':  return root;
    case 'min':  return root + 'm';
    case '7':    return root + '7';
    case 'maj7': return root + 'maj7';
    case 'm7':   return root + 'm7';
    case 'sus2': return root + 'sus2';
    case 'sus4': return root + 'sus4';
    case 'dim':  return root + 'dim';
    case 'aug':  return root + 'aug';
    case 'm7b5': return root + 'm7b5';
    case '6':    return root + '6';
    case '9':    return root + '9';
    case 'add9': return root + 'add9';
  }
}

interface TemplateEntry {
  rootPc: number;
  quality: TemplateQuality;
  name: string;
  vec: number[];
  norm: number;
}

const CHORD_TEMPLATES_V2: TemplateEntry[] = (() => {
  const qualities: TemplateQuality[] = ['maj', 'min', '7', 'maj7', 'm7', 'sus2', 'sus4', 'dim', 'aug', 'm7b5', '6', '9', 'add9'];
  const out: TemplateEntry[] = [];
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    for (const q of qualities) {
      const vec = new Array<number>(12).fill(0);
      for (const [semi, w] of QUALITY_INTERVALS[q]) {
        vec[(rootPc + semi) % 12] = Math.max(vec[(rootPc + semi) % 12], w);
      }
      let sq = 0;
      for (const v of vec) sq += v * v;
      out.push({ rootPc, quality: q, name: nameFor(rootPc, q), vec, norm: Math.sqrt(sq) || 1 });
    }
  }
  return out;
})();

// name → ChordDef 缓存（优先复用 CHORDS 表中的真实条目）
const CHORDS_BY_NAME: Map<string, ChordDef> = (() => {
  const m = new Map<string, ChordDef>();
  for (const c of CHORDS) m.set(c.name, c);
  return m;
})();

const VIRTUAL_CHORD_CACHE: Map<string, ChordDef> = new Map();

function resolveChordDef(entry: TemplateEntry): ChordDef {
  const real = CHORDS_BY_NAME.get(entry.name);
  if (real) return real;
  const cached = VIRTUAL_CHORD_CACHE.get(entry.name);
  if (cached) return cached;
  const virt: ChordDef = {
    id: entry.name,
    name: entry.name,
    fullName: entry.name,
    quality: QUALITY_TO_CHORD_DEF_QUALITY[entry.quality],
    category: '开放和弦',
    shapes: [{ frets: [-1, -1, -1, -1, -1, -1] }],
    difficulty: 3,
  };
  VIRTUAL_CHORD_CACHE.set(entry.name, virt);
  return virt;
}

export class ChordDetector {
  private audioCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId = 0;
  private running = false;
  private eventCallback: ((evt: ChordDetectEvent) => void) | null = null;
  private freqBinCount = 0;
  private freqData: any = null;

  // ---- state machine fields ----
  private profile: DetectorProfile = 'practice';
  private sensitivity: DetectorSensitivity = 'normal';
  private window: { name: string; conf: number; t: number; chord: ChordDef }[] = [];
  private state: DetectorState = 'idle';
  private currentChordName: string | null = null;
  private currentChordObj: ChordDef | null = null;
  private stateStartTs: number = 0;
  private confSum: number = 0;
  private confCount: number = 0;
  private exitBelowFrames: number = 0;
  private silenceFrames: number = 0;
  private justCommittedThisFrame: { chord: ChordDef; confidence: number; durationMs: number } | null = null;
  private recentCommitsTs: number[] = [];
  private committedFlashUntil: number = 0;
  // Round 12: chroma EMA 平滑状态
  private smoothedChroma: number[] | null = null;
  // Round 16: tuning offset 估计状态
  private tuningOffsetCents: number = 0;
  private tuningFrameCount: number = 0;
  // Round 17: 自适应噪声地板 & onset 检测状态
  private energyHistory: number[] = [];
  private noiseFloorDb: number = NOISE_FLOOR_COLD_DB;
  private prevMaxDb: number = -Infinity;
  private lastOnsetTs: number = 0;
  // Round 18: 外部传入的调性 hint（由 KeyDetector 反馈），仅用于模板匹配 prior 加成
  private keyHintRoot: number | null = null;
  private keyHintMode: 'major' | 'minor' | null = null;

  public setProfile(p: DetectorProfile): void {
    this.profile = p;
    this.resetState();
  }

  public setSensitivity(s: DetectorSensitivity): void {
    this.sensitivity = s;
    this.resetState();
  }

  public getProfile(): DetectorProfile { return this.profile; }
  public getSensitivity(): DetectorSensitivity { return this.sensitivity; }

  /** Round 18: 由外部（KeyDetector）反馈稳定调性，传 null/null 即清除 hint */
  public setKeyHint(root: number | null, mode: 'major' | 'minor' | null): void {
    this.keyHintRoot = root;
    this.keyHintMode = mode;
  }
  public getKeyHint(): { root: number | null; mode: 'major' | 'minor' | null } {
    return { root: this.keyHintRoot, mode: this.keyHintMode };
  }

  private resetState(): void {
    this.window = [];
    this.state = 'idle';
    this.currentChordName = null;
    this.currentChordObj = null;
    this.stateStartTs = 0;
    this.confSum = 0;
    this.confCount = 0;
    this.exitBelowFrames = 0;
    this.silenceFrames = 0;
    this.recentCommitsTs = [];
    this.smoothedChroma = null;
    this.tuningOffsetCents = 0;
    this.tuningFrameCount = 0;
    this.energyHistory = [];
    this.noiseFloorDb = NOISE_FLOOR_COLD_DB;
    this.prevMaxDb = -Infinity;
    this.lastOnsetTs = 0;
    this.keyHintRoot = null;
    this.keyHintMode = null;
  }

  async start(cb: (event: ChordDetectEvent) => void): Promise<void> {
    this.eventCallback = cb;
    if (this.running) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });

      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      this.audioCtx = new Ctor();
      if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();

      this.source = this.audioCtx.createMediaStreamSource(this.stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 8192;
      this.analyser.smoothingTimeConstant = 0.3;

      this.source.connect(this.analyser);
      this.freqBinCount = this.analyser.frequencyBinCount;
      this.freqData = new Float32Array(this.freqBinCount);

      this.resetState();
      this.running = true;
      this.loop();
    } catch (err) {
      console.warn('麦克风不可用', err);
      this.emitEvent(null, performance.now());
    }
  }

  stop() {
    this.running = false;
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.source) { try { this.source.disconnect(); } catch {} this.source = null; }
    if (this.analyser) { try { this.analyser.disconnect(); } catch {} this.analyser = null; }
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} this.audioCtx = null; }
    this.smoothedChroma = null;
    this.resetState();
  }

  /** ---- per-frame audio analysis (Round 10/11/12: chroma + HPS + EMA + bass-biased 模板余弦) ---- */
  private analyzeFrame(): ChordDetectResult | null {
    if (!this.analyser || !this.audioCtx) return null;
    this.analyser.getFloatFrequencyData(this.freqData);

    let maxDb = -Infinity;
    for (let i = 0; i < this.freqBinCount; i++) {
      if (this.freqData[i] > maxDb) maxDb = this.freqData[i];
    }

    // Round 17: 1) 维护能量历史
    this.energyHistory.push(maxDb);
    if (this.energyHistory.length > ENERGY_HISTORY_LEN) this.energyHistory.shift();

    // 2) 自适应噪声地板（p10 over history，冷启动期用固定值）
    if (this.energyHistory.length >= NOISE_FLOOR_COLD_FRAMES) {
      const sorted = [...this.energyHistory].sort((a, b) => a - b);
      const p10 = sorted[Math.floor(sorted.length * 0.1)];
      this.noiseFloorDb = Math.max(NOISE_FLOOR_MIN_DB, p10);
    } else {
      this.noiseFloorDb = NOISE_FLOOR_COLD_DB;
    }

    // 3) 静音判定（双保险：噪底 + 绝对地板 -50dB）
    //    注意 prevMaxDb 必须在 return null 路径也更新，否则从静音突然来声音时无法触发 onset
    if (maxDb < this.noiseFloorDb + NOISE_FLOOR_OFFSET_DB || maxDb < -50) {
      this.prevMaxDb = maxDb;
      return null;
    }

    // 4) Onset 检测：相邻帧 dB 跳变超过阈值即记录时间戳
    if (maxDb - this.prevMaxDb > ONSET_STEP_DB) {
      this.lastOnsetTs = performance.now();
    }
    this.prevMaxDb = maxDb;

    const sampleRate = this.audioCtx.sampleRate;
    const binSize = sampleRate / this.analyser.fftSize;
    const minBin = Math.max(1, Math.floor(CHROMA_MIN_FREQ / binSize));
    const maxBin = Math.min(this.freqBinCount - 1, Math.ceil(CHROMA_MAX_FREQ / binSize));

    // 步骤 A: 累加 chromaRaw + bassChroma（低频段 < CHROMA_BASS_FREQ 单独累计一份）
    // Round 16: 同时收集 local-max 峰值（用于 tuning offset 估计），并用上一帧的 tuningOffsetCents 修正 pc
    const chromaRaw = new Array<number>(12).fill(0);
    const bassChroma = new Array<number>(12).fill(0);
    const peakCandidates: { freq: number; amp: number }[] = [];
    const tuneShift = this.tuningOffsetCents / 100;
    for (let i = minBin; i <= maxBin; i++) {
      const freq = (i + 0.5) * binSize;
      if (freq < CHROMA_MIN_FREQ || freq > CHROMA_MAX_FREQ) continue;
      const db = Math.max(this.freqData[i], -80);
      const amp = Math.pow(10, db / 20);
      // local max 判定（与左右邻居比 db，更稳定）
      if (i > minBin && i < maxBin && this.freqData[i] > this.freqData[i - 1] && this.freqData[i] > this.freqData[i + 1]) {
        peakCandidates.push({ freq, amp });
      }
      const midi = 12 * Math.log2(freq / 440) + 69 - tuneShift;
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chromaRaw[pc] += amp;
      if (freq < CHROMA_BASS_FREQ) bassChroma[pc] += amp;
    }

    // Round 16: 取 top-6 峰值，过滤 amp < max*0.2 弱峰 → 估计 cents 偏差（EMA + median）
    if (peakCandidates.length > 0) {
      peakCandidates.sort((a, b) => b.amp - a.amp);
      const top = peakCandidates.slice(0, 6);
      const ampThr = top[0].amp * 0.2;
      const topPeakFreqs = top.filter(p => p.amp >= ampThr).map(p => p.freq);

      this.tuningFrameCount++;
      if (this.tuningFrameCount > TUNING_COLD_START_FRAMES && topPeakFreqs.length >= TUNING_MIN_PEAKS) {
        const offsets: number[] = [];
        for (const f of topPeakFreqs.slice(0, 4)) {
          const m = 12 * Math.log2(f / 440) + 69;
          const cents = (m - Math.round(m)) * 100;
          offsets.push(cents);
        }
        offsets.sort((a, b) => a - b);
        const median = offsets.length % 2
          ? offsets[(offsets.length - 1) >> 1]
          : (offsets[offsets.length / 2 - 1] + offsets[offsets.length / 2]) / 2;
        const next = TUNING_EMA_ALPHA * median + (1 - TUNING_EMA_ALPHA) * this.tuningOffsetCents;
        this.tuningOffsetCents = Math.max(-TUNING_CLAMP, Math.min(TUNING_CLAMP, next));
      }
    }

    // 步骤 B: HPS 轻量抑制——减去完全五度 1/3 + 大三度 0.20（Round 11：抑制大三泛音）
    const chroma = chromaRaw.map((v, pc) =>
      Math.max(0, v - (chromaRaw[(pc + 7) % 12] * 0.40 + chromaRaw[(pc + 4) % 12] * 0.25))
    );

    // 步骤 B+: EMA 平滑（Round 12）
    if (!this.smoothedChroma || this.smoothedChroma.length !== 12) {
      this.smoothedChroma = chroma.slice();
    } else {
      for (let i = 0; i < 12; i++) {
        this.smoothedChroma[i] = CHROMA_EMA_ALPHA * chroma[i] + (1 - CHROMA_EMA_ALPHA) * this.smoothedChroma[i];
      }
    }
    const smoothed = this.smoothedChroma;

    // 步骤 C: 归一化 smoothed → chromaFinal
    let maxS = 0;
    for (let i = 0; i < 12; i++) if (smoothed[i] > maxS) maxS = smoothed[i];
    if (maxS < 1e-6) return null;
    const chromaFinal = smoothed.map(v => v / maxS);

    // 归一化 bassChroma（独立归一）
    let bassMax = 0;
    for (let i = 0; i < 12; i++) if (bassChroma[i] > bassMax) bassMax = bassChroma[i];
    const bassNorm = bassMax > 1e-6 ? bassChroma.map(v => v / bassMax) : new Array<number>(12).fill(0);

    // detectedPcs：chromaFinal top-K 且 >= max * ratio
    const indexed = chromaFinal.map((v, pc) => ({ v, pc }))
      .sort((a, b) => b.v - a.v)
      .slice(0, CHROMA_TOP_K)
      .filter(x => x.v >= CHROMA_TOP_RATIO);
    const detectedPcs = indexed.map(x => x.pc);
    const noteNames = detectedPcs.map(pc => SHARP_NAMES[pc]);

    // 步骤 D: 模板余弦匹配 + bass 偏置（Round 12）+ key prior boost（Round 18）
    let chromaSq = 0;
    for (const v of chromaFinal) chromaSq += v * v;
    const chromaNorm = Math.sqrt(chromaSq) || 1;

    // Round 18: 预计算 diatonic 集合
    let diatonicSet: Set<string> | null = null;
    if (this.keyHintRoot !== null && this.keyHintMode !== null) {
      const intervals = this.keyHintMode === 'major' ? DIATONIC_MAJOR : DIATONIC_MINOR;
      diatonicSet = new Set();
      for (const [offset, q] of intervals) {
        const pc = (this.keyHintRoot + offset) % 12;
        diatonicSet.add(`${pc}-${q}`);
      }
    }

    let bestEntry: TemplateEntry | null = null;
    let bestSim = 0;       // 原始余弦相似度，用于阈值判定 + confidence
    let bestAdjusted = 0;  // 含 key prior 的，用于排序
    // Round 19: 收集所有 hits 用于 top-K 候选输出
    const hits: Array<{ tpl: TemplateEntry; sim: number; adjusted: number }> = [];
    for (const tpl of CHORD_TEMPLATES_V2) {
      // 对模板根音那一维做 (1 + BASS_BIAS * bassNorm[rootPc]) 偏置
      const rootBoost = 1 + BASS_BIAS * bassNorm[tpl.rootPc];
      let dot = 0, tplSq = 0;
      for (let i = 0; i < 12; i++) {
        const biased = i === tpl.rootPc ? tpl.vec[i] * rootBoost : tpl.vec[i];
        dot += chromaFinal[i] * biased;
        tplSq += biased * biased;
      }
      const sim = dot / (chromaNorm * (Math.sqrt(tplSq) || 1));
      const adjusted = (diatonicSet && diatonicSet.has(`${tpl.rootPc}-${tpl.quality}`))
        ? sim * (1 + KEY_PRIOR_BOOST)
        : sim;
      hits.push({ tpl, sim, adjusted });
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestSim = sim;
        bestEntry = tpl;
      }
    }
    // 注意：阈值判定 + confidence 都用原始 sim，不让 prior 把弱信号拉过线
    const bestChord: ChordDef | null =
      bestEntry && bestSim >= CHROMA_MATCH_THRESHOLD ? resolveChordDef(bestEntry) : null;

    // Round 19: top-K 候选（按 adjusted 排序，confidence 仍报原始 sim，按 chord.id 去重）
    // 用 continue 而非 break：hits 按 adjusted 降序，但 sim 不严格单调（调内项 prior 抬高后 sim 可能偏低）
    hits.sort((a, b) => b.adjusted - a.adjusted);
    const candidates: { chord: ChordDef; confidence: number }[] = [];
    const seenIds = new Set<string>();
    for (const h of hits) {
      if (candidates.length >= CANDIDATE_TOP_K) break;
      if (h.sim < CANDIDATE_MIN_THRESHOLD) continue;
      const cd = resolveChordDef(h.tpl);
      if (seenIds.has(cd.id)) continue;
      seenIds.add(cd.id);
      candidates.push({ chord: cd, confidence: h.sim });
    }

    const nowTs = performance.now();
    const isOnset = nowTs - this.lastOnsetTs < ONSET_WINDOW_MS;
    return {
      detectedPcs,
      chord: bestChord,
      confidence: bestSim,
      noteNames,
      peakCount: detectedPcs.length,
      chroma: chromaFinal,
      bassChroma: bassNorm,
      tuningOffsetCents: this.tuningOffsetCents,
      noiseFloorDb: this.noiseFloorDb,
      isOnset,
      candidates,
    };
  }

  private loop = () => {
    if (!this.running) return;
    const raw = this.analyzeFrame();
    this.processFrame(raw);
    this.rafId = requestAnimationFrame(this.loop);
  };

  /** ---- 状态机帧处理 ---- */
  private processFrame(rawResult: ChordDetectResult | null): void {
    const now = performance.now();
    this.justCommittedThisFrame = null;

    // 静音处理
    if (!rawResult || rawResult.chord === null) {
      this.silenceFrames++;
      if (this.silenceFrames >= SILENCE_FRAMES && this.state !== 'idle') {
        this.resetState();
      }
      this.emitEvent(rawResult, now);
      return;
    }
    this.silenceFrames = 0;

    const cur = rawResult.chord;

    // 1. 滑动窗口
    this.window.push({ name: cur.id, conf: rawResult.confidence, t: now, chord: cur });
    if (this.window.length > SMOOTHING_WINDOW) this.window.shift();

    // 2. 投票 (Round 41: 改按"族"投票 — 同根 + 同三度质量视为一族)
    //    族 key = `${rootPc}-${isMinor}`，避免 F#m/F#m7/F#sus2 反复横跳导致状态机重置
    //    族胜出后，从族内挑 confidence 最高的具体 chord 做 currentChord
    const counts: Record<string, { count: number; sumConf: number; chord: ChordDef; bestConf: number; bestChord: ChordDef; bestName: string }> = {};
    for (const w of this.window) {
      const family = familyKey(w.chord);
      if (!counts[family]) counts[family] = {
        count: 0, sumConf: 0, chord: w.chord,
        bestConf: w.conf, bestChord: w.chord, bestName: w.name,
      };
      counts[family].count++;
      counts[family].sumConf += w.conf;
      if (w.conf > counts[family].bestConf) {
        counts[family].bestConf = w.conf;
        counts[family].bestChord = w.chord;
        counts[family].bestName = w.name;
      }
    }
    let bestName = '';
    let bestEntry: { count: number; sumConf: number; chord: ChordDef; bestConf: number; bestChord: ChordDef; bestName: string } | null = null;
    for (const k in counts) {
      if (!bestEntry || counts[k].count > bestEntry.count) {
        bestEntry = counts[k];
        bestName = counts[k].bestName;
      }
    }
    if (!bestEntry) {
      this.emitEvent(rawResult, now);
      return;
    }
    const votedConfAvg = bestEntry.sumConf / bestEntry.count;
    const votedChord = bestEntry.bestChord;

    // 3. 参数
    const sens = SENSITIVITY[this.sensitivity];
    const enterThr = sens.enter;
    const minCommitFrames = this.profile === 'live' ? sens.minCommitLive : sens.minCommitPractice;
    const maxRate = this.profile === 'live' ? MAX_CHORDS_PER_SECOND_LIVE : MAX_CHORDS_PER_SECOND_PRACTICE;

    // 4. 状态机
    if (this.state === 'committed' && bestName !== this.currentChordName) {
      // hysteresis: 已确定的和弦只有在原 chord 持续跌破 EXIT 才允许切换
      if (cur.id === this.currentChordName) {
        this.exitBelowFrames = 0;
      } else if (rawResult.confidence < EXIT_THRESHOLD) {
        this.exitBelowFrames++;
      } else {
        this.exitBelowFrames = 0;
      }
      if (this.exitBelowFrames < EXIT_HOLD_FRAMES) {
        this.emitEvent(rawResult, now);
        return;
      }
      // 允许切换 → 进入新候选
      this.enterCandidate(bestName, votedChord, votedConfAvg, now);
    } else if (this.state === 'idle') {
      this.enterCandidate(bestName, votedChord, votedConfAvg, now);
    } else if (bestName === this.currentChordName) {
      // 累积
      this.confSum += votedConfAvg;
      this.confCount++;

      // 同步更新 currentChordObj（拿到更新鲜的 ChordDef 实例）
      if (cur.id === this.currentChordName) this.currentChordObj = cur;

      const heldFrames = this.confCount;
      const avgConf = this.confSum / this.confCount;

      if (this.state === 'candidate' && heldFrames >= MIN_CONFIRM_FRAMES && avgConf >= enterThr) {
        this.state = 'confirmed';
      }
      if (this.state === 'confirmed' && heldFrames >= minCommitFrames && avgConf >= enterThr) {
        // 速率限制
        this.recentCommitsTs = this.recentCommitsTs.filter(t => now - t < 1000);
        if (this.recentCommitsTs.length < maxRate) {
          this.state = 'committed';
          this.recentCommitsTs.push(now);
          const heldMs = now - this.stateStartTs;
          this.justCommittedThisFrame = {
            chord: this.currentChordObj || cur,
            confidence: avgConf,
            durationMs: heldMs,
          };
          this.committedFlashUntil = now + 200;
        }
      }
    } else {
      // 不同 bestName 且不在 committed → 切候选
      this.enterCandidate(bestName, votedChord, votedConfAvg, now);
    }

    this.emitEvent(rawResult, now);
  }

  private enterCandidate(name: string, chord: ChordDef, confAvg: number, now: number): void {
    this.state = 'candidate';
    this.currentChordName = name;
    this.currentChordObj = chord;
    this.stateStartTs = now;
    this.confSum = confAvg;
    this.confCount = 1;
    this.exitBelowFrames = 0;
  }

  private emitEvent(rawResult: ChordDetectResult | null, now: number): void {
    if (!this.eventCallback) return;
    const sens = SENSITIVITY[this.sensitivity];
    const minCommitFrames = this.profile === 'live' ? sens.minCommitLive : sens.minCommitPractice;

    const active = (this.state === 'confirmed' || this.state === 'committed') && this.currentChordObj ? {
      chord: this.currentChordObj,
      confidence: this.confCount > 0 ? this.confSum / this.confCount : 0,
      heldMs: now - this.stateStartTs,
    } : null;

    // 进度：candidate 走 0 → 1（达到 MIN_CONFIRM_FRAMES 即满 1/2），confirmed 走 1/2 → 1
    let progress = 0;
    if (this.state === 'candidate') {
      progress = Math.min(this.confCount / MIN_CONFIRM_FRAMES, 1) * 0.5;
    } else if (this.state === 'confirmed') {
      progress = 0.5 + Math.min((this.confCount - MIN_CONFIRM_FRAMES) / Math.max(1, minCommitFrames - MIN_CONFIRM_FRAMES), 1) * 0.5;
    } else if (this.state === 'committed') {
      progress = 1;
    }

    this.eventCallback({
      raw: rawResult,
      state: this.state,
      active,
      justCommitted: this.justCommittedThisFrame,
      profile: this.profile,
      progress,
    });
  }

  get isRunning() { return this.running; }
}

export const chordDetector = new ChordDetector();
