#!/usr/bin/env node
// scripts/progression-eval.mjs
//
// Round 59.1 验证: 用真实 wav 测和弦走向识别 + 跨调匹配
//
// 流程:
//   1. wav → Essentia: ChordsDetectionBeats + KeyExtractor + RhythmExtractor
//   2. snapToDiatonic 后处理 (R48)
//   3. R59.1 summarizeChords 跨大调/关系小调跑经典走向匹配
//   4. 输出: 主调判断 / 翻转情况 / 经典走向命中 / 走向序列
//
// 用法: node scripts/progression-eval.mjs [wav_path] [expected_root_pc] [expected_scale]

import fs from 'node:fs';
import process from 'node:process';
import pkg from 'essentia.js';
import wavefilePkg from 'wavefile';
import { execSync } from 'node:child_process';

const { Essentia, EssentiaWASM } = pkg;
const { WaveFile } = wavefilePkg;

const WAV_PATH = process.argv[2] || '/tmp/glog/canon.wav';
const EXPECTED_KEY = process.argv[3] || 'D';
const EXPECTED_SCALE = process.argv[4] || 'major';

// ============== 编译 R59.1 算法 ==============
console.log('Compiling R59.1 algorithm modules...');
execSync('npx esbuild src/components/ChordSummaryCard.tsx --format=esm --target=es2020 --outfile=/tmp/csc-eval.mjs --bundle 2>&1', { encoding: 'utf8' });
const { summarizeChords } = await import('/tmp/csc-eval.mjs');

// ============== Helper ==============
function readWavToFloat32(filePath, targetSR = 44100) {
  const wav = new WaveFile(fs.readFileSync(filePath));
  wav.toSampleRate(targetSR);
  wav.toBitDepth('32f');
  let samples = wav.getSamples();
  if (Array.isArray(samples) && Array.isArray(samples[0])) samples = samples[0];
  return new Float32Array(samples);
}

const PC_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function parseRootPc(name) {
  if (!name || name === 'N') return -1;
  let token = name[0];
  let rest = name.slice(1);
  if (rest[0] === '#' || rest[0] === 'b') { token = name.slice(0, 2); rest = name.slice(2); }
  const rootPc = PC_NAMES.indexOf(token);
  return rootPc;
}

