#!/usr/bin/env node
// scripts/canon-real-eval.mjs
// Round 40 实地验证：用真实 D 大调卡农 PCM 跑完整管线
//
// 输入: /tmp/glog/canon.wav (22050Hz, 16-bit, mono, ~355s)
// 流程:
//   1. 滑窗读 FFT_SIZE=8192 样本，hop=2048（~93ms 帧步）
//   2. FFT → magnitude
//   3. chroma + bassChroma（与 chord-detector.ts 对齐）
//   4. HPS 抑制
//   5. EMA 平滑
//   6. 24 个模板余弦匹配（bass-bias） → top1
//   7. 滑窗投票 12 帧 → bestName
//   8. 简化状态机: candidate → confirmed → committed
//   9. 每次 commit: 喂入 round40 key 推断
//
// 输出:
//   - 整体 commit 的和弦序列
//   - round40 key 推断收敛历史
//   - 最终判断: D major ✓/✗

import fs from 'node:fs';
import path from 'node:path';
import { fftRealToComplex, magnitudeSpectrum } from './lib/fft.mjs';

// ============== 常量 ==============
const SR = 22050;
const FFT = 8192;
const HOP = 2048;                // ~93ms 帧步（与 chord-detector AnalyserNode 实际帧率近似）

// ============== 命令行参数 ==============
// 用法: node scripts/canon-real-eval.mjs [wav_path] [expected_key_root_pc] [expected_mode]
// 默认: /tmp/glog/canon.wav, D major
//   pc: 0=C 1=C# 2=D 3=D# 4=E 5=F 6=F# 7=G 8=G# 9=A 10=A# 11=B
//   mode: 'major' | 'minor'
const argv = process.argv.slice(2);
const WAV_PATH = argv[0] || '/tmp/glog/canon.wav';
const EXPECTED_KEY_PC = argv[1] !== undefined ? Number(argv[1]) : 2;
const EXPECTED_KEY_MODE = argv[2] || 'major';

const CHROMA_MIN_FREQ = 70;
const CHROMA_MAX_FREQ = 2000;
const CHROMA_BASS_FREQ = 220;

const HPS_FIFTH = 0.40;
const HPS_THIRD = 0.25;

const EMA_ALPHA = 0.4;
const BASS_BIAS = 0.5;

const ENTER_THR = 0.62;
const SMOOTHING_WINDOW = 12;
const MIN_CONFIRM_FRAMES = 8;      // Round 41: 12 → 8 (~750ms) — 让 confirmed 更早达成
const MIN_COMMIT_FRAMES = 13;      // Round 41: 18 → 13 (~1.2s) — 卡农 2s/chord 实际可用窗口 ~15 帧
const EXIT_THRESHOLD = 0.45;
const EXIT_HOLD_FRAMES = 3;        // Round 41: 6 → 3 (~280ms) — 卡农和弦切换快，6 帧导致漏 commit
const MAX_CHORDS_PER_SECOND = 3;

// ============== Quality 模板 ==============
// 与 chord-detector.ts QUALITY_INTERVALS 对齐（简化版，maj/min 即可覆盖大部分卡农）
// Round 46: 仅 maj/min（与生产对齐，去掉 7/dim/sus 等扩展和弦）
const QUALITY_INTERVALS = {
  maj:  [[0, 1.0], [4, 1.0], [7, 0.5]],
  min:  [[0, 1.0], [3, 1.0], [7, 0.5]],
};
const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const QUALITY_NAMES = { maj: '', min: 'm' };

function chordName(root, q) {
  return SHARP[root] + (QUALITY_NAMES[q] ?? q);
}

function buildTemplates() {
  const templates = [];
  for (let root = 0; root < 12; root++) {
    for (const q of Object.keys(QUALITY_INTERVALS)) {
      const vec = new Array(12).fill(0);
      let normSq = 0;
      for (const [iv, w] of QUALITY_INTERVALS[q]) {
        vec[(root + iv) % 12] = w;
        normSq += w * w;
      }
      templates.push({
        rootPc: root,
        quality: q,
        name: chordName(root, q),
        vec,
        norm: Math.sqrt(normSq),
      });
    }
  }
  return templates;
}

