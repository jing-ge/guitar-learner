#!/usr/bin/env node
// scripts/essentia-eval.mjs
//
// Round 47: 用 Essentia.js 跑真实 wav，对比新旧引擎和弦/调性识别准确率
//
// 用法:
//   node scripts/essentia-eval.mjs [wav_path] [expected_key] [expected_scale]
//   默认: /tmp/glog/canon.wav D major
//
// 流程:
//   1. wavefile 读 wav → 重采样到 44100Hz mono → Float32Array
//   2. Essentia.RhythmExtractor2013(degara) → BPM + ticks
//   3. Essentia.TonalExtractor → HPCP matrix
//   4. Essentia.ChordsDetectionBeats(HPCP, ticks, interbeat_median) → 节拍和弦
//   5. Essentia.KeyExtractor(audio, bgate profile) → 调性
//
// 输出:
//   - BPM, 节拍数, 调性 (key + scale + strength), 耗时
//   - Beat-aligned 和弦序列
//   - 调性命中 ✓/✗

import fs from 'node:fs';
import process from 'node:process';
import pkg from 'essentia.js';
import wavefilePkg from 'wavefile';

const { Essentia, EssentiaWASM } = pkg;
const { WaveFile } = wavefilePkg;

const WAV_PATH = process.argv[2] || '/tmp/glog/canon.wav';
const EXPECTED_KEY = process.argv[3] || 'D';
const EXPECTED_SCALE = process.argv[4] || 'major';

// ============== Helper: 读 wav → Float32 ==============
function readWavToFloat32(filePath, targetSR = 44100) {
  const buffer = fs.readFileSync(filePath);
  const wav = new WaveFile(buffer);
  wav.toSampleRate(targetSR);
  wav.toBitDepth('32f');
  let samples = wav.getSamples();
  if (Array.isArray(samples) && Array.isArray(samples[0])) {
    samples = samples[0];   // 取左声道
  }
  return new Float32Array(samples);
}

