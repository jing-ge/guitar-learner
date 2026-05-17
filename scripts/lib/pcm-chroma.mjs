import { fftRealToComplex, magnitudeSpectrum } from './fft.mjs';

const DEFAULT_FFT_SIZE = 8192;
const DEFAULT_SAMPLE_RATE = 22050;

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function hannWindow(N) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
  return w;
}

/**
 * 合成 PCM 时域信号
 * @param {number[]} midiNotes
 * @param {{snrDb?:number, harmonics?:number, fftSize?:number, sampleRate?:number}} opts
 * @returns {Float64Array}
 */
export function synthPcm(midiNotes, opts = {}) {
  const N = opts.fftSize ?? DEFAULT_FFT_SIZE;
  const sr = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const harmonics = opts.harmonics ?? 5;
  const snrDb = opts.snrDb ?? 20;
  const rand = opts.rand ?? Math.random;

  const pcm = new Float64Array(N);
  let signalE = 0;
  for (const midi of midiNotes) {
    const f0 = midiToFreq(midi);
    for (let n = 1; n <= harmonics; n++) {
      const f = f0 * n;
      if (f >= sr / 2) break; // Nyquist
      const amp = 1 / (n * n);
      const phase = rand() * 2 * Math.PI;
      const omega = 2 * Math.PI * f / sr;
      for (let i = 0; i < N; i++) {
        pcm[i] += amp * Math.sin(omega * i + phase);
      }
      signalE += amp * amp * N / 2;
    }
  }

  // 加噪
  if (snrDb < 999 && signalE > 0) {
    const noiseE = signalE / Math.pow(10, snrDb / 10);
    const noiseStd = Math.sqrt(noiseE / N);
    for (let i = 0; i < N; i++) {
      // box-muller 简化：均匀近似高斯
      pcm[i] += (rand() + rand() + rand() - 1.5) * noiseStd * 1.4;
    }
  }

  // Hann 窗
  const w = hannWindow(N);
  for (let i = 0; i < N; i++) pcm[i] *= w[i];

  return pcm;
}

/**
 * PCM → 12 维 chroma
 */
export function pcmToChroma(pcm, sampleRate = DEFAULT_SAMPLE_RATE) {
  const N = pcm.length;
  const fftOut = fftRealToComplex(pcm);
  const mag = magnitudeSpectrum(fftOut);

  const binSize = sampleRate / N;
  const minBin = Math.max(1, Math.floor(70 / binSize));
  const maxBin = Math.min(mag.length - 1, Math.ceil(2000 / binSize));

  const chromaRaw = new Array(12).fill(0);
  for (let i = minBin; i <= maxBin; i++) {
    const freq = (i + 0.5) * binSize;
    if (freq <= 0) continue;
    const m = 12 * Math.log2(freq / 440) + 69;
    const pcLowFloat = Math.floor(m);
    const pcHighFloat = pcLowFloat + 1;
    const pcLow = ((pcLowFloat % 12) + 12) % 12;
    const pcHigh = ((pcHighFloat % 12) + 12) % 12;
    const frac = m - pcLowFloat;  // [0, 1)
    // 软分配：cos² 半窗，能量守恒
    const halfPi = Math.PI / 2;
    const wLow = Math.cos(frac * halfPi) ** 2;
    const wHigh = Math.sin(frac * halfPi) ** 2;
    chromaRaw[pcLow] += mag[i] * wLow;
    chromaRaw[pcHigh] += mag[i] * wHigh;
  }

  // HPS 抑制（五度 + 大三度）
  const chroma = new Array(12);
  for (let pc = 0; pc < 12; pc++) {
    chroma[pc] = Math.max(0, chromaRaw[pc] - 0.33 * chromaRaw[(pc + 7) % 12] - 0.20 * chromaRaw[(pc + 4) % 12]);
  }

  // 归一化
  let max = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
  if (max > 1e-9) for (let i = 0; i < 12; i++) chroma[i] /= max;
  return chroma;
}

const BASS_FREQ_MAX = 220;  // 70-220Hz 与 chord-detector.ts CHROMA_BASS_FREQ 对齐

/**
 * 同时返回完整 chroma 和 bass-only chroma（70-220Hz）
 * @returns {{ chroma: number[], bassChroma: number[] }}
 */
export function pcmToChromaWithBass(pcm, sampleRate = DEFAULT_SAMPLE_RATE) {
  const N = pcm.length;
  const fftOut = fftRealToComplex(pcm);
  const mag = magnitudeSpectrum(fftOut);

  const binSize = sampleRate / N;
  const minBin = Math.max(1, Math.floor(70 / binSize));
  const maxBin = Math.min(mag.length - 1, Math.ceil(2000 / binSize));

  const chromaRaw = new Array(12).fill(0);
  const bassRaw = new Array(12).fill(0);

  for (let i = minBin; i <= maxBin; i++) {
    const freq = (i + 0.5) * binSize;
    if (freq <= 0) continue;
    const m = 12 * Math.log2(freq / 440) + 69;
    const pcLowFloat = Math.floor(m);
    const pcHighFloat = pcLowFloat + 1;
    const pcLow = ((pcLowFloat % 12) + 12) % 12;
    const pcHigh = ((pcHighFloat % 12) + 12) % 12;
    const frac = m - pcLowFloat;
    const halfPi = Math.PI / 2;
    const wLow = Math.cos(frac * halfPi) ** 2;
    const wHigh = Math.sin(frac * halfPi) ** 2;
    const e = mag[i];
    chromaRaw[pcLow] += e * wLow;
    chromaRaw[pcHigh] += e * wHigh;
    if (freq < BASS_FREQ_MAX) {
      bassRaw[pcLow] += e * wLow;
      bassRaw[pcHigh] += e * wHigh;
    }
  }

  // chroma HPS 减法（与现有 pcmToChroma 同公式）
  const chroma = new Array(12);
  for (let pc = 0; pc < 12; pc++) {
    chroma[pc] = Math.max(0, chromaRaw[pc] - 0.33 * chromaRaw[(pc + 7) % 12] - 0.20 * chromaRaw[(pc + 4) % 12]);
  }

  // bassChroma 不做 HPS（保留低频根音原貌）
  const bassChroma = bassRaw.slice();

  // 各自归一化
  let cMax = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] > cMax) cMax = chroma[i];
  if (cMax > 1e-9) for (let i = 0; i < 12; i++) chroma[i] /= cMax;

  let bMax = 0;
  for (let i = 0; i < 12; i++) if (bassChroma[i] > bMax) bMax = bassChroma[i];
  if (bMax > 1e-9) for (let i = 0; i < 12; i++) bassChroma[i] /= bMax;

  return { chroma, bassChroma };
}
