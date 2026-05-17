#!/usr/bin/env node
// scripts/song-fixture-eval.mjs
//
// Round 38: 用一首具体歌曲走向 + 真实吉他 voicing 合成 PCM
// 端到端验证: PCM → chroma → 模板匹配 → key 累积
// 与简化 voicing 对比，定位"用户报告：和弦/定调不准"的根因
//
// 走向选定：vi-IV-I-V (Am-F-C-G) × 4 轮 = 16 chord
// 调性 ground truth: C major
//
// 输出：
//  1. 帧级识别命中率（旧理想 voicing vs 新吉他 voicing）
//  2. 调性收敛时刻 & 最终调性
//  3. 错误模式（混淆矩阵 top）

import { pcmToChroma } from './lib/pcm-chroma.mjs';
import { createPrng } from './lib/prng.mjs';
import { fftRealToComplex, magnitudeSpectrum } from './lib/fft.mjs';

// ============== 参数 ==============
const SR = 22050;
const FFT = 8192;       // 与 pcm-chroma 默认对齐
const SNR_DB = 20;
const SEED = 42;
const HARMONICS = 5;

// 吉他标准调音（6 弦 → 1 弦）
const STRING_MIDI = [40, 45, 50, 55, 59, 64];

/** 真实吉他和弦指法表 (frets[6→1], -1=mute, 0=open) */
const GUITAR_SHAPES = {
  'C':  [-1, 3, 2, 0, 1, 0],
  'G':  [3, 2, 0, 0, 0, 3],
  'D':  [-1, -1, 0, 2, 3, 2],
  'A':  [-1, 0, 2, 2, 2, 0],
  'E':  [0, 2, 2, 1, 0, 0],
  'F':  [1, 3, 3, 2, 1, 1],
  'Am': [-1, 0, 2, 2, 1, 0],
  'Em': [0, 2, 2, 0, 0, 0],
  'Dm': [-1, -1, 0, 2, 3, 1],
};

/** 旧 voicing：根音 + 3rd + 5th 单八度 (复刻 synth-chroma.mjs voicingFor) */
const NAIVE_VOICING = {
  'C':  [48, 52, 55],
  'G':  [55, 59, 62],
  'D':  [50, 54, 57],
  'A':  [57, 61, 64],
  'E':  [52, 56, 59],
  'F':  [53, 57, 60],
  'Am': [57, 60, 64],
  'Em': [52, 55, 59],
  'Dm': [50, 53, 57],
};

function shapeToMidi(frets) {
  const notes = [];
  for (let s = 0; s < 6; s++) {
    if (frets[s] < 0) continue;
    // frets[] 顺序 [6弦, 5弦, ..., 1弦]，STRING_MIDI 也是这个顺序
    notes.push(STRING_MIDI[s] + frets[s]);
  }
  return notes;
}

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function hannWindow(N) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
  return w;
}

/** 合成 PCM 帧 (一帧 ~0.37s @ 8192/22050) */
function synthFramePcm(midiNotes, rand, snrDb = SNR_DB) {
  const pcm = new Float64Array(FFT);
  let sigE = 0;
  for (const midi of midiNotes) {
    const f0 = midiToFreq(midi);
    for (let n = 1; n <= HARMONICS; n++) {
      const f = f0 * n;
      if (f >= SR / 2) break;
      const amp = 1 / (n * n);
      const phase = rand() * 2 * Math.PI;
      const omega = 2 * Math.PI * f / SR;
      for (let i = 0; i < FFT; i++) pcm[i] += amp * Math.sin(omega * i + phase);
      sigE += amp * amp * FFT / 2;
    }
  }
  if (snrDb < 999 && sigE > 0) {
    const nE = sigE / Math.pow(10, snrDb / 10);
    const nStd = Math.sqrt(nE / FFT);
    for (let i = 0; i < FFT; i++) {
      pcm[i] += (rand() + rand() + rand() - 1.5) * nStd * 1.4;
    }
  }
  const w = hannWindow(FFT);
  for (let i = 0; i < FFT; i++) pcm[i] *= w[i];
  return pcm;
}

