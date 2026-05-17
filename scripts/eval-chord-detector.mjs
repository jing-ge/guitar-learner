// scripts/eval-chord-detector.mjs
// 离线合成评测：把 108 个"理想 chroma"喂回模板匹配，量化 top-1/top-3 准确率
// 不依赖麦克风、不依赖 chord-detector.ts；独立复刻匹配逻辑。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthChordChroma, voicingFor } from './lib/synth-chroma.mjs';
import { synthPcm, pcmToChroma } from './lib/pcm-chroma.mjs';
import { createPrng } from './lib/prng.mjs';

const args = process.argv.slice(2);
const seedArg = args.indexOf('--seed');
const SEED = seedArg >= 0 ? parseInt(args[seedArg + 1], 10) : 42;
const UPDATE_BASELINE = args.includes('--update-baseline');
const CHECK_BASELINE = args.includes('--check-baseline');
const rand = createPrng(SEED);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = path.join(__dirname, 'eval-baseline.json');

const SHARP_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const QUALITY_INTERVALS = {
  maj:   [[0, 1.0], [4, 1.0], [7, 0.5]],
  min:   [[0, 1.0], [3, 1.0], [7, 0.5]],
  '7':   [[0, 1.0], [4, 1.0], [7, 0.5], [10, 0.6]],
  maj7:  [[0, 1.0], [4, 1.0], [7, 0.5], [11, 0.6]],
  m7:    [[0, 1.0], [3, 1.0], [7, 0.5], [10, 0.6]],
  sus2:  [[0, 1.0], [2, 0.9], [7, 0.5]],
  sus4:  [[0, 1.0], [5, 0.9], [7, 0.5]],
  dim:   [[0, 1.0], [3, 1.0], [6, 0.7]],
  aug:   [[0, 1.0], [4, 1.0], [8, 0.7]],
  // Round 21: 新增 4 个 quality（14 度在 buildVec 里 mod 12）
  m7b5:  [[0, 1.0], [3, 1.0], [6, 0.7], [10, 0.6]],
  '6':   [[0, 1.0], [4, 1.0], [7, 0.5], [9, 0.6]],
  '9':   [[0, 1.0], [4, 1.0], [7, 0.5], [10, 0.6], [14, 0.5]],
  add9:  [[0, 1.0], [4, 1.0], [7, 0.5], [14, 0.5]],
};

const QUALITIES = Object.keys(QUALITY_INTERVALS);

function nameFor(root, q) {
  const r = SHARP_NAMES[root];
  switch (q) {
    case 'maj': return r;
    case 'min': return r + 'm';
    case '7': return r + '7';
    case 'maj7': return r + 'maj7';
    case 'm7': return r + 'm7';
    case 'sus2': return r + 'sus2';
    case 'sus4': return r + 'sus4';
    case 'dim': return r + 'dim';
    case 'aug': return r + 'aug';
    case 'm7b5': return r + 'm7b5';
    case '6': return r + '6';
    case '9': return r + '9';
    case 'add9': return r + 'add9';
  }
}

function buildVec(root, q) {
  const v = new Array(12).fill(0);
  for (const [iv, w] of QUALITY_INTERVALS[q]) v[(root + iv) % 12] = w;
  return v;
}

function buildTemplates() {
  const out = [];
  for (let root = 0; root < 12; root++) {
    for (const q of QUALITIES) {
      const vec = buildVec(root, q);
      let sq = 0;
      for (let i = 0; i < 12; i++) sq += vec[i] * vec[i];
      out.push({ root, q, name: nameFor(root, q), vec, norm: Math.sqrt(sq) });
    }
  }
  return out;
}

function normalize(v) {
  let max = 0;
  for (let i = 0; i < 12; i++) if (v[i] > max) max = v[i];
  if (max < 1e-9) return v.slice();
  return v.map(x => x / max);
}

function l2(v) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

// 模拟当前 ChordDetector：cosine 匹配，无 bass 偏置（因为输入是理想 chroma，没有低频段信息）
function matchTopK(chroma, templates, k = 3) {
  const chromaN = l2(chroma);
  if (chromaN < 1e-9) return [];
  const scores = templates.map(t => {
    let dot = 0;
    for (let i = 0; i < 12; i++) dot += chroma[i] * t.vec[i];
    return { name: t.name, root: t.root, q: t.q, score: dot / (chromaN * t.norm) };
  });
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, k);
}

// 噪声/泛音注入
function injectNoise(chroma, root, noiseAmp = 0.2, fifthHarmonic = 0.5) {
  const noisy = chroma.slice();
  for (let i = 0; i < 12; i++) {
    noisy[i] += (rand() - 0.5) * 2 * noiseAmp;
    if (noisy[i] < 0) noisy[i] = 0;
  }
  // 加完全五度泛音
  noisy[(root + 7) % 12] += fifthHarmonic * chroma[root];
  return normalize(noisy);
}

