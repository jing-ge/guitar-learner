/**
 * Essentia.js 引擎封装 - Round 47
 *
 * 设计原则：
 *   1. 懒加载：只有真正用到时才动态 import (~2.5 MB WASM 不阻塞首屏)
 *   2. 单例：一个 AudioContext 内只初始化一次 Essentia
 *   3. 显式释放：每个 C++ vector 用完必须 .delete()，否则 mobile Safari 跑 2 次崩
 *   4. Beat-Sync 优先：用 ChordsDetectionBeats + RhythmExtractor2013 而非每 0.5s 盲猜
 *
 * API 边界：
 *   - analyzeRecording(audio, sampleRate) → 一次性离线分析（和弦+调性+BPM+节拍）
 *   - extractPitchYinFFT(spectrum, ...) → 单帧基频（给 Tuner / PitchTrainer 用）
 *   - resetEngine() → 测试用，释放 Essentia 实例
 *
 * 已知坑（来自 librarian + grep_app 实战）：
 *   - vector_string 必须 .get(i) 取，不能用 vectorToArray (会得到 NaN)
 *   - degara method 的 confidence 永远是 0，不要信任 rhythm.confidence
 *   - RhythmExtractor2013 至少需要 ~5s 音频，否则 ticks 可能为空
 */

// ============ 类型 ============

export interface BeatChord {
  /** 起始秒（相对录音开头） */
  startSec: number;
  /** 结束秒 */
  endSec: number;
  /** 和弦名，如 "C", "Am", "F#", "Bm"（Essentia 输出 # 不输出 b） */
  chord: string;
  /** 该 beat 区间的色度强度（0~1） */
  strength: number;
}

export interface KeyResult {
  /** 主音名，如 "C", "F#" */
  key: string;
  /** "major" | "minor" */
  scale: 'major' | 'minor';
  /** 0~1 置信度 */
  strength: number;
}

export interface AnalysisResult {
  /** BPM (拍/分钟) */
  bpm: number;
  /** 节拍点（秒） */
  ticks: number[];
  /** 调性 */
  key: KeyResult;
  /** Beat-Sync 和弦序列 */
  beatChords: BeatChord[];
  /** 分析耗时（毫秒，调用方用来上报） */
  elapsedMs: number;
}

// ============ 懒加载 Essentia 实例 ============

let essentiaInstance: any = null;
let loadPromise: Promise<any> | null = null;

/**
 * 异步加载并初始化 Essentia。
 * 多次调用安全（去重 promise），任意调用方都会等到同一个实例。
 *
 * Vite 通过 import() 动态分包，essentia-wasm.es.js (~2.5MB) 不进首屏 chunk。
 */
async function loadEssentia(): Promise<any> {
  if (essentiaInstance) return essentiaInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // 动态 import 走 ES module 路径（绕过 npm pkg 的 UMD main 入口）
    const wasmModule = await import('essentia.js/dist/essentia-wasm.es.js' as any);
    const coreModule = await import('essentia.js/dist/essentia.js-core.es.js' as any);
    const EssentiaWASM = wasmModule.EssentiaWASM;
    const EssentiaCtor = coreModule.default;
    essentiaInstance = new EssentiaCtor(EssentiaWASM);
    return essentiaInstance;
  })();

  return loadPromise;
}

/** 仅用于测试/调试：释放当前实例 */
export function resetEngine() {
  essentiaInstance = null;
  loadPromise = null;
}

/** 当前是否已加载（用于 UI 显示"模型加载中..."） */
export function isEngineReady(): boolean {
  return essentiaInstance !== null;
}

/** 预热加载（供 UI 在用户点录音前主动调用） */
export async function warmupEngine(): Promise<void> {
  await loadEssentia();
}

// ============ 主分析函数 ============

