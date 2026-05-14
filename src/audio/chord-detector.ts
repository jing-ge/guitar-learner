/**
 * 和弦检测引擎（纯本地）
 * 原理：FFT 提取频谱 → 找出多个峰值频率 → 映射到 pitch class 集合 → 与和弦库匹配
 * 扫弦时多根弦同时振动，频谱中会出现多个能量峰值
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
}

type ChordCallback = (result: ChordDetectResult | null) => void;

/** 频率 → pitch class (0-11) */
function freqToPc(freq: number): number {
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return ((midi % 12) + 12) % 12;
}

/** 计算和弦的 pitch class 集合 */
function chordPitchClasses(chord: ChordDef): number[] {
  // 简化：从和弦名推导组成音
  // 更准确的方式是从和弦的 frets 数据计算
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

/** 两个 pitch class 集合的匹配度 (Jaccard 系数的变体) */
function matchScore(detected: Set<number>, chordPcs: number[]): number {
  if (detected.size === 0 || chordPcs.length === 0) return 0;
  let hits = 0;
  for (const pc of chordPcs) {
    if (detected.has(pc)) hits++;
  }
  // 命中率：和弦中有多少音被检测到
  const recall = hits / chordPcs.length;
  // 精度：检测到的音中有多少属于和弦
  const precision = hits / detected.size;
  // F1-score
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
  private callback: ChordCallback = () => {};
  private freqBinCount = 0;
  private freqData: any = null;

  async start(cb: ChordCallback): Promise<void> {
    this.callback = cb;
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
      this.analyser.fftSize = 8192; // 高分辨率 FFT
      this.analyser.smoothingTimeConstant = 0.3; // 轻微平滑

      this.source.connect(this.analyser);
      this.freqBinCount = this.analyser.frequencyBinCount;
      this.freqData = new Float32Array(this.freqBinCount);

      this.running = true;
      this.loop();
    } catch (err) {
      console.warn('麦克风不可用', err);
      this.callback(null);
    }
  }

  stop() {
    this.running = false;
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.source) { try { this.source.disconnect(); } catch {} this.source = null; }
    if (this.analyser) { try { this.analyser.disconnect(); } catch {} this.analyser = null; }
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} this.audioCtx = null; }
  }

  private loop = () => {
    if (!this.running || !this.analyser || !this.audioCtx) return;

    this.analyser.getFloatFrequencyData(this.freqData);

    // 计算 RMS（从频域数据判断是否有信号）
    let maxDb = -Infinity;
    for (let i = 0; i < this.freqBinCount; i++) {
      if (this.freqData[i] > maxDb) maxDb = this.freqData[i];
    }

    // 信号太弱，跳过
    if (maxDb < -50) {
      this.callback(null);
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    // 提取频谱峰值
    const sampleRate = this.audioCtx.sampleRate;
    const binSize = sampleRate / (this.analyser.fftSize);
    const threshold = maxDb - 25; // 峰值能量需在最大值 25dB 内

    // 吉他频率范围：~80Hz (E2) ~ 1200Hz (高把位高音)
    const minBin = Math.floor(70 / binSize);
    const maxBin = Math.min(this.freqBinCount - 1, Math.ceil(1400 / binSize));

    // 找局部极大值（峰值）
    const peaks: { freq: number; db: number }[] = [];
    for (let i = minBin + 1; i < maxBin - 1; i++) {
      const db = this.freqData[i];
      if (db > threshold &&
          db > this.freqData[i - 1] &&
          db > this.freqData[i + 1]) {
        // 抛物线插值精确化频率
        const alpha = this.freqData[i - 1];
        const beta = this.freqData[i];
        const gamma = this.freqData[i + 1];
        const p = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma || 1);
        const freq = (i + p) * binSize;
        if (freq >= 70 && freq <= 1400) {
          peaks.push({ freq, db });
        }
      }
    }

    if (peaks.length < 2) {
      this.callback(null);
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    // 按能量排序取前 12 个最强的峰（去除泛音重复的 pitch class）
    peaks.sort((a, b) => b.db - a.db);
    const topPeaks = peaks.slice(0, 12);

    // 映射到 pitch class 集合（去重）
    const pcSet = new Set<number>();
    for (const p of topPeaks) {
      pcSet.add(freqToPc(p.freq));
    }
    const detectedPcs = [...pcSet];
    const noteNames = detectedPcs.map(pc => SHARP_NAMES[pc]);

    // 与和弦库匹配
    let bestChord: ChordDef | null = null;
    let bestScore = 0;
    for (const chord of CHORDS) {
      const cPcs = chordPitchClasses(chord);
      const score = matchScore(pcSet, cPcs);
      if (score > bestScore) {
        bestScore = score;
        bestChord = chord;
      }
    }

    // 置信度阈值：低于 0.5 认为不可靠
    if (bestScore < 0.45) {
      bestChord = null;
    }

    this.callback({
      detectedPcs,
      chord: bestChord,
      confidence: bestScore,
      noteNames,
    });

    this.rafId = requestAnimationFrame(this.loop);
  };

  get isRunning() { return this.running; }
}

export const chordDetector = new ChordDetector();