// ============== Main ==============
async function main() {
  console.log(`\n=== Essentia.js Evaluation ===`);
  console.log(`File: ${WAV_PATH}`);
  console.log(`Expected: ${EXPECTED_KEY} ${EXPECTED_SCALE}\n`);

  console.log(`[1/4] 读取 + 重采样 wav...`);
  const t0 = performance.now();
  const audio = readWavToFloat32(WAV_PATH, 44100);
  console.log(`  ✓ ${(audio.length / 44100).toFixed(2)}s @ 44100Hz mono (${audio.length} samples) - ${(performance.now() - t0).toFixed(0)}ms`);

  console.log(`[2/4] 初始化 Essentia (WASM)...`);
  const tInit = performance.now();
  // Note: EssentiaWASM 在 UMD 模式下已经是 promise，但也可能是 ready module
  let wasmModule = EssentiaWASM;
  if (typeof wasmModule.then === 'function') {
    wasmModule = await wasmModule;
  }
  // 有些 UMD 版本会嵌套 EssentiaWASM 一层
  if (wasmModule.EssentiaWASM) wasmModule = wasmModule.EssentiaWASM;
  const essentia = new Essentia(wasmModule);
  console.log(`  ✓ Essentia v${essentia.version} loaded - ${(performance.now() - tInit).toFixed(0)}ms`);

  // ============== 分析 ==============
  console.log(`[3/4] Beat-Sync 和弦分析...`);
  const tAnalyze = performance.now();
  const audioVec = essentia.arrayToVector(audio);

  let rhythm, tonal, chordsBeats, keyOut;
  try {
    // 1. RhythmExtractor2013
    rhythm = essentia.RhythmExtractor2013(audioVec, 208, 'degara', 40);
    const bpm = rhythm.bpm;
    const ticksJs = Array.from(essentia.vectorToArray(rhythm.ticks));
    console.log(`  ✓ BPM: ${bpm.toFixed(1)}, ticks: ${ticksJs.length}`);

    // 2. TonalExtractor (出 HPCP)
    tonal = essentia.TonalExtractor(audioVec, 4096, 2048, 440);

    // 3. ChordsDetectionBeats
    let beatChords = [];
    if (ticksJs.length >= 2) {
      chordsBeats = essentia.ChordsDetectionBeats(
        tonal.hpcp, rhythm.ticks, 'interbeat_median', 2048, 44100
      );
      const chordCount = chordsBeats.chords.size();
      const strengthJs = Array.from(essentia.vectorToArray(chordsBeats.strength));
      for (let i = 0; i < chordCount; i++) {
        beatChords.push({
          startSec: ticksJs[i],
          endSec: ticksJs[i + 1] ?? ticksJs[i],
          chord: chordsBeats.chords.get(i),
          strength: strengthJs[i] ?? 0,
        });
      }
    }

    // 4. KeyExtractor
    // signature: (audio, averageDetuningCorrection=true, frameSize=4096, hopSize=4096,
    //   hpcpSize=12, maxFrequency=3500, maximumSpectralPeaks=60, minFrequency=25,
    //   pcpThreshold=0.2, profileType='bgate', sampleRate=44100, spectralPeaksThreshold=0.0001,
    //   tuningFrequency=440, weightType='cosine', windowType='hann')
    keyOut = essentia.KeyExtractor(audioVec);

    const elapsed = performance.now() - tAnalyze;
    console.log(`  ✓ analyze done - ${(elapsed / 1000).toFixed(2)}s\n`);

    // ============== 输出 ==============
    console.log(`[4/4] 结果`);
    console.log(`-------------------------------`);
    console.log(`BPM:        ${bpm.toFixed(1)}`);
    console.log(`Ticks:      ${ticksJs.length} 拍`);
    console.log(`和弦段:     ${beatChords.length} 段 (beat-aligned)`);
    console.log(`\n调性识别:`);
    console.log(`  Key:      ${keyOut.key} ${keyOut.scale}`);
    console.log(`  Strength: ${(keyOut.strength * 100).toFixed(1)}%`);
    const keyMatch = keyOut.key === EXPECTED_KEY && keyOut.scale === EXPECTED_SCALE;
    console.log(`  Match:    ${keyMatch ? '✅ ' : '❌ '} 期望 ${EXPECTED_KEY} ${EXPECTED_SCALE}`);

    // 和弦序列（折叠相邻同根）
    console.log(`\n和弦序列 (前 30 个):`);
    const folded = [];
    for (const bc of beatChords) {
      if (folded.length === 0 || folded[folded.length - 1].chord !== bc.chord) {
        folded.push({ chord: bc.chord, startSec: bc.startSec, strength: bc.strength });
      }
    }
    folded.slice(0, 30).forEach((c, i) => {
      console.log(`  ${String(i + 1).padStart(3)}. ${c.chord.padEnd(4)} @ ${c.startSec.toFixed(2)}s (${(c.strength * 100).toFixed(0)}%)`);
    });
    if (folded.length > 30) console.log(`  ... (+${folded.length - 30} 个)`);

    // 和弦频次 top 6
    console.log(`\nTop 6 和弦 (按频次):`);
    const counts = new Map();
    for (const f of folded) counts.set(f.chord, (counts.get(f.chord) || 0) + 1);
    [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).forEach(([c, n]) => {
      console.log(`  ${c.padEnd(4)} × ${n}`);
    });

    console.log(`\n-------------------------------`);
    console.log(`总耗时: ${((performance.now() - tAnalyze) / 1000).toFixed(2)}s`);
    console.log(`音频时长: ${(audio.length / 44100).toFixed(2)}s`);
    console.log(`分析速度: ${((audio.length / 44100) / ((performance.now() - tAnalyze) / 1000)).toFixed(1)}x realtime`);

    process.exit(keyMatch ? 0 : 1);

  } finally {
    // 释放 C++ vector
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
  }
}

main().catch(err => {
  console.error('❌ 失败:', err);
  process.exit(2);
});
