/**
 * 麦克风实时音高检测引擎
 * 基于 YIN 自相关算法（纯本地，零依赖，不联网）
 * 适用于吉他等单音弦乐器的音高识别
 */

import { SHARP_NAMES } from '../theory/notes';

export interface PitchResult {
  /** 检测到的频率 (Hz)，-1 表示无信号/无法检测 */
  freq: number;
  /** 最接近的 MIDI 音高编号 */
  midi: number;
  /** 音名如 "A4" */
  noteName: string;
  /** 音名不含八度如 "A" */
  noteOnly: string;
  /** pitch class 0-11 */
  pc: number;
  /** 距离最近音的偏差（cent，-50~+50，0=完全准） */
  cents: number;
  /** 信号强度 (RMS)，越大声越高 */
  rms: number;
}

type PitchCallback = (result: PitchResult | null) => void;

/** 频率 → 最近 MIDI + 偏差 cents */
function freqToMidiCents(freq: number): { midi: number; cents: number } {
  const midiExact = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(midiExact);
  const cents = Math.round((midiExact - midi) * 100);
  return { midi, cents };
}

/**
 * YIN 算法核心 — 从时域信号检测基频
 * 参考：De Cheveigné & Kawahara (2002) "YIN, a fundamental frequency estimator"
 * threshold 越小越严格（推荐 0.10~0.15 适合吉他）
 */
function yinDetect(buffer: Float32Array, sampleRate: number, threshold = 0.12): number {
  const halfLen = Math.floor(buffer.length / 2);
  // 步骤 1+2：差分函数 d(τ) 与累积均值归一化差分函数 d'(τ)
  const d = new Float32Array(halfLen);
  const dPrime = new Float32Array(halfLen);

  for (let tau = 0; tau < halfLen; tau++) {
    let sum = 0;
    for (let i = 0; i < halfLen; i++) {
      const diff = buffer[i] - buffer[i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // 累积均值归一化
  dPrime[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < halfLen; tau++) {
    runningSum += d[tau];
    dPrime[tau] = d[tau] * tau / runningSum;
  }

  // 步骤 3：绝对阈值法 — 找第一个低于 threshold 的谷
  let tauBest = -1;
  // 从 tau=2 开始（避免 DC 和极高频噪声）
  // 吉他最高音约 E6=1319Hz → 最小周期 ≈ sampleRate/1319
  // 吉他最低音约 E2=82Hz → 最大周期 ≈ sampleRate/82
  const tauMin = Math.max(2, Math.floor(sampleRate / 1400));
  const tauMax = Math.min(halfLen - 1, Math.ceil(sampleRate / 60));

  for (let tau = tauMin; tau < tauMax; tau++) {
    if (dPrime[tau] < threshold) {
      // 往后找到这个谷的最低点
      while (tau + 1 < tauMax && dPrime[tau + 1] < dPrime[tau]) {
        tau++;
      }
      tauBest = tau;
      break;
    }
  }

  if (tauBest < 0) return -1;

  // 步骤 5：抛物线插值精确化
  const s0 = dPrime[tauBest - 1] ?? dPrime[tauBest];
  const s1 = dPrime[tauBest];
  const s2 = dPrime[tauBest + 1] ?? dPrime[tauBest];
  const betterTau = tauBest + (s0 - s2) / (2 * (s0 - 2 * s1 + s2) || 1);

  return sampleRate / betterTau;
}

export class PitchDetector {
  private audioCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private rafId = 0;
  private running = false;
  private callback: PitchCallback = () => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buffer: any = new Float32Array(0);

  /** 请求麦克风权限并开始实时检测 */
  async start(cb: PitchCallback): Promise<void> {
    this.callback = cb;
    if (this.running) return;

    try {
      // 请求麦克风 — 移动端需要用户手势触发
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,   // 吉他信号不需要回声消除
          noiseSuppression: false,   // 关闭降噪以保留弦乐泛音
          autoGainControl: false,    // 保持原始增益
        }
      });

      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      this.audioCtx = new Ctor();

      // 如果被 suspend 需要 resume
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.source = this.audioCtx.createMediaStreamSource(this.stream);

      // AnalyserNode 配置
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 4096; // 足够检测 E2 (82Hz) 的分辨率
      this.analyser.smoothingTimeConstant = 0;

      this.source.connect(this.analyser);
      // 不连接 destination（不回放麦克风声音，防反馈）

      this.buffer = new Float32Array(this.analyser.fftSize);
      this.running = true;
      this.loop();
    } catch (err) {
      console.warn('麦克风权限被拒绝或不可用', err);
      this.callback(null);
    }
  }

  /** 停止检测，释放麦克风 */
  stop() {
    this.running = false;
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.source) { try { this.source.disconnect(); } catch {} this.source = null; }
    if (this.analyser) { try { this.analyser.disconnect(); } catch {} this.analyser = null; }
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch {}
      this.audioCtx = null;
    }
  }

  private loop = () => {
    if (!this.running || !this.analyser || !this.audioCtx) return;
    this.analyser.getFloatTimeDomainData(this.buffer);

    // 计算 RMS（信号强度）
    let sumSq = 0;
    for (let i = 0; i < this.buffer.length; i++) sumSq += this.buffer[i] * this.buffer[i];
    const rms = Math.sqrt(sumSq / this.buffer.length);

    // 静音阈值：RMS 太小说明没有弹琴
    if (rms < 0.008) {
      this.callback(null);
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    const freq = yinDetect(this.buffer as any, this.audioCtx.sampleRate, 0.12);

    if (freq <= 0 || freq > 2000) {
      this.callback(null);
    } else {
      const { midi, cents } = freqToMidiCents(freq);
      const pc = ((midi % 12) + 12) % 12;
      const octave = Math.floor(midi / 12) - 1;
      const noteOnly = SHARP_NAMES[pc];
      const noteName = noteOnly + octave;
      this.callback({ freq, midi, noteName, noteOnly, pc, cents, rms });
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  get isRunning() { return this.running; }
}

/** 单例 */
export const pitchDetector = new PitchDetector();