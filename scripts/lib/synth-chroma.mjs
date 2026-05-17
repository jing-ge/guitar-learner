// 真实化和弦信号合成器：MIDI 音符 → 谐波 + 噪声 → 12 维 chroma
// 用于离线评测，不依赖 Web Audio

const HARMONICS = 5;       // 5 个谐波
const DEFAULT_SNR_DB = 20; // 默认信噪比

/** MIDI 音符 → 频率（Hz） */
function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** 频率 → pitch class */
function freqToPc(f) {
  return ((Math.round(12 * Math.log2(f / 440) + 69)) % 12 + 12) % 12;
}

/**
 * 合成和弦 chroma。
 * @param {number[]} midiNotes 例如 [48,52,55] = C 大三
 * @param {{snrDb?:number, harmonics?:number, fmin?:number, fmax?:number}} opts
 * @returns {number[]} 长度 12，归一化到 [0,1]
 */
export function synthChordChroma(midiNotes, opts = {}) {
  const harmonics = opts.harmonics ?? HARMONICS;
  const snrDb = opts.snrDb ?? DEFAULT_SNR_DB;
  const fmin = opts.fmin ?? 70;
  const fmax = opts.fmax ?? 2000;
  const rand = opts.rand ?? Math.random;

  const chroma = new Array(12).fill(0);
  let signalEnergy = 0;

  for (const midi of midiNotes) {
    const f0 = midiToFreq(midi);
    for (let n = 1; n <= harmonics; n++) {
      const f = f0 * n;
      if (f < fmin || f > fmax) continue;
      const amp = 1 / (n * n); // 1/n² 衰减
      const pc = freqToPc(f);
      chroma[pc] += amp;
      signalEnergy += amp * amp;
    }
  }

  // 加白噪声：均匀分布到 12 个 pc，控制 SNR
  if (snrDb < 999) {
    // SNR = 10*log10(signalE / noiseE)  =>  noiseE = signalE / 10^(SNR/10)
    const noiseE = signalEnergy / Math.pow(10, snrDb / 10);
    const noiseAmp = Math.sqrt(noiseE / 12); // 每个 bin 的噪声 rms
    for (let i = 0; i < 12; i++) {
      // 用 [-1,1] 均匀，再乘 rms*sqrt(3)（均匀分布的标准差到 rms 比是 1/sqrt(3)）
      chroma[i] += (rand() - 0.5) * 2 * noiseAmp * Math.sqrt(3);
      if (chroma[i] < 0) chroma[i] = 0;
    }
  }

  // 归一化
  let max = 0;
  for (let i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
  if (max > 1e-9) for (let i = 0; i < 12; i++) chroma[i] /= max;

  return chroma;
}

/**
 * 根据和弦根音 pc + quality 推导典型 voicing 的 MIDI 音符
 * 默认根音放在 MIDI 48 (C3) 附近的最近根音
 */
export function voicingFor(rootPc, quality) {
  // 把 root 放到 C3-B3 区间（MIDI 48-59）
  const rootMidi = 48 + rootPc;
  const notes = [rootMidi];

  switch (quality) {
    case 'maj':  notes.push(rootMidi + 4, rootMidi + 7); break;
    case 'min':  notes.push(rootMidi + 3, rootMidi + 7); break;
    case '7':    notes.push(rootMidi + 4, rootMidi + 7, rootMidi + 10); break;
    case 'maj7': notes.push(rootMidi + 4, rootMidi + 7, rootMidi + 11); break;
    case 'm7':   notes.push(rootMidi + 3, rootMidi + 7, rootMidi + 10); break;
    case 'sus2': notes.push(rootMidi + 2, rootMidi + 7); break;
    case 'sus4': notes.push(rootMidi + 5, rootMidi + 7); break;
    case 'dim':  notes.push(rootMidi + 3, rootMidi + 6); break;
    case 'aug':  notes.push(rootMidi + 4, rootMidi + 8); break;
    case 'm7b5': notes.push(rootMidi + 3, rootMidi + 6, rootMidi + 10); break;
    case '6':    notes.push(rootMidi + 4, rootMidi + 7, rootMidi + 9); break;
    case '9':    notes.push(rootMidi + 4, rootMidi + 7, rootMidi + 10, rootMidi + 14); break;
    case 'add9': notes.push(rootMidi + 4, rootMidi + 7, rootMidi + 14); break;
    default:     notes.push(rootMidi + 4, rootMidi + 7);
  }
  return notes;
}