// ============== 模板（复刻 eval-chord-detector 模板匹配） ==============
const QUALITIES = ['maj', 'min'];
const QUALITY_INTERVALS = { maj: [0, 4, 7], min: [0, 3, 7] };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function chordName(root, q) {
  return q === 'maj' ? SHARP[root] : SHARP[root] + 'm';
}

function buildTemplates() {
  const out = [];
  for (let root = 0; root < 12; root++) {
    for (const q of QUALITIES) {
      const vec = new Array(12).fill(0);
      for (const iv of QUALITY_INTERVALS[q]) vec[(root + iv) % 12] = 1;
      let sq = 0;
      for (let i = 0; i < 12; i++) sq += vec[i] * vec[i];
      out.push({ root, q, name: chordName(root, q), vec, norm: Math.sqrt(sq) });
    }
  }
  return out;
}

function matchTopK(chroma, templates, k = 3) {
  let chromaN = 0;
  for (let i = 0; i < 12; i++) chromaN += chroma[i] * chroma[i];
  chromaN = Math.sqrt(chromaN);
  if (chromaN < 1e-9) return [];
  const scored = templates.map(t => {
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += chroma[i] * t.vec[i];
    return { name: t.name, root: t.root, q: t.q, score: dot / (chromaN * t.norm) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// ============== Key Detector (复刻 ListenPage:189) ==============
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const EVIDENCE_DECAY = 0.95;

function inferKey(histogram) {
  let best = -Infinity;
  let bestRoot = 0;
  let bestMode = 'major';
  for (let root = 0; root < 12; root++) {
    let maj = 0, min = 0;
    for (let i = 0; i < 12; i++) {
      const v = histogram[(root + i) % 12];
      maj += v * MAJOR_PROFILE[i];
      min += v * MINOR_PROFILE[i];
    }
    if (maj > best) { best = maj; bestRoot = root; bestMode = 'major'; }
    if (min > best) { best = min; bestRoot = root; bestMode = 'minor'; }
  }
  return { root: bestRoot, mode: bestMode };
}

// ============== 走向 + 评测 ==============

/** 一首"歌"：Am-F-C-G × 4 = 16 chord, C major */
const SONG = {
  title: 'vi-IV-I-V × 4 (Am-F-C-G)',
  groundTruthKey: { root: 0, mode: 'major', name: 'C major' },
  chords: Array(4).fill(['Am', 'F', 'C', 'G']).flat(),
};

function evalSong(voicingMap, label, keyHistMode = 'root') {
  const rand = createPrng(SEED);
  const templates = buildTemplates();
  const histogram = new Array(12).fill(0);

  const results = [];
  let firstCorrectKeyIdx = -1;

  console.log(`\n=== ${label} (key-hist=${keyHistMode}) ===`);
  for (let i = 0; i < SONG.chords.length; i++) {
    const expected = SONG.chords[i];
    const notes = voicingMap[expected];
    if (!notes) { console.error(`  missing voicing for ${expected}`); continue; }
    const pcm = synthFramePcm(notes, rand);
    const chroma = pcmToChroma(pcm, SR);
    const top = matchTopK(chroma, templates, 3);
    const predicted = top[0]?.name ?? '(none)';
    const score = top[0]?.score ?? 0;
    const correct = predicted === expected;
    results.push({ idx: i, expected, predicted, correct, score, top });

    // key accumulation: 两种模式
    if (keyHistMode === 'root') {
      // 当前生产实现（ListenPage:184）：仅累积已识别和弦的根音
      const predRoot = top[0]?.root ?? -1;
      if (predRoot >= 0) {
        for (let k = 0; k < 12; k++) histogram[k] *= EVIDENCE_DECAY;
        histogram[predRoot] += 1;
      }
    } else if (keyHistMode === 'chroma') {
      // Oracle 建议：直接累积 chroma 向量（保留 3rd/5th 信息）
      for (let k = 0; k < 12; k++) histogram[k] = histogram[k] * EVIDENCE_DECAY + chroma[k];
    }

    if (i + 1 >= 5) {
      const key = inferKey(histogram);
      const keyOk = key.root === SONG.groundTruthKey.root && key.mode === SONG.groundTruthKey.mode;
      if (keyOk && firstCorrectKeyIdx < 0) firstCorrectKeyIdx = i;
    }
  }

  // 统计
  const hits = results.filter(r => r.correct).length;
  const total = results.length;
  console.log(`  和弦识别: ${hits}/${total} (${(hits/total*100).toFixed(1)}%)`);

  // 混淆模式（统计 expected→predicted 错对）
  const confusion = {};
  for (const r of results) {
    if (r.correct) continue;
    const key = `${r.expected}→${r.predicted}`;
    confusion[key] = (confusion[key] || 0) + 1;
  }
  const topErrors = Object.entries(confusion).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topErrors.length) {
    console.log(`  主要错误模式:`);
    for (const [k, v] of topErrors) console.log(`    ${k}: ×${v}`);
  }

  // 最终调性
  const finalKey = inferKey(histogram);
  const keyOk = finalKey.root === SONG.groundTruthKey.root && finalKey.mode === SONG.groundTruthKey.mode;
  const finalKeyName = `${SHARP[finalKey.root]} ${finalKey.mode === 'major' ? '大调' : '小调'}`;
  console.log(`  调性 ground truth: ${SONG.groundTruthKey.name}`);
  console.log(`  调性最终推断: ${finalKeyName} ${keyOk ? '✅' : '❌'}`);
  if (keyOk && firstCorrectKeyIdx >= 0) {
    console.log(`  调性首次稳定于第 ${firstCorrectKeyIdx + 1} 个和弦`);
  }

  // 帧级细节
  console.log(`  帧级细节 (×=错):`);
  let line = '   ';
  for (const r of results) {
    line += r.correct ? `${r.expected} ` : `${r.expected}×${r.predicted} `;
    if (line.length > 70) { console.log(line); line = '   '; }
  }
  if (line.trim()) console.log(line);

  return { hits, total, finalKey, keyOk, firstCorrectKeyIdx };
}

// ============== 主流程 ==============

console.log(`\n🎵 Song: ${SONG.title}`);
console.log(`📊 SNR=${SNR_DB}dB · FFT=${FFT} · SR=${SR} · seed=${SEED}`);
console.log(`🎯 Ground truth chords: ${SONG.chords.join(' ')}`);

// 准备旧 voicing 的 midi 数组（与新接口对齐）
const naive = { ...NAIVE_VOICING };

// 准备新 voicing：从 GUITAR_SHAPES 转 midi
const guitar = {};
for (const [name, frets] of Object.entries(GUITAR_SHAPES)) {
  guitar[name] = shapeToMidi(frets);
}

console.log('\nVoicing 对比:');
for (const ch of ['Am', 'F', 'C', 'G']) {
  const a = naive[ch].join(',');
  const b = guitar[ch].join(',');
  console.log(`  ${ch}: 旧 [${a}] → 新 [${b}]`);
}

const naiveResult = evalSong(naive,   '场景 G1: 理想 3-音 voicing + root-histogram (生产实现)', 'root');
const guitarResult = evalSong(guitar, '场景 G2: 真实吉他 voicing + root-histogram (生产实现)', 'root');
const guitarResultH = evalSong(guitar, '场景 G3: 真实吉他 voicing + chroma-histogram (Oracle H 假设)', 'chroma');

// ============== 对比汇总 ==============
console.log('\n=== 对比汇总 ===');
console.log(`和弦识别命中率: 旧 ${(naiveResult.hits/naiveResult.total*100).toFixed(1)}% → 新 ${(guitarResult.hits/guitarResult.total*100).toFixed(1)}%`);
console.log(`调性最终正确:   旧 ${naiveResult.keyOk ? '✅' : '❌'} → 新 ${guitarResult.keyOk ? '✅' : '❌'}`);

const delta = guitarResult.hits - naiveResult.hits;
if (delta < -2) {
  console.log(`\n⚠️  新 voicing 命中率下降 ${-delta} 个 chord — 这印证了用户报告的"和弦识别不准"`);
  console.log(`   核心问题：detector 模板用单八度 3-音，但用户实际弹的是开放/横按吉他和弦`);
  console.log(`   频谱里多八度根音 + 重复 3rd / 5th 改变 chroma 分布，模板余弦相似度被拉偏`);
}