// ============== Main ==============
async function main() {
  console.log(`\n=== Round 59.1 Progression Eval ===`);
  console.log(`File: ${WAV_PATH}`);
  console.log(`Expected key: ${EXPECTED_KEY} ${EXPECTED_SCALE}\n`);

  console.log('[1/4] Reading wav + resample...');
  const audio = readWavToFloat32(WAV_PATH, 44100);
  console.log(`  ✓ ${(audio.length / 44100).toFixed(2)}s @ 44100Hz`);

  console.log('[2/4] Init Essentia...');
  let wasm = EssentiaWASM;
  if (typeof wasm.then === 'function') wasm = await wasm;
  if (wasm.EssentiaWASM) wasm = wasm.EssentiaWASM;
  const essentia = new Essentia(wasm);
  console.log(`  ✓ v${essentia.version}`);

  console.log('[3/4] Run Essentia (RhythmExtractor + TonalExtractor + ChordsDetectionBeats + KeyExtractor)...');
  const audioVec = essentia.arrayToVector(audio);
  let rhythm, tonal, chordsBeats, keyOut;

  try {
    rhythm = essentia.RhythmExtractor2013(audioVec, 208, 'degara', 40);
    const ticksJs = Array.from(essentia.vectorToArray(rhythm.ticks));
    tonal = essentia.TonalExtractor(audioVec, 4096, 2048, 440);

    let beatChords = [];
    if (ticksJs.length >= 2) {
      chordsBeats = essentia.ChordsDetectionBeats(
        tonal.hpcp, rhythm.ticks, 'interbeat_median', 2048, 44100,
      );
      const cnt = chordsBeats.chords.size();
      const strengthJs = Array.from(essentia.vectorToArray(chordsBeats.strength));
      for (let i = 0; i < cnt; i++) {
        beatChords.push({
          startSec: ticksJs[i] ?? 0,
          endSec: ticksJs[i + 1] ?? ticksJs[i] ?? 0,
          chord: chordsBeats.chords.get(i),
          strength: strengthJs[i] ?? 0,
        });
      }
    }

    keyOut = essentia.KeyExtractor(audioVec);

    console.log(`  ✓ BPM: ${rhythm.bpm.toFixed(1)}`);
    console.log(`  ✓ Key: ${keyOut.key} ${keyOut.scale} (strength ${(keyOut.strength * 100).toFixed(1)}%)`);
    console.log(`  ✓ Beat-aligned chords: ${beatChords.length}`);

    // R48 snap-to-diatonic 后处理 (复用与 ListenPage 相同逻辑)
    // 此处简化: 不做 snap, 直接拿 raw chord 序列给 summarizeChords
    // (snap 已经在 essentia-engine.analyzeRecording 内做, 但 eval 脚本不走那层)

    console.log('\n[4/4] Run R59.1 summarizeChords (跨关系大小调匹配)...');

    // 转 ListenPage history 格式
    const history = beatChords.map(bc => ({
      name: bc.chord || 'N',
      chordId: bc.chord || 'N',
    }));

    const keyRootPc = parseRootPc(keyOut.key);
    const expectedRootPc = parseRootPc(EXPECTED_KEY);

    if (keyRootPc < 0) {
      console.error('❌ Failed to parse Essentia key:', keyOut.key);
      process.exit(1);
    }

    const summary = summarizeChords(history, keyRootPc, keyOut.scale);

    // ============ 输出 ============
    console.log(`\n--- Essentia 原判 ---`);
    console.log(`  ${keyOut.key} ${keyOut.scale === 'major' ? '大调' : '小调'} (strength ${(keyOut.strength * 100).toFixed(1)}%)`);

    console.log(`\n--- R59.1 跨调匹配后 ---`);
    if (summary.recommendedKey) {
      const rk = summary.recommendedKey;
      const rkName = `${PC_NAMES[rk.rootPc]} ${rk.scale === 'major' ? '大调' : '小调'}`;
      console.log(`  推荐主调: ${rkName}`);
      const flipped = rk.rootPc !== keyRootPc || rk.scale !== keyOut.scale;
      console.log(`  ${flipped ? '🔄 翻转 (原判被纠正)' : '✓ 原判保留'}`);
    } else {
      console.log(`  无 recommendedKey (无匹配 / 走 fallback)`);
    }

    console.log(`\n--- 期望判断 ---`);
    const correctKey = summary.recommendedKey
      && summary.recommendedKey.rootPc === expectedRootPc
      && summary.recommendedKey.scale === EXPECTED_SCALE;
    if (correctKey) {
      console.log(`  ✅ 推荐主调与期望一致 (${EXPECTED_KEY} ${EXPECTED_SCALE})`);
    } else {
      console.log(`  ❌ 推荐主调与期望不符 (期望: ${EXPECTED_KEY} ${EXPECTED_SCALE})`);
    }

    console.log(`\n--- 经典走向匹配 ---`);
    if (summary.classicMatches.length === 0) {
      console.log('  (无经典走向匹配)');
    } else {
      for (const m of summary.classicMatches) {
        const p = m.progression;
        console.log(`  • ${p.id} (${p.roman}) "${p.nickname}" ×${m.count}`);
        console.log(`    实际和弦: ${m.chords.join(' → ')}`);
        console.log(`    💡 ${p.description}`);
      }
    }

    console.log(`\n--- 重复 4-chord 走向 (前 5) ---`);
    if (summary.progressions.length === 0) {
      console.log('  (无重复 4-chord 走向)');
    } else {
      for (const p of summary.progressions.slice(0, 5)) {
        console.log(`  ${p.chords.join(' → ')} ×${p.count}`);
      }
    }

    console.log(`\n--- Top 6 高频和弦 ---`);
    summary.uniqueChords.forEach(c => {
      console.log(`  ${c.name.padEnd(4)} (${c.roman.padEnd(8)}) ×${c.count}`);
    });

    console.log(`\n--- 折叠后总段数 ---`);
    console.log(`  ${summary.totalFolded} 段`);

  } finally {
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

main().catch(err => { console.error('❌ Failed:', err); process.exit(2); });