/**
 * 离线分析一段录音，返回和弦序列 + 调性 + 节拍。
 *
 * @param audio Float32Array 单声道 PCM (推荐 44100 Hz)
 * @param sampleRate 采样率（必须与 audio 实际采样率一致）
 * @returns AnalysisResult
 *
 * 算法链路：
 *   1. RhythmExtractor2013(degara) → BPM + ticks (秒)
 *   2. TonalExtractor → HPCP 矩阵 + key + chord_progression（整曲粗略）
 *   3. ChordsDetectionBeats(HPCP, ticks, interbeat_median) → 卡节拍和弦序列
 *   4. 用 KeyExtractor 单独跑一遍调性（比 TonalExtractor 的 key 更准）
 *
 * 注意：
 *   - audio 至少 5s 否则 ticks 可能空（degara 需要节拍统计）
 *   - 所有中间 C++ vector 都在 try/finally 里 .delete()，泄漏在 mobile 上会崩
 */
export async function analyzeRecording(
  audio: Float32Array,
  sampleRate: number = 44100,
): Promise<AnalysisResult> {
  const t0 = performance.now();
  const essentia = await loadEssentia();

  // 1. Float32 → C++ vector
  const audioVec = essentia.arrayToVector(audio);

  // 这些都是 C++ 对象，必须在 finally 里 delete
  let rhythm: any = null;
  let tonal: any = null;
  let chordsBeats: any = null;
  let keyOut: any = null;

  try {
    // 2. RhythmExtractor2013 → BPM + ticks
    // signature: (signal, maxTempo=208, method='degara', minTempo=40)
    rhythm = essentia.RhythmExtractor2013(audioVec, 208, 'degara', 40);
    const bpm: number = rhythm.bpm;
    const ticksJs = Array.from(essentia.vectorToArray(rhythm.ticks)) as number[];

    // 3. TonalExtractor → HPCP + chords_progression + key（一站式）
    // signature: (signal, frameSize=4096, hopSize=2048, tuningFrequency=440)
    tonal = essentia.TonalExtractor(audioVec, 4096, 2048, 440);

    // 4. ChordsDetectionBeats: 用 HPCP + ticks 卡节拍出和弦
    // signature: (pcp, ticks, chromaPick='interbeat_median', hopSize=2048, sampleRate=44100)
    let beatChords: BeatChord[] = [];
    if (ticksJs.length >= 2) {
      chordsBeats = essentia.ChordsDetectionBeats(
        tonal.hpcp,
        rhythm.ticks,
        'interbeat_median',
        2048,
        sampleRate,
      );

      // ⚠️ chords 是 vector_string，必须 .get(i) 取，不能用 vectorToArray
      const chordCount: number = chordsBeats.chords.size();
      const strengthJs = Array.from(essentia.vectorToArray(chordsBeats.strength)) as number[];
      for (let i = 0; i < chordCount; i++) {
        beatChords.push({
          startSec: ticksJs[i] ?? 0,
          endSec: ticksJs[i + 1] ?? ticksJs[i] ?? 0,
          chord: chordsBeats.chords.get(i),
          strength: strengthJs[i] ?? 0,
        });
      }
    } else {
      // 兜底：ticks 太少（短录音 < 5s），用 TonalExtractor 的 chord_progression
      // 注意：chords_progression 是 hopSize 级密集序列（每 ~46ms 一个），需折叠相邻同根
      const fallbackCount: number = tonal.chords_progression.size();
      const fbStrength = Array.from(essentia.vectorToArray(tonal.chords_strength)) as number[];
      const segDur = audio.length / sampleRate / Math.max(1, fallbackCount);
      // 折叠：把相邻相同 chord 合并成一段
      let curChord = '';
      let curStart = 0;
      let curStrengthSum = 0;
      let curStrengthCount = 0;
      for (let i = 0; i < fallbackCount; i++) {
        const ch: string = tonal.chords_progression.get(i);
        const t = i * segDur;
        if (ch !== curChord) {
          if (curChord) {
            beatChords.push({
              startSec: curStart,
              endSec: t,
              chord: curChord,
              strength: curStrengthCount > 0 ? curStrengthSum / curStrengthCount : 0,
            });
          }
          curChord = ch;
          curStart = t;
          curStrengthSum = fbStrength[i] ?? 0;
          curStrengthCount = 1;
        } else {
          curStrengthSum += fbStrength[i] ?? 0;
          curStrengthCount++;
        }
      }
      if (curChord) {
        beatChords.push({
          startSec: curStart,
          endSec: audio.length / sampleRate,
          chord: curChord,
          strength: curStrengthCount > 0 ? curStrengthSum / curStrengthCount : 0,
        });
      }
    }

    // 5. KeyExtractor 单独跑（比 TonalExtractor 内嵌的 key 准）
    // 真实签名 (15 参): (audio, averageDetuningCorrection=true, frameSize=4096, hopSize=4096,
    //   hpcpSize=12, maxFrequency=3500, maximumSpectralPeaks=60, minFrequency=25,
    //   pcpThreshold=0.2, profileType='bgate', sampleRate=44100, spectralPeaksThreshold=0.0001,
    //   tuningFrequency=440, weightType='cosine', windowType='hann')
    // 默认值都很合理，直接传 audioVec 即可
    keyOut = essentia.KeyExtractor(audioVec);

    const key: KeyResult = {
      key: keyOut.key,
      scale: keyOut.scale,
      strength: keyOut.strength,
    };

    return {
      bpm,
      ticks: ticksJs,
      key,
      beatChords,
      elapsedMs: performance.now() - t0,
    };
  } finally {
    // 严格释放所有 C++ vector，否则手机 Safari 崩
    try { audioVec.delete?.(); } catch {}
    if (rhythm) {
      try { rhythm.ticks?.delete?.(); } catch {}
      try { rhythm.estimates?.delete?.(); } catch {}
      try { rhythm.bpmIntervals?.delete?.(); } catch {}
    }
    if (tonal) {
      try { tonal.hpcp?.delete?.(); } catch {}
      try { tonal.hpcp_highres?.delete?.(); } catch {}
      try { tonal.chords_histogram?.delete?.(); } catch {}
      try { tonal.chords_progression?.delete?.(); } catch {}
      try { tonal.chords_strength?.delete?.(); } catch {}
    }
    if (chordsBeats) {
      try { chordsBeats.chords?.delete?.(); } catch {}
      try { chordsBeats.strength?.delete?.(); } catch {}
    }
    // KeyExtractor 输出全是 number/string，无 vector 需要释放
  }
}