// ============== Wav 读取（mono 16-bit Int16 LE） ==============
function loadWav(path) {
  const buf = fs.readFileSync(path);
  // WAV header 44 bytes 假设
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not WAV');
  const numChannels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  // data chunk
  let off = 12;
  while (off < buf.length - 8) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') {
      const data = buf.subarray(off + 8, off + 8 + size);
      const len = size / (bitsPerSample / 8);
      const pcm = new Float32Array(len);
      for (let i = 0; i < len; i++) pcm[i] = data.readInt16LE(i * 2) / 32768;
      return { pcm, sampleRate, numChannels, bitsPerSample };
    }
    off += 8 + size;
  }
  throw new Error('no data chunk');
}

// ============== 信号处理 ==============
function hannWindow(N) {
  const w = new Float64Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
  return w;
}
const HANN = hannWindow(FFT);

function frameChroma(pcm, start) {
  const frame = new Float64Array(FFT);
  for (let i = 0; i < FFT; i++) {
    const idx = start + i;
    frame[i] = (idx < pcm.length ? pcm[idx] : 0) * HANN[i];
  }
  const fftOut = fftRealToComplex(frame);
  const mag = magnitudeSpectrum(fftOut);

  const binSize = SR / FFT;
  const minBin = Math.max(1, Math.floor(CHROMA_MIN_FREQ / binSize));
  const maxBin = Math.min(mag.length - 1, Math.ceil(CHROMA_MAX_FREQ / binSize));

  const chromaRaw = new Array(12).fill(0);
  const bassRaw = new Array(12).fill(0);
  for (let i = minBin; i <= maxBin; i++) {
    const freq = (i + 0.5) * binSize;
    if (freq < CHROMA_MIN_FREQ || freq > CHROMA_MAX_FREQ) continue;
    const m = 12 * Math.log2(freq / 440) + 69;
    const pcLow = ((Math.floor(m) % 12) + 12) % 12;
    const pcHigh = ((Math.floor(m) + 1) % 12 + 12) % 12;
    const frac = m - Math.floor(m);
    const halfPi = Math.PI / 2;
    const wLow = Math.cos(frac * halfPi) ** 2;
    const wHigh = Math.sin(frac * halfPi) ** 2;
    const amp = mag[i];
    chromaRaw[pcLow] += amp * wLow;
    chromaRaw[pcHigh] += amp * wHigh;
    if (freq < CHROMA_BASS_FREQ) {
      bassRaw[pcLow] += amp * wLow;
      bassRaw[pcHigh] += amp * wHigh;
    }
  }

  // HPS 抑制
  const chroma = new Array(12);
  for (let pc = 0; pc < 12; pc++) {
    chroma[pc] = Math.max(0, chromaRaw[pc] - HPS_FIFTH * chromaRaw[(pc + 7) % 12] - HPS_THIRD * chromaRaw[(pc + 4) % 12]);
  }

  // 归一化
  let maxC = 0; for (const v of chroma) if (v > maxC) maxC = v;
  if (maxC > 1e-9) for (let i = 0; i < 12; i++) chroma[i] /= maxC;
  let maxB = 0; for (const v of bassRaw) if (v > maxB) maxB = v;
  const bassNorm = maxB > 1e-9 ? bassRaw.map(v => v / maxB) : new Array(12).fill(0);

  return { chroma, bassNorm };
}

