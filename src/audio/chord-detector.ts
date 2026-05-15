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
  strict: { enter: 0.70, minCommitPractice: 32, minCommitLive: 44 },
  normal: { enter: 0.62, minCommitPractice: 24, minCommitLive: 36 },
  loose:  { enter: 0.55, minCommitPractice: 18, minCommitLive: 28 },
};

const MAX_CHORDS_PER_SECOND_PRACTICE = 3;
const MAX_CHORDS_PER_SECOND_LIVE = 2;

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
    this.resetState();
  }

  /** ---- per-frame audio analysis (unchanged algorithm) ---- */
  private analyzeFrame(): ChordDetectResult | null {
    if (!this.analyser || !this.audioCtx) return null;
    this.analyser.getFloatFrequencyData(this.freqData);

    let maxDb = -Infinity;
    for (let i = 0; i < this.freqBinCount; i++) {
      if (this.freqData[i] > maxDb) maxDb = this.freqData[i];
    }
    if (maxDb < -50) return null;

    const sampleRate = this.audioCtx.sampleRate;
    const binSize = sampleRate / this.analyser.fftSize;
    const threshold = maxDb - 25;
    const minBin = Math.floor(70 / binSize);
    const maxBin = Math.min(this.freqBinCount - 1, Math.ceil(1400 / binSize));

    const peaks: { freq: number; db: number }[] = [];
    for (let i = minBin + 1; i < maxBin - 1; i++) {
      const db = this.freqData[i];
      if (db > threshold && db > this.freqData[i - 1] && db > this.freqData[i + 1]) {
        const alpha = this.freqData[i - 1];
        const beta = this.freqData[i];
        const gamma = this.freqData[i + 1];
        const p = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma || 1);
        const freq = (i + p) * binSize;
        if (freq >= 70 && freq <= 1400) peaks.push({ freq, db });
      }
    }

    if (peaks.length < 2) return null;

    peaks.sort((a, b) => b.db - a.db);
    const topPeaks = peaks.slice(0, 12);
    const pcSet = new Set<number>();
    for (const p of topPeaks) pcSet.add(freqToPc(p.freq));
    const detectedPcs = [...pcSet];
    const noteNames = detectedPcs.map(pc => SHARP_NAMES[pc]);

    let bestChord: ChordDef | null = null;
    let bestScore = 0;
    for (const chord of CHORDS) {
      const cPcs = chordPitchClasses(chord);
      const score = matchScore(pcSet, cPcs);
      if (score > bestScore) { bestScore = score; bestChord = chord; }
    }
    if (bestScore < 0.45) bestChord = null;

    return {
      detectedPcs,
      chord: bestChord,
      confidence: bestScore,
      noteNames,
      peakCount: topPeaks.length,
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

    // 2. 投票
    const counts: Record<string, { count: number; sumConf: number; chord: ChordDef }> = {};
    for (const w of this.window) {
      if (!counts[w.name]) counts[w.name] = { count: 0, sumConf: 0, chord: w.chord };
      counts[w.name].count++;
      counts[w.name].sumConf += w.conf;
    }
    let bestName = '';
    let bestEntry: { count: number; sumConf: number; chord: ChordDef } | null = null;
    for (const k in counts) {
      if (!bestEntry || counts[k].count > bestEntry.count) {
        bestEntry = counts[k];
        bestName = k;
      }
    }
    if (!bestEntry) {
      this.emitEvent(rawResult, now);
      return;
    }
    const votedConfAvg = bestEntry.sumConf / bestEntry.count;
    const votedChord = bestEntry.chord;

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