// ============ 单帧基频 (给 Tuner / PitchTrainer) ============

/**
 * 用 Essentia 的 PitchYinFFT 算单帧基频。
 *
 * 输入：原始 PCM 时域帧（Float32），通常 2048 或 4096 样本
 * 输出：{ pitch: Hz, confidence: 0~1 }，pitch=0 表示无音
 *
 * 实现：内部一次调用走完 Windowing → Spectrum → PitchYinFFT 三步
 */
export async function extractPitch(
  pcmFrame: Float32Array,
  sampleRate: number = 44100,
  minFreq: number = 60,
  maxFreq: number = 1500,
): Promise<{ pitch: number; confidence: number }> {
  const essentia = await loadEssentia();
  const inVec = essentia.arrayToVector(pcmFrame);
  let windowed: any = null;
  let spectrum: any = null;
  try {
    // Windowing(frame, normalized=true, size=0, type='hann', zeroPadding=0, zeroPhase=true)
    windowed = essentia.Windowing(inVec, true, 0, 'hann', 0, true);
    // Spectrum(frame, size=2048)
    spectrum = essentia.Spectrum(windowed.frame, pcmFrame.length);
    // PitchYinFFT(spectrum, frameSize, interpolate=true, maxFrequency, minFrequency, sampleRate, tolerance=1)
    const result = essentia.PitchYinFFT(
      spectrum.spectrum, pcmFrame.length, true, maxFreq, minFreq, sampleRate, 1.0,
    );
    return {
      pitch: result.pitch as number,
      confidence: result.pitchConfidence as number,
    };
  } finally {
    try { inVec.delete?.(); } catch {}
    try { windowed?.frame?.delete?.(); } catch {}
    try { spectrum?.spectrum?.delete?.(); } catch {}
  }
}
