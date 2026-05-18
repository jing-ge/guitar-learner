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

// ========== Round 48 snap helpers (与 essentia-engine.ts 对齐) ==========
const PC_NAMES_R48 = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function parseChord(name) {
  if (!name || name === 'N') return null;
  let token = name[0];
  let rest = name.slice(1);
  if (rest[0] === '#' || rest[0] === 'b') { token = name.slice(0, 2); rest = name.slice(2); }
  const rootPc = PC_NAMES_R48.indexOf(token);
  if (rootPc < 0) return null;
  const isMinor = rest === 'm' || rest === 'min';
  return { rootPc, isMinor };
}

function formatChord(rootPc, isMinor) {
  return PC_NAMES_R48[((rootPc % 12) + 12) % 12] + (isMinor ? 'm' : '');
}

function buildDiatonicSet(rootPc, scale) {
  const out = new Set();
  if (rootPc < 0) return out;
  const r = ((rootPc % 12) + 12) % 12;
  if (scale === 'major') {
    out.add(formatChord(r, false));
    out.add(formatChord((r + 2) % 12, true));
    out.add(formatChord((r + 4) % 12, true));
    out.add(formatChord((r + 5) % 12, false));
    out.add(formatChord((r + 7) % 12, false));
    out.add(formatChord((r + 9) % 12, true));
    out.add(formatChord((r + 11) % 12, true));
    out.add(formatChord((r + 10) % 12, false));  // bVII
    out.add(formatChord((r + 5) % 12, true));    // iv
  } else {
    out.add(formatChord(r, true));
    out.add(formatChord((r + 2) % 12, true));
    out.add(formatChord((r + 3) % 12, false));
    out.add(formatChord((r + 5) % 12, true));
    out.add(formatChord((r + 7) % 12, true));
    out.add(formatChord((r + 7) % 12, false));
    out.add(formatChord((r + 8) % 12, false));
    out.add(formatChord((r + 10) % 12, false));
    out.add(formatChord(r, false));
  }
  return out;
}

function snapChord(bc, diatonicSet, _keyRootPc, _keyScale) {
  const parsed = parseChord(bc.chord);
  if (!parsed) return bc;
  if (diatonicSet.has(bc.chord)) return bc;
  if (bc.strength >= 0.6) return bc;
  const parsedDiatonic = [...diatonicSet].map(name => ({ name, ...parseChord(name) }));
  let best = null;
  for (const d of parsedDiatonic) {
    const rawDist = Math.abs(parsed.rootPc - d.rootPc);
    const pcDist = Math.min(rawDist, 12 - rawDist);
    const qualityPenalty = (parsed.isMinor === d.isMinor) ? 0 : 1.5;
    const cost = pcDist + qualityPenalty;
    if (!best || cost < best.cost) best = { name: d.name, cost };
  }
  if (!best || best.cost > 3) return bc;
  return { ...bc, chord: best.name, snapped: true, originalChord: bc.chord };
}

function countTop6(arr) {
  // 折叠相邻同根
  const folded = [];
  for (const bc of arr) {
    if (folded.length === 0 || folded[folded.length - 1].chord !== bc.chord) folded.push(bc);
  }
  const counts = new Map();
  for (const f of folded) counts.set(f.chord, (counts.get(f.chord) || 0) + 1);
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6));
}

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
    keyOut = essentia.KeyExtractor(audioVec);

    // Round 48: 在 eval 脚本里应用 snapToDiatonic，对照 raw vs snap
    const PC_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const keyRootPc = PC_NAMES.indexOf(keyOut.key);
    const diatonicSet = buildDiatonicSet(keyRootPc, keyOut.scale);
    const rawTop6 = countTop6(beatChords);
    if (keyRootPc >= 0 && keyOut.strength >= 0.5) {
      beatChords = beatChords.map(bc => snapChord(bc, diatonicSet, keyRootPc, keyOut.scale));
    }
    const snappedTop6 = countTop6(beatChords);
    console.log(`\n[Round 48] snap 前 Top 6: ${JSON.stringify(rawTop6)}`);
    console.log(`[Round 48] snap 后 Top 6: ${JSON.stringify(snappedTop6)}`);
    const snappedCount = beatChords.filter(b => b.snapped).length;
    console.log(`[Round 48] 被 snap 的段数: ${snappedCount} / ${beatChords.length}`);
    

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