// 运行评测
function runEval(label, makeInput) {
  const templates = buildTemplates();
  const total = templates.length;
  let top1 = 0, top3 = 0;
  let bestScoreSum = 0, secondRatioSum = 0;
  const fails = [];

  for (const tpl of templates) {
    const input = makeInput(tpl);
    const results = matchTopK(input, templates, 3);
    if (!results.length) { fails.push(`${tpl.name}: no match`); continue; }
    if (results[0].name === tpl.name) top1++;
    if (results.some(r => r.name === tpl.name)) top3++;
    bestScoreSum += results[0].score;
    if (results[1]) secondRatioSum += results[1].score / Math.max(1e-9, results[0].score);
    if (results[0].name !== tpl.name) {
      fails.push(`${tpl.name} -> ${results[0].name} (${results[0].score.toFixed(3)})`);
    }
  }

  console.log(`\n=== ${label} ===`);
  console.log(`top1: ${top1}/${total} (${(top1/total*100).toFixed(1)}%)`);
  console.log(`top3: ${top3}/${total} (${(top3/total*100).toFixed(1)}%)`);
  console.log(`平均最佳分数: ${(bestScoreSum/total).toFixed(3)}`);
  console.log(`平均 second/best 比: ${(secondRatioSum/total).toFixed(3)}`);
  if (fails.length) {
    console.log(`失败/误判 (${fails.length} 条):`);
    fails.slice(0, 12).forEach(f => console.log('  ' + f));
    if (fails.length > 12) console.log(`  ... (省略 ${fails.length - 12} 条)`);
  }
  return { top1, top3, avgBest: bestScoreSum/total, avgSecondRatio: secondRatioSum/total };
}

// ----- 测试场景 -----

// 场景 A: 理想输入（模板向量自己归一化）
const A = runEval('A. 理想 chroma（模板自喂）', tpl => normalize(tpl.vec));

// 场景 B: 加噪 + 五度泛音
const B = runEval('B. 噪声 0.2 + 五度泛音 0.5', tpl => injectNoise(normalize(tpl.vec), tpl.root));

// 场景 C: 仅根音+三音（模拟丢弦/缺音）
const C = runEval('C. 仅根音+三音（缺五音/七音）', tpl => {
  const intervals = QUALITY_INTERVALS[tpl.q];
  const v = new Array(12).fill(0);
  for (let i = 0; i < Math.min(2, intervals.length); i++) {
    const [iv, w] = intervals[i];
    v[(tpl.root + iv) % 12] = w;
  }
  return normalize(v);
});

// 场景 D: 真信号合成（5 谐波 + SNR 20dB 白噪声）
const D = runEval('D. 真信号合成（5 谐波 + SNR 20dB）', tpl => {
  const notes = voicingFor(tpl.root, tpl.q);
  return synthChordChroma(notes, { snrDb: 20, rand });
});

// 场景 E: PCM → FFT → chroma 端到端
const E = runEval('E. PCM → FFT → chroma 端到端（SNR 20dB）', tpl => {
  const notes = voicingFor(tpl.root, tpl.q);
  const pcm = synthPcm(notes, { snrDb: 20, rand });
  return pcmToChroma(pcm);
});

console.log('\n=== 汇总 ===');
const summary = { A, B, C, D, E };
console.table(summary);

const TOLERANCE = 0.03; // 3pp

if (UPDATE_BASELINE) {
  const baseline = {
    seed: SEED,
    generatedAt: new Date().toISOString(),
    templates: 156,
    scenarios: Object.fromEntries(
      Object.entries(summary).map(([k, v]) => [k, {
        top1: v.top1,
        top3: v.top3,
        top1Rate: v.top1 / 156,
        top3Rate: v.top3 / 156,
        avgBest: v.avgBest,
      }])
    ),
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
  console.log(`\n✅ Baseline 已写入 ${BASELINE_PATH}`);
  process.exit(0);
}

if (CHECK_BASELINE) {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`❌ baseline 不存在：${BASELINE_PATH}，请先跑 npm run eval:update`);
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  let failures = 0;
  console.log(`\n=== Baseline Check (seed=${SEED}, tolerance=${TOLERANCE * 100}pp) ===`);
  for (const [name, v] of Object.entries(summary)) {
    const base = baseline.scenarios[name];
    if (!base) {
      console.log(`  [${name}] ⚠️ 未在 baseline 中`);
      continue;
    }
    const curTop1Rate = v.top1 / 156;
    const diff = curTop1Rate - base.top1Rate;
    const pass = diff >= -TOLERANCE;
    const arrow = diff >= 0 ? `+${(diff * 100).toFixed(2)}pp` : `${(diff * 100).toFixed(2)}pp`;
    console.log(`  [${name}] top1 ${(curTop1Rate * 100).toFixed(1)}% vs baseline ${(base.top1Rate * 100).toFixed(1)}% (${arrow}) ${pass ? '✅' : '❌ FAIL'}`);
    if (!pass) failures++;
  }
  if (failures > 0) {
    console.error(`\n❌ ${failures} scenario(s) regressed > ${TOLERANCE * 100}pp`);
    process.exit(1);
  } else {
    console.log(`\n✅ All scenarios within tolerance`);
    process.exit(0);
  }
}
