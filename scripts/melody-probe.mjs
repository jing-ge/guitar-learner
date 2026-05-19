#!/usr/bin/env node
// 任务 0: 验证 PitchMelodia 在 essentia.js 0.1.3 真实可用 + 测耗时 + 看输出
// 用法: node scripts/melody-probe.mjs [wav_path]

import fs from 'node:fs';
import pkg from 'essentia.js';
import wavefilePkg from 'wavefile';

const { Essentia, EssentiaWASM } = pkg;
const { WaveFile } = wavefilePkg;

const WAV_PATH = process.argv[2] || '/tmp/glog/canon.wav';

function readWavToFloat32(filePath, targetSR = 44100) {
  const wav = new WaveFile(fs.readFileSync(filePath));
  wav.toSampleRate(targetSR);
  wav.toBitDepth('32f');
  let samples = wav.getSamples();
  if (Array.isArray(samples) && Array.isArray(samples[0])) samples = samples[0];
  return new Float32Array(samples);
}

async function main() {
  console.log(`\n=== PitchMelodia Probe ===`);
  console.log(`File: ${WAV_PATH}`);

  const t0 = performance.now();
  const fullAudio = readWavToFloat32(WAV_PATH);
  console.log(`✓ 读 + 重采样: ${fullAudio.length} samples (${(fullAudio.length / 44100).toFixed(1)}s) - ${(performance.now() - t0).toFixed(0)}ms`);

  // 只取前 15s, 与 Round 51 MVP 一致
  const DURATION_SEC = 15;
  const audio = fullAudio.slice(0, Math.min(fullAudio.length, DURATION_SEC * 44100));
  console.log(`✓ 截取前 ${(audio.length/44100).toFixed(1)}s 作为测试样本`);

  // 初始化 Essentia
  let wasm = EssentiaWASM;
  if (typeof wasm.then === 'function') wasm = await wasm;
  if (wasm.EssentiaWASM) wasm = wasm.EssentiaWASM;
  const essentia = new Essentia(wasm);
  console.log(`✓ Essentia v${essentia.version} loaded`);

  // 跑 PitchMelodia 和 PredominantPitchMelodia 对比 + 调优参数版
  console.log(`\n[算法对比]`);

  const configs = [
    { name: 'PitchMelodia (default)', algo: 'PitchMelodia', args: [] },
    { name: 'PredominantPitchMelodia (default)', algo: 'PredominantPitchMelodia', args: [] },
    // 人声调优: minFreq 150Hz (排除 bass), maxFreq 1500Hz, voiceVibrato=true
    // PredominantPitchMelodia signature 19 params after signal:
    //   binRes(10), filterIter(3), frameSize(2048), guessUnvoiced(false), harmWeight(0.8),
    //   hopSize(128), magCompr(1), magThr(40), maxFreq(20000), minDuration(100), minFreq(80),
    //   numHarm(20), peakDistThr(0.9), peakFrameThr(0.9), pitchCont(27.5625), refFreq(55),
    //   sampleRate(44100), timeCont(100), voiceVibrato(false), voicingTolerance(0.2)
    { name: 'PredominantPitchMelodia (vocal 调优)', algo: 'PredominantPitchMelodia',
      args: [10, 3, 2048, false, 0.8, 128, 1, 40, 1500, 100, 150, 20, 0.9, 0.9, 27.5625, 55, 44100, 100, true, 0.2] },
  ];

  for (const cfg of configs) {
    const tStart = performance.now();
    const audioVec = essentia.arrayToVector(audio);

    let result;
    try {
      result = essentia[cfg.algo](audioVec, ...cfg.args);
    } catch (err) {
      console.error(`❌ ${cfg.name} 失败:`, err.message || err);
      audioVec.delete?.();
      continue;
    }
    const elapsed = performance.now() - tStart;

    const pitch = Array.from(essentia.vectorToArray(result.pitch));

    let validCount = 0, sumHz = 0, minHz = Infinity, maxHz = -Infinity;
    for (let i = 0; i < pitch.length; i++) {
      if (pitch[i] > 0) {
        validCount++;
        sumHz += pitch[i];
        if (pitch[i] < minHz) minHz = pitch[i];
        if (pitch[i] > maxHz) maxHz = pitch[i];
      }
    }
    const avgHz = validCount > 0 ? sumHz / validCount : 0;
    const avgMidi = avgHz > 0 ? 69 + 12 * Math.log2(avgHz / 440) : -1;

    console.log(`\n--- ${cfg.name} ---`);
    console.log(`  耗时: ${(elapsed/1000).toFixed(2)}s (${(audio.length/44100/elapsed*1000).toFixed(1)}x realtime)`);
    console.log(`  有效帧: ${validCount}/${pitch.length} (${(validCount/pitch.length*100).toFixed(1)}%)`);
    console.log(`  Hz 范围: ${minHz === Infinity ? '—' : minHz.toFixed(1)} ~ ${maxHz === -Infinity ? '—' : maxHz.toFixed(1)}`);
    console.log(`  均值: ${avgHz.toFixed(1)} Hz (≈ MIDI ${avgMidi >= 0 ? avgMidi.toFixed(1) : '—'})`);

    audioVec.delete?.();
    result.pitch.delete?.();
    result.pitchConfidence.delete?.();
  }

  console.log(`\n=== 结论 ===`);
}

main().catch(err => { console.error('❌ 失败:', err); process.exit(1); });
