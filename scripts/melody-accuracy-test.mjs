#!/usr/bin/env node
// scripts/melody-accuracy-test.mjs
//
// Round 53 第 0 任务: 评估 R51 主旋律识别准确率
//
// 测试方法:
//   1. 合成 5 段带 ground truth 的清唱 wav (不同复杂度)
//   2. 跑 PitchMelodia (R51 算法)
//   3. 跑 postprocessMelody (R51 后处理)
//   4. 对比识别音符 vs ground truth, 算准确率指标
//
// 测试场景:
//   1. 简单单音 5 个 (C4 D4 E4 F4 G4)
//   2. "两只老虎" 14 音 (C4 C4 D4 E4 ...)
//   3. C 大调音阶 (C4 D4 E4 F4 G4 A4 B4 C5) - 含半音邻近
//   4. 含休止符 (C4 _ C4 _ E4)
//   5. 八度跳跃 (C4 C5 C4 G4)

import fs from 'node:fs';
import pkg from 'essentia.js';
import wavefilePkg from 'wavefile';
import { execSync } from 'node:child_process';

const { Essentia, EssentiaWASM } = pkg;
const { WaveFile } = wavefilePkg;

const SR = 44100;
const NOTE_FREQS = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.26,
};

function midiFromName(name) {
  const m = name.match(/^([A-G]#?)(\d)$/);
  if (!m) return -1;
  const pc = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].indexOf(m[1]);
  const oct = parseInt(m[2]);
  return (oct + 1) * 12 + pc;
}

/** 合成单音 sine + 包络. 加 vibrato 模拟真实人声 */
function synthNotes(sequence, bpm = 120, useVibrato = false) {
  const noteDur = 60 / bpm;
  const totalSamples = Math.ceil(sequence.length * noteDur * SR);
  const buf = new Float32Array(totalSamples);

  for (let i = 0; i < sequence.length; i++) {
    const noteName = sequence[i];
    if (noteName === '_') continue;  // 休止符
    const freq = NOTE_FREQS[noteName];
    if (!freq) { console.warn('未知音名:', noteName); continue; }
    const startSample = Math.floor(i * noteDur * SR);
    const endSample = Math.floor((i + 0.85) * noteDur * SR);  // 85% 持续, 15% 间隔
    for (let s = startSample; s < endSample; s++) {
      const t = (s - startSample) / SR;
      const dur = (endSample - startSample) / SR;
      let actualFreq = freq;
      if (useVibrato) {
        // 5Hz 颤音, ±15 cents
        actualFreq *= Math.pow(2, 0.015 / 12 * Math.sin(2 * Math.PI * 5 * t));
      }
      const phase = t * actualFreq * 2 * Math.PI;
      const env = Math.min(1, t * 20) * Math.min(1, (dur - t) * 20);
      buf[s] = 0.3 * env * Math.sin(phase);
    }
  }
  return { buf, durationSec: totalSamples / SR };
}

function saveWav(buf, path) {
  const wav = new WaveFile();
  wav.fromScratch(1, SR, '32f', buf);
  fs.writeFileSync(path, wav.toBuffer());
}

// 读 postprocessMelody (esbuild 编译)
execSync('npx esbuild src/audio/melodyPostprocess.ts --format=esm --target=es2020 --outfile=/tmp/mpp.mjs', { encoding: 'utf8' });
const { postprocessMelody } = await import('/tmp/mpp.mjs');

// Essentia 初始化
let wasm = EssentiaWASM;
if (typeof wasm.then === 'function') wasm = await wasm;
if (wasm.EssentiaWASM) wasm = wasm.EssentiaWASM;
const essentia = new Essentia(wasm);

// 跑 PitchMelodia + postprocess + 评估准确率
function evalMelody(audioBuf, expectedSeq, scenarioName) {
  const audioVec = essentia.arrayToVector(audioBuf);
  const result = essentia.PitchMelodia(audioVec);
  const pitchHz = Array.from(essentia.vectorToArray(result.pitch));
  audioVec.delete?.();
  result.pitch.delete?.();
  result.pitchConfidence.delete?.();

  const detected = postprocessMelody(pitchHz);

  // 期望: 过滤掉 '_' 拿到非休止符的音名序列
  const expectedNotes = expectedSeq.filter(n => n !== '_');

  // 评估: 音符序列匹配, 长度 + 每个位置 noteName 是否对
  const lenDiff = Math.abs(detected.length - expectedNotes.length);
  let nameHits = 0;
  let octaveCorrect = 0;
  const compareLen = Math.min(detected.length, expectedNotes.length);
  for (let i = 0; i < compareLen; i++) {
    if (detected[i].noteName === expectedNotes[i]) nameHits++;
    // 检查同 pitch class (忽略八度)
    const detPc = detected[i].midi % 12;
    const expPc = midiFromName(expectedNotes[i]) % 12;
    if (detPc === expPc) octaveCorrect++;
  }

  console.log(`\n[${scenarioName}]`);
  console.log(`  期望: ${expectedNotes.join(' ')} (${expectedNotes.length} 音)`);
  console.log(`  识别: ${detected.map(n => n.noteName).join(' ')} (${detected.length} 音)`);
  console.log(`  长度差: ${lenDiff}`);
  console.log(`  音名命中: ${nameHits}/${compareLen} (${(nameHits/compareLen*100).toFixed(1)}%)`);
  console.log(`  pitch class 命中 (忽略八度): ${octaveCorrect}/${compareLen} (${(octaveCorrect/compareLen*100).toFixed(1)}%)`);

  return { nameHits, octaveCorrect, total: compareLen, lenDiff };
}

console.log('=== Round 53 第 0 任务: R51 主旋律识别准确率评估 ===\n');

const scenarios = [
  { name: '1. 简单单音 5 个', seq: ['C4','D4','E4','F4','G4'], vibrato: false },
  { name: '2. 两只老虎 14 音', seq: ['C4','C4','D4','E4','C4','C4','D4','E4','E4','F4','G4','E4','F4','G4'], vibrato: false },
  { name: '3. C 大调音阶上行', seq: ['C4','D4','E4','F4','G4','A4','B4','C5'], vibrato: false },
  { name: '4. 含休止符', seq: ['C4','_','C4','_','E4','_','G4'], vibrato: false },
  { name: '5. 八度跳跃', seq: ['C4','C5','C4','G4','G3','G4'], vibrato: false },
  { name: '6. 简单旋律 + 颤音模拟 (5Hz ±15 cents, 模拟人声)', seq: ['C4','D4','E4','F4','G4'], vibrato: true },
];

const results = [];
for (const sc of scenarios) {
  const { buf } = synthNotes(sc.seq, 120, sc.vibrato);
  const r = evalMelody(buf, sc.seq, sc.name);
  results.push({ name: sc.name, ...r });
}

// 总结
console.log('\n=== 总结 ===');
let totalHits = 0, totalCount = 0, totalOctave = 0;
for (const r of results) {
  totalHits += r.nameHits;
  totalCount += r.total;
  totalOctave += r.octaveCorrect;
}
console.log(`音名命中 (含八度): ${totalHits}/${totalCount} = ${(totalHits/totalCount*100).toFixed(1)}%`);
console.log(`pitch class 命中 (忽略八度): ${totalOctave}/${totalCount} = ${(totalOctave/totalCount*100).toFixed(1)}%`);

console.log(`\n=== Oracle R53 门槛 ===`);
const overallAccuracy = totalHits / totalCount * 100;
if (overallAccuracy >= 70) {
  console.log(`✅ ${overallAccuracy.toFixed(1)}% ≥ 70%, Round 53 可继续`);
} else if (overallAccuracy >= 50) {
  console.log(`⚠️  ${overallAccuracy.toFixed(1)}% 在 50-70% 之间, 可继续但 UI 必须强警告`);
} else {
  console.log(`❌ ${overallAccuracy.toFixed(1)}% < 50%, Round 53 应取消, 转去做 R51 后处理改进`);
}