// ============== 匹配 ==============
function matchTemplates(chroma, bassNorm, templates) {
  let chromaSq = 0;
  for (const v of chroma) chromaSq += v * v;
  const chromaNorm = Math.sqrt(chromaSq);
  if (chromaNorm < 1e-9) return null;

  const scored = templates.map(t => {
    // bass-biased：在模板根音位置放大权重
    const rootBoost = 1 + BASS_BIAS * bassNorm[t.rootPc];
    let dot = 0;
    for (let i = 0; i < 12; i++) {
      const biased = i === t.rootPc ? t.vec[i] * rootBoost : t.vec[i];
      dot += chroma[i] * biased;
    }
    return { ...t, score: dot / (chromaNorm * t.norm) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ============== Round 40 key inference ==============
const DIATONIC_MAJOR_R40 = [[0,'M'],[2,'m'],[4,'m'],[5,'M'],[7,'M'],[9,'m'],[11,'d']];
const DIATONIC_MINOR_R40 = [[0,'m'],[2,'d'],[3,'M'],[5,'m'],[7,'m'],[7,'M'],[8,'M'],[10,'M']];

function simplifyQuality(q) {
  if (['maj','maj7','dom7','M'].includes(q)) return 'M';
  if (['min','m','m7'].includes(q)) return 'm';
  if (q === 'dim' || q === 'd') return 'd';
  if (q === 'sus' || q === 'sus2' || q === 'sus4') return 's';  // Round 44 A
  return 'other';
}

function inferKey(chordHistory) {
  if (chordHistory.length < 3) return null;
  const recent = chordHistory.slice(-16);
  const scores = [];
  for (let root = 0; root < 12; root++) {
    for (const mode of ['major','minor']) {
      const dia = mode === 'major' ? DIATONIC_MAJOR_R40 : DIATONIC_MINOR_R40;
      const set = new Set(dia.map(([o,q]) => `${(root+o)%12}-${q}`));
      // Round 42: tonic / dominant / subdominant pcs for cadence weighting
      const tonicPc = root;
      const dominantPc = (root + 7) % 12;       // V
      const subdominantPc = (root + 5) % 12;     // IV

      let s = 0;
      for (let i = 0; i < recent.length; i++) {
        const ch = recent[i];
        const sq = simplifyQuality(ch.quality);
        if (sq === 'other') continue;
        if (set.has(`${ch.rootPc}-${sq}`)) {
          // 基础顺阶 +1
          let w = 1;
          // 主和弦 I/i +1 额外 = +2 (round40 原有)
          if (ch.rootPc === root && (
            (mode === 'major' && sq === 'M') ||
            (mode === 'minor' && sq === 'm')
          )) w = 2;
          s += w;
        }
        // Round 42-a: dom7 强暗示其下属四度的调
        if (ch.quality === 'dom7' && ch.rootPc === dominantPc) s += 1;
        // Round 42-b: V → I cadence (前后相邻一对 V→I) 加 +3
        if (i > 0) {
          const prev = recent[i - 1];
          const prevSq = simplifyQuality(prev.quality);
          const curIsTonic = ch.rootPc === tonicPc && (
            (mode === 'major' && sq === 'M') ||
            (mode === 'minor' && sq === 'm')
          );
          const prevIsDominant = prev.rootPc === dominantPc && prevSq === 'M';
          if (prevIsDominant && curIsTonic) s += 3;
        }
      }
      // Round 42-c: 首和尾若是 tonic 各加 +2
      if (recent.length >= 4) {
        const first = recent[0];
        const last = recent[recent.length - 1];
        const isTonicChord = (ch) => ch.rootPc === tonicPc && (
          (mode === 'major' && simplifyQuality(ch.quality) === 'M') ||
          (mode === 'minor' && simplifyQuality(ch.quality) === 'm')
        );
        if (isTonicChord(first)) s += 2;
        if (isTonicChord(last)) s += 2;
      }
      scores.push({ root, mode, score: s });
    }
  }
  scores.sort((a, b) => b.score - a.score);
  const ratio = scores[1].score > 0 ? scores[0].score / scores[1].score : Infinity;
  return { ...scores[0], runnerUpRatio: ratio, top: scores.slice(0, 3) };
}

// ============== 主流程 ==============
console.log(`Loading ${WAV_PATH}...`);
const { pcm, sampleRate } = loadWav(WAV_PATH);
console.log(`PCM: ${pcm.length} samples @ ${sampleRate}Hz = ${(pcm.length / sampleRate).toFixed(1)}s`);

const templates = buildTemplates();
console.log(`Templates: ${templates.length}`);

// EMA 状态
let smoothed = new Array(12).fill(0);

// 状态机
let state = 'idle';
let currentChordName = null;
let currentChordFamily = null;
let confSum = 0;
let confCount = 0;
let stateStartFrame = 0;
let exitBelowFrames = 0;
const smoothingWindow = [];
const committedHistory = [];   // { frameIdx, time, name, rootPc, quality }
const keyHistory = [];          // { afterCommit, key, ratio, score }
const recentCommitsTs = [];     // 秒级时间戳

function enterCandidate(name, root, q, frame) {
  state = 'candidate';
  currentChordName = name;
  currentChordFamily = `${root}-${simplifyQuality(q)}`;
  confSum = 0;
  confCount = 0;
  stateStartFrame = frame;
  exitBelowFrames = 0;
}

const FRAME_SEC = HOP / SR;       // ~0.093s/frame
const totalFrames = Math.floor((pcm.length - FFT) / HOP);
console.log(`Will process ${totalFrames} frames (~${(totalFrames * FRAME_SEC).toFixed(1)}s)`);

const t0 = Date.now();
const debugFrames = []; // 记录每帧 top1
const stateTrace = [];
let lastState = 'idle';
for (let f = 0; f < totalFrames; f++) {
  const start = f * HOP;
  const { chroma, bassNorm } = frameChroma(pcm, start);

  // EMA 平滑
  for (let i = 0; i < 12; i++) {
    smoothed[i] = EMA_ALPHA * chroma[i] + (1 - EMA_ALPHA) * smoothed[i];
  }
  let smMax = 0; for (const v of smoothed) if (v > smMax) smMax = v;
  const chromaFinal = smMax > 1e-9 ? smoothed.map(v => v / smMax) : new Array(12).fill(0);

  // 匹配
  const scored = matchTemplates(chromaFinal, bassNorm, templates);
  if (!scored) continue;

  // Round 44 G: 族聚合 — score_family = best.adjusted + 0.3 × second.adjusted
  const famMap = new Map();
  for (const s of scored) {
    const fam = `${s.rootPc}-${simplifyQuality(s.quality)}`;
    let e = famMap.get(fam);
    if (!e) { e = { best: null, second: 0 }; famMap.set(fam, e); }
    if (!e.best || s.score > e.best.score) {
      if (e.best) e.second = Math.max(e.second, e.best.score);
      e.best = s;
    } else if (s.score > e.second) {
      e.second = s.score;
    }
  }
  let topFam = null;
  let topFamScore = 0;
  for (const [, e] of famMap) {
    if (!e.best) continue;
    const fs = e.best.score + 0.3 * e.second;
    if (fs > topFamScore) { topFamScore = fs; topFam = e.best; }
  }
  const top = topFam || scored[0];

  debugFrames.push({ f, t: f * FRAME_SEC, top1: top.name, conf: top.score, top2: scored[1].name, top2Conf: scored[1].score });

  // 投票滑窗
  smoothingWindow.push({ name: top.name, conf: top.score, rootPc: top.rootPc, quality: top.quality });
  if (smoothingWindow.length > SMOOTHING_WINDOW) smoothingWindow.shift();

  // Round 41: 投票按"族" — 同根 + 同三度质量视为一族
  function familyOf(w) {
    const sq = simplifyQuality(w.quality);
    const fam = sq === 'm' ? 'm' : sq === 'd' ? 'd' : 'M';
    return `${w.rootPc}-${fam}`;
  }
  const counts = {};
  for (const w of smoothingWindow) {
    const fam = familyOf(w);
    if (!counts[fam]) counts[fam] = { count: 0, sumConf: 0, bestConf: w.conf, bestName: w.name, rootPc: w.rootPc, quality: w.quality };
    counts[fam].count++;
    counts[fam].sumConf += w.conf;
    if (w.conf > counts[fam].bestConf) {
      counts[fam].bestConf = w.conf;
      counts[fam].bestName = w.name;
      counts[fam].quality = w.quality;
    }
  }
  let bestName = null;
  let bestEntry = null;
  for (const k in counts) {
    if (!bestEntry || counts[k].count > bestEntry.count) {
      bestEntry = counts[k];
      bestName = counts[k].bestName;
    }
  }
  if (!bestEntry) continue;
  const votedConfAvg = bestEntry.sumConf / bestEntry.count;

  // 状态机（Round 41: 按族判断 same/different + 改 exit 条件 = 族切换持续 EXIT_HOLD 帧）
  const tNow = f * FRAME_SEC;
  const bestFamily = bestEntry ? `${bestEntry.rootPc}-${simplifyQuality(bestEntry.quality)}` : null;
  if (state === 'committed' && bestFamily !== currentChordFamily) {
    // Round 41 fix: 新族持续 EXIT_HOLD_FRAMES 帧才允许切换（不依赖 confidence 跌破）
    exitBelowFrames++;
    if (exitBelowFrames >= EXIT_HOLD_FRAMES) {
      enterCandidate(bestName, bestEntry.rootPc, bestEntry.quality, f);
      currentChordFamily = bestFamily;
    }
  } else if (state === 'committed' && bestFamily === currentChordFamily) {
    // 同族 → 重置 exit 计数
    exitBelowFrames = 0;
  } else if (state === 'idle') {
    enterCandidate(bestName, bestEntry.rootPc, bestEntry.quality, f);
    currentChordFamily = bestFamily;
  } else if (bestFamily === currentChordFamily) {
    confSum += votedConfAvg;
    confCount++;
    const heldFrames = confCount;
    const avgConf = confSum / Math.max(1, confCount);

    if (state === 'candidate' && heldFrames >= MIN_CONFIRM_FRAMES && avgConf >= ENTER_THR) {
      state = 'confirmed';
    }
    if (state === 'confirmed' && heldFrames >= MIN_COMMIT_FRAMES && avgConf >= ENTER_THR) {
      // 速率限制
      while (recentCommitsTs.length > 0 && tNow - recentCommitsTs[0] > 1.0) recentCommitsTs.shift();
      if (recentCommitsTs.length < MAX_CHORDS_PER_SECOND) {
        state = 'committed';
        recentCommitsTs.push(tNow);
        committedHistory.push({
          frame: f,
          time: tNow,
          name: bestEntry.rootPc !== undefined ? chordName(bestEntry.rootPc, bestEntry.quality) : bestName,
          rootPc: bestEntry.rootPc,
          quality: bestEntry.quality,
        });
        if (committedHistory.length < 8) console.log(`  → commit #${committedHistory.length} at t=${tNow.toFixed(1)}s ${bestName} (held ${heldFrames} frames)`);
        // 跑 key 推断
        const k = inferKey(committedHistory.map(h => ({ rootPc: h.rootPc, quality: h.quality })));
        if (k) {
          keyHistory.push({
            afterCommit: committedHistory.length,
            key: `${SHARP[k.root]} ${k.mode}`,
            score: k.score,
            ratio: k.runnerUpRatio,
            top: k.top.map(t => `${SHARP[t.root]} ${t.mode}=${t.score}`).join(' / '),
          });
        }
      }
    }
  } else {
    enterCandidate(bestName, bestEntry.rootPc, bestEntry.quality, f);
  }

  if (state !== lastState) {
    stateTrace.push({ t: tNow, from: lastState, to: state, chord: currentChordName, fam: currentChordFamily });
    lastState = state;
  }
}

const elapsed = Date.now() - t0;
console.log(`\nProcessed in ${(elapsed/1000).toFixed(1)}s`);

// === 状态变迁前 30 个 ===
console.log(`\n=== State transitions (前 30) ===`);
for (const s of stateTrace.slice(0, 30)) {
  console.log(`  t=${s.t.toFixed(1)}s  ${s.from} → ${s.to}  chord=${s.chord} fam=${s.fam}`);
}
console.log(`  总状态变迁 ${stateTrace.length} 次`);

// === 每 50 帧 (~4.6s) 输出一次 top1 ===
console.log(`\n=== 每 ~4.6 秒采样一次 top1 ===`);
for (let i = 0; i < debugFrames.length; i += 50) {
  const d = debugFrames[i];
  console.log(`  t=${d.t.toFixed(1)}s  top1=${d.top1}(${d.conf.toFixed(2)})  top2=${d.top2}(${d.top2Conf.toFixed(2)})`);
}

// === top1 直方图（看哪些和弦最多被识别） ===
const top1Hist = {};
for (const d of debugFrames) top1Hist[d.top1] = (top1Hist[d.top1] || 0) + 1;
const sorted = Object.entries(top1Hist).sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(`\n=== Top1 频次 (top-15 chord) ===`);
for (const [name, count] of sorted) {
  const pct = (count * 100 / debugFrames.length).toFixed(1);
  console.log(`  ${name.padEnd(8)} ${count.toString().padStart(4)}帧 (${pct}%)`);
}

// === 平均 confidence ===
const avgConf = debugFrames.reduce((a, d) => a + d.conf, 0) / debugFrames.length;
console.log(`\n  平均 top1 confidence: ${avgConf.toFixed(3)}  (commit 阈值=${ENTER_THR})`);

// === Round 40 直接拿 top1 跑 key 推断（绕过 state machine commit）===
console.log(`\n=== Round 40 旁路：直接用 top1 序列做 key 推断 ===`);
// 每 ~1s 取一次 top1（避免帧内噪声），并要求 conf > 0.6
const downsampleStride = Math.floor(1.0 / FRAME_SEC); // ~11 frames = 1s
const topSeq = [];
for (let i = 0; i < debugFrames.length; i += downsampleStride) {
  const d = debugFrames[i];
  if (d.conf < 0.6) continue;
  // 解析 d.top1 → 找 template
  const tpl = templates.find(t => t.name === d.top1);
  if (!tpl) continue;
  topSeq.push({ rootPc: tpl.rootPc, quality: tpl.quality, name: d.top1, t: d.t });
}
console.log(`  采样得 ${topSeq.length} 个 top1（>0.6 confidence，每 ~1s 一个）`);

// 每 5 个一次 inferKey
const r40Trace = [];
for (let i = 5; i <= topSeq.length; i++) {
  const k = inferKey(topSeq.slice(0, i));
  if (k) r40Trace.push({ n: i, t: topSeq[i-1].t, key: `${SHARP[k.root]} ${k.mode}`, score: k.score, ratio: k.runnerUpRatio });
}
console.log(`\n  Key 推断时序（n=5,10,20,30,...）:`);
for (const r of r40Trace.filter((_, i) => i === 0 || i === r40Trace.length-1 || r40Trace[i].n % 5 === 0)) {
  const ok = r.key === 'D major' ? '✅' : '';
  console.log(`    t=${r.t.toFixed(1)}s n=${r.n.toString().padStart(3)} ${r.key.padEnd(10)} score=${r.score} ratio=${r.ratio.toFixed(3)} ${ok}`);
}

const expectedKeyName = `${SHARP[EXPECTED_KEY_PC]} ${EXPECTED_KEY_MODE}`;
const dMajorR40 = r40Trace.filter(r => r.key === expectedKeyName).length;
console.log(`\n  ${expectedKeyName} 在 ${r40Trace.length} 次推断中占 ${dMajorR40} 次 (${(dMajorR40*100/Math.max(1,r40Trace.length)).toFixed(1)}%)`);

// ============ 和弦准确率评估（基于命令行 ground truth key）============
// 动态构建调内顺阶（major: I ii iii IV V vi vii°; minor: i ii° III iv v VI VII）
const DIATONIC_OFFSETS_MAJOR = [[0,'M'],[2,'m'],[4,'m'],[5,'M'],[7,'M'],[9,'m'],[11,'d']];
const DIATONIC_OFFSETS_MINOR = [[0,'m'],[2,'d'],[3,'M'],[5,'m'],[7,'m'],[8,'M'],[10,'M']];

const diatonicOffsets = EXPECTED_KEY_MODE === 'major' ? DIATONIC_OFFSETS_MAJOR : DIATONIC_OFFSETS_MINOR;
const DIATONIC_SET = new Set(diatonicOffsets.map(([o, q]) => `${(EXPECTED_KEY_PC + o) % 12}-${q}`));
// 最常用 6 和弦 = 顺阶里去掉 vii° / minor 的 ii°（diminished 在通俗音乐里少见）
const COMMON_OFFSETS = diatonicOffsets.filter(([_, q]) => q !== 'd');
const COMMON_EXPECTED = new Set(COMMON_OFFSETS.map(([o, q]) => `${(EXPECTED_KEY_PC + o) % 12}-${q}`));

let diatonicHits = 0;
let commonHits = 0;
let nearMissCount = 0; // 同根但 quality 错（B→Bm）
const wrongList = [];

for (const h of committedHistory) {
  const sq = simplifyQuality(h.quality);
  const key = `${h.rootPc}-${sq}`;
  if (DIATONIC_SET.has(key)) diatonicHits++;
  if (COMMON_EXPECTED.has(key)) commonHits++;

  // near miss: root 在期望集中但 quality 错（如 11-M B 应为 11-m Bm）
  const rootInExpected = [...COMMON_EXPECTED].some(k => k.startsWith(`${h.rootPc}-`));
  if (rootInExpected && !COMMON_EXPECTED.has(key)) {
    nearMissCount++;
    wrongList.push({ name: h.name, expected: `根 ${SHARP[h.rootPc]} 但 quality 不符` });
  } else if (!rootInExpected) {
    wrongList.push({ name: h.name, expected: `根 ${SHARP[h.rootPc]} 不在 ${expectedKeyName} 常用 6 和弦内` });
  }
}

console.log(`\n=== 和弦识别准确率（ground truth = ${expectedKeyName}）===`);
console.log(`  总 commit 数: ${committedHistory.length}`);
console.log(`  落在调内顺阶: ${diatonicHits} (${(diatonicHits*100/committedHistory.length).toFixed(1)}%)`);
console.log(`  落在常用 6 和弦（去除 dim）: ${commonHits} (${(commonHits*100/committedHistory.length).toFixed(1)}%)`);
console.log(`  Near miss (根对 quality 错): ${nearMissCount}`);
const wrongOut = committedHistory.length - commonHits;
console.log(`  完全错: ${wrongOut} (${(wrongOut*100/committedHistory.length).toFixed(1)}%)`);

// 错答前 10
const wrongHist = {};
for (const w of wrongList) wrongHist[w.name] = (wrongHist[w.name] || 0) + 1;
const sortedWrong = Object.entries(wrongHist).sort((a,b) => b[1]-a[1]).slice(0, 10);
if (sortedWrong.length) {
  console.log(`\n  错/Near-miss top 10:`);
  for (const [n, c] of sortedWrong) console.log(`    ${n.padEnd(8)} ×${c}`);
}
console.log(`\n=== 全部 committed chords (${committedHistory.length}) ===`);
committedHistory.forEach((h, i) => {
  console.log(`  [${i+1}] t=${h.time.toFixed(1)}s  ${h.name}`);
});

console.log(`\n=== Key 推断收敛历史 ===`);
console.log(`(after each commit)\n`);
keyHistory.forEach(k => {
  const okFlag = k.key === expectedKeyName ? '✅' : '';
  console.log(`  n=${k.afterCommit.toString().padStart(2)} ${k.key.padEnd(10)} score=${k.score.toString().padStart(2)} ratio=${k.ratio.toFixed(3)} ${okFlag}  top3: ${k.top}`);
});

const finalKey = keyHistory.length > 0 ? keyHistory[keyHistory.length - 1] : null;
console.log(`\n=== 最终判断 ===`);
if (finalKey) {
  const isOk = finalKey.key === expectedKeyName;
  console.log(`  最后推断: ${finalKey.key} ratio=${finalKey.ratio.toFixed(3)}`);
  console.log(`  Ground truth: ${expectedKeyName}`);
  console.log(`  ${isOk ? '✅ 正确' : '❌ 错误'}`);
} else {
  console.log(`  没有产生 key 推断（commit 太少）`);
}

// 统计：ground truth key 在 keyHistory 中出现多少次
const gtCount = keyHistory.filter(k => k.key === expectedKeyName).length;
console.log(`\n  ${expectedKeyName} 在 ${keyHistory.length} 次推断中占 ${gtCount} 次 (${(gtCount*100/Math.max(1,keyHistory.length)).toFixed(1)}%)`);

// 推断分布 top
const inferredDist = {};
for (const k of keyHistory) inferredDist[k.key] = (inferredDist[k.key] || 0) + 1;
const distSorted = Object.entries(inferredDist).sort((a,b) => b[1]-a[1]).slice(0, 5);
console.log(`\n  推断分布 top-5:`);
for (const [name, n] of distSorted) console.log(`    ${name.padEnd(10)} ${n} (${(n*100/keyHistory.length).toFixed(1)}%)`);
