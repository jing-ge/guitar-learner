/**
 * 和弦走向总结卡片 (Round 46 抽取自 ListenPage; Round 48: 和弦可点击 → 弹 ChordDiagram modal)
 *
 * 输入：已识别的和弦序列（按时间顺序）
 * 输出：
 *   - 主要和弦 top 6 (折叠相邻同根 → 频次降序 → 罗马数字)
 *   - 重复出现 ≥ 2 次的 4-chord 走向（如 I→V→vi→IV）
 *   - 点和弦名 → 弹出 ChordDiagram 显示按法
 */

import { useState } from 'react';
import { CHORDS } from '../theory/chords';
import {
  CLASSIC_PROGRESSIONS,
  degreesDistance,
  type ClassicProgression,
} from '../data/classicProgressions';
import ChordDiagram from './ChordDiagram';
import { Card, Badge, ChordChain } from './ui';

// Round 64: 用 theory/notes 的 SHARP_NAMES (避免重复定义)
import { SHARP_NAMES } from '../theory/notes';
const FLAT_TO_SHARP_LOCAL: Record<string,string> = { Bb:'A#', Db:'C#', Eb:'D#', Gb:'F#', Ab:'G#' };

const ROMAN_MAJOR = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
const ROMAN_MINOR = ['i', 'bii', 'ii', 'III', 'iii', 'iv', '#iv', 'v', 'VI', 'vi', 'VII', 'vii'];

export function parseRootPc(id: string): number {
  if (!id) return -1;
  let token = id[0];
  if (id[1] === '#' || id[1] === 'b') token = id.slice(0, 2);
  if (token.length === 2 && token[1] === 'b') {
    const mapped = FLAT_TO_SHARP_LOCAL[token];
    if (!mapped) return -1;
    token = mapped;
  }
  return (SHARP_NAMES as readonly string[]).indexOf(token);
}

export function simplifyQuality(q: string): 'M' | 'm' | 'd' | 'aug' | 'other' {
  if (q === 'major' || q === 'maj7' || q === 'dom7' || q === 'sus') return 'M';
  if (q === 'minor' || q === 'min7') return 'm';
  if (q === 'dim') return 'd';
  if (q === 'aug') return 'aug';
  return 'other';
}

export function toRoman(rootPc: number, quality: string, keyRoot: number, keyMode: 'major' | 'minor'): string {
  const interval = ((rootPc - keyRoot) % 12 + 12) % 12;
  const sq = simplifyQuality(quality);
  const baseTable = keyMode === 'major' ? ROMAN_MAJOR : ROMAN_MINOR;
  const symbol = baseTable[interval] ?? '?';
  if (sq === 'm') return symbol.toLowerCase();
  if (sq === 'd') return symbol.toLowerCase() + '°';
  return symbol;
}

export interface ChordSummary {
  uniqueChords: { name: string; count: number; roman: string }[];
  /** Round 59: 经典走向匹配 (1564 / 4536251 / 卡农 等) */
  classicMatches: ClassicMatch[];
  /** 旧字段: 非经典的重复走向 (4-chord 滑窗 ≥ 2 次), 仅当 classicMatches 为空时展示 */
  progressions: { chords: string[]; romans: string[]; count: number }[];
  totalFolded: number;
  /**
   * Round 59.1: 跨关系大小调匹配后的"推荐主调".
   * Essentia 给的 keyScale 可能错判 (大调 vs 关系小调 顺阶集合等价),
   * summarizeChords 内部对原判 + 关系调各跑一遍经典匹配,
   * 命中数多的胜出 → 推荐这个作为主调展示.
   * null = 无 keyRoot 输入或两边都没匹配.
   */
  recommendedKey: { rootPc: number; scale: 'major' | 'minor' } | null;
}

/** Round 59: 经典走向匹配结果 */
export interface ClassicMatch {
  progression: ClassicProgression;
  /** 实际匹配到的和弦名序列 (按时序, 长度 = progression.length) */
  chords: string[];
  /** 出现次数 (同一 progression 在 history 里匹配到几次, 含模糊匹配) */
  count: number;
  /** Round 61: 单位距离 (0=严格, ≤0.3=strong, ≤1.0=weak) */
  unitDist: number;
  /** Round 61: 强度档位, strong=严格或≤0.3, weak=0.3-1.0 */
  strength: 'strong' | 'weak';
}

/**
 * Round 59.1: 在给定调性下匹配经典走向词典.
 * 只匹配 scale 字段与当前 scale 相符的词典 (或 'any').
 *
 * 算法 (与 R59 一致, 只是抽成函数):
 *   1. 找所有主和弦 (I/i) 起手位置
 *   2. 对每条词典 × 每个起手位置, 精确度数串相等
 *   3. 长走向吸收 4-chord 子串 (避免卡农同时显示内部 1564)
 *   4. 聚合 (同 progression.id 计数)
 */
function matchClassicProgressions(
  folded: { name: string; rootPc: number; quality: string }[],
  keyRoot: number,
  scale: 'major' | 'minor',
): ClassicMatch[] {
  // Step 1: 找所有合法起手位置
  // Round 60: 只切 I 起手会漏掉 vi/IV 起手的旋转变体 (如晴天 Em-C-G-D = 6415 vi-IV-I-V),
  //   导致大调侧评分被关系小调侧反超 → 误翻转.
  //   解法: 大调允许 {I, vi, IV} 起手, 小调允许 {i, III, VI} 起手 (词典实际起手度数的并集).
  //   词典里大调侧起手度数: 1564/1645/1465/1456/1451/15634 都是 0(I); 6415/6451 是 9(vi); 4561/4536251 是 5(IV).
  //   小调侧目前 4 条全是 0(i) 起手, 扩到 {3,8} 是对称性预留, 不影响当前匹配.
  const startDegrees: Set<number> = scale === 'major'
    ? new Set([0, 9, 5])      // I / vi / IV
    : new Set([0, 3, 8]);     // i / III / VI
  const iStartIndices: number[] = [];
  for (let i = 0; i < folded.length; i++) {
    const deg = ((folded[i].rootPc - keyRoot) % 12 + 12) % 12;
    if (startDegrees.has(deg)) iStartIndices.push(i);
  }

  // Step 2: Round 61 模糊匹配 — 距离 ≤ 1.0 都收, 分 strong / weak 两档
  //   unitDist ≤ 0.3 → strong (严格相等或邻近半音替换)
  //   0.3 < unitDist ≤ 1.0 → weak (近似匹配, 每位平均错 1 个半音内)
  //   unitDist > 1.0 → 丢弃
  const STRONG_THRESHOLD = 0.3;
  const WEAK_THRESHOLD = 1.0;
  interface RawMatch {
    progression: ClassicProgression;
    chords: string[];
    startIdx: number;
    length: number;
    unitDist: number;
  }
  const rawMatches: RawMatch[] = [];

  for (const prog of CLASSIC_PROGRESSIONS) {
    if (prog.scale !== 'any' && prog.scale !== scale) continue;
    for (const i of iStartIndices) {
      if (i + prog.length > folded.length) continue;
      const window = folded.slice(i, i + prog.length);
      const degrees = window.map(c => ((c.rootPc - keyRoot) % 12 + 12) % 12);
      const total = degreesDistance(degrees, prog.degrees);
      const unitDist = total / prog.length;
      if (unitDist > WEAK_THRESHOLD) continue;
      rawMatches.push({
        progression: prog,
        chords: window.map(w => w.name),
        startIdx: i,
        length: prog.length,
        unitDist,
      });
    }
  }

  // Step 3: 长走向吸收 4-chord 子串 (R61 双判据)
  //   时序包含 + (长走向严格 unitDist ≤ 0.05, 无条件吸收) OR (距离差 ≤ 0.3)
  const absorbed = new Set<number>();
  for (let i = 0; i < rawMatches.length; i++) {
    const a = rawMatches[i];
    if (a.length >= 7) continue;  // 仅短走向可能被吸收
    for (let j = 0; j < rawMatches.length; j++) {
      if (i === j) continue;
      const b = rawMatches[j];
      if (b.length < 7) continue;
      const contained =
        a.startIdx >= b.startIdx && a.startIdx + a.length <= b.startIdx + b.length;
      if (!contained) continue;
      if (b.unitDist <= 0.05 || b.unitDist <= a.unitDist + 0.3) {
        absorbed.add(i);
        break;
      }
    }
  }

  // Step 4: 同 progression.id + 同 startIdx 桶 (±3 帧) 去重, 保留 unitDist 最小
  const bestByBucket = new Map<string, RawMatch>();
  for (let i = 0; i < rawMatches.length; i++) {
    if (absorbed.has(i)) continue;
    const m = rawMatches[i];
    const bucketKey = `${m.progression.id}|${Math.floor(m.startIdx / 3)}`;
    const cur = bestByBucket.get(bucketKey);
    if (!cur || m.unitDist < cur.unitDist) bestByBucket.set(bucketKey, m);
  }

  // Step 5: 聚合 (count = 同 progression.id 出现次数, 保留最小 unitDist 实例的 chords)
  const aggregateMap = new Map<string, ClassicMatch>();
  for (const m of bestByBucket.values()) {
    const strength: 'strong' | 'weak' = m.unitDist <= STRONG_THRESHOLD ? 'strong' : 'weak';
    const existing = aggregateMap.get(m.progression.id);
    if (existing) {
      existing.count++;
      if (m.unitDist < existing.unitDist) {
        existing.unitDist = m.unitDist;
        existing.chords = m.chords;
        existing.strength = strength;
      }
    } else {
      aggregateMap.set(m.progression.id, {
        progression: m.progression,
        chords: m.chords,
        count: 1,
        unitDist: m.unitDist,
        strength,
      });
    }
  }

  return [...aggregateMap.values()].sort((a, b) => {
    // strong 优先, 然后长度降序, 然后 count 降序, 最后 unitDist 升序
    if (a.strength !== b.strength) return a.strength === 'strong' ? -1 : 1;
    if (a.progression.length !== b.progression.length) return b.progression.length - a.progression.length;
    if (a.count !== b.count) return b.count - a.count;
    return a.unitDist - b.unitDist;
  });
}

export function summarizeChords(
  history: { name: string; chordId: string }[],
  keyRoot: number | null,
  keyMode: 'major' | 'minor' | null,
): ChordSummary {
  if (history.length === 0) {
    return { uniqueChords: [], classicMatches: [], progressions: [], totalFolded: 0, recommendedKey: null };
  }

  // Step 1: 折叠相邻同根
  const folded: { name: string; rootPc: number; quality: string }[] = [];
  for (const h of history) {
    const rootPc = parseRootPc(h.chordId);
    if (rootPc < 0) continue;
    const id = h.chordId;
    const quality = (id.length >= 2 && (id.endsWith('m') || id === id.slice(0,1) + 'bm') && !id.endsWith('aj'))
      ? 'minor' : 'major';
    const last = folded[folded.length - 1];
    if (last && last.rootPc === rootPc) continue;
    folded.push({ name: h.name, rootPc, quality });
  }

  // Step 2: 频次 top 6
  const countMap = new Map<string, { rootPc: number; quality: string; count: number }>();
  for (const f of folded) {
    const e = countMap.get(f.name);
    if (e) e.count++;
    else countMap.set(f.name, { rootPc: f.rootPc, quality: f.quality, count: 1 });
  }
  const uniqueChords = [...countMap.entries()]
    .map(([name, { rootPc, quality, count }]) => ({
      name,
      count,
      roman: keyRoot !== null && keyMode ? toRoman(rootPc, quality, keyRoot, keyMode) : '',
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // ============ Round 59 + 59.1: 经典走向匹配 (跨关系大小调) ============
  // 因为 Essentia.KeyExtractor 在大调 vs 关系小调间常常二选一犹豫 (二者顺阶完全相同),
  // 这里对 [原判 + 关系调] 各跑一遍经典匹配, 命中数多的胜出.
  // 同时按 keyScale 过滤词典 (大调词典只在 major 下跑, 小调词典只在 minor 下跑).
  let classicMatches: ClassicMatch[] = [];
  let recommendedKey: { rootPc: number; scale: 'major' | 'minor' } | null = null;

  if (keyRoot !== null && keyMode !== null && folded.length >= 4) {
    // 跑两遍: 原判 + 关系调
    const candidates: Array<{ rootPc: number; scale: 'major' | 'minor' }> = [
      { rootPc: keyRoot, scale: keyMode },
      keyMode === 'major'
        ? { rootPc: (keyRoot + 9) % 12, scale: 'minor' }
        : { rootPc: (keyRoot + 3) % 12, scale: 'major' },
    ];

    let bestMatches: ClassicMatch[] = [];
    let bestKey: typeof candidates[0] | null = null;
    let bestScore = -1;

    for (const cand of candidates) {
      const matches = matchClassicProgressions(folded, cand.rootPc, cand.scale);
      // 评分: count 总和 + 长走向加权 (8-chord 1 次 ≈ 4-chord 2 次)
      // Round 61: 翻转评分仅计 strong 匹配, 防弱匹配把关系调拱过来
      // (R59.1 的晴天/高跟鞋回归保护 — 弱匹配只展示不投票)
      const score = matches.reduce(
        (s, m) => s + (m.strength === 'strong' ? m.count * (m.progression.length / 4) : 0),
        0,
      );
      if (score > bestScore) {
        bestScore = score;
        bestMatches = matches;
        bestKey = cand;
      }
    }

    classicMatches = bestMatches;
    recommendedKey = bestKey;
  }
  // ============ /Round 59 + 59.1 经典匹配 ============

  // Step 4: 旧的 4-chord 重复走向 (降级 fallback, 仅当 classicMatches 为空时展示)
  const progMap = new Map<string, { chords: string[]; rootPcs: number[]; qualities: string[]; count: number }>();
  if (folded.length >= 4) {
    for (let i = 0; i <= folded.length - 4; i++) {
      const window = folded.slice(i, i + 4);
      const key = window.map(w => w.name).join('→');
      const e = progMap.get(key);
      if (e) e.count++;
      else progMap.set(key, {
        chords: window.map(w => w.name),
        rootPcs: window.map(w => w.rootPc),
        qualities: window.map(w => w.quality),
        count: 1,
      });
    }
  }
  const progressions = [...progMap.values()]
    .filter(p => p.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(p => ({
      chords: p.chords,
      romans: keyRoot !== null && keyMode
        ? p.rootPcs.map((r, i) => toRoman(r, p.qualities[i], keyRoot, keyMode))
        : [],
      count: p.count,
    }));

  return { uniqueChords, classicMatches, progressions, totalFolded: folded.length, recommendedKey };
}

export default function ChordSummaryCard({ summary }: { summary: ChordSummary }) {
  const [selectedChord, setSelectedChord] = useState<string | null>(null);
  // Round 63: 概要/详情切换 — 默认概要 (top 4 和弦 + top 2 走向 strong 优先)
  const [expanded, setExpanded] = useState(false);

  if (summary.uniqueChords.length === 0) return null;

  // Round 63: 概要模式数据切片
  // 和弦: top 4 (已按 count 降序), 展开后显 top 6
  const chordsToShow = expanded ? summary.uniqueChords : summary.uniqueChords.slice(0, 4);
  const hiddenChordCount = summary.uniqueChords.length - chordsToShow.length;
  // 走向: top 2 strong > top 2 weak, 展开后全显
  const strongMatches = summary.classicMatches.filter(m => m.strength === 'strong');
  const weakMatches = summary.classicMatches.filter(m => m.strength === 'weak');
  const matchesToShow = expanded
    ? summary.classicMatches
    : (strongMatches.length >= 2
      ? strongMatches.slice(0, 2)
      : [...strongMatches, ...weakMatches.slice(0, 2 - strongMatches.length)]);
  const hiddenMatchCount = summary.classicMatches.length - matchesToShow.length;

  // Essentia 输出名 → CHORDS 库查找：直接按 id 匹配
  const chordDef = selectedChord ? CHORDS.find(c => c.id === selectedChord) : null;

  return (
    <>
      <div className="card">
        <h2>📊 走向总结</h2>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginBottom: 10 }}>
          已合并连续重复 · 折叠后 {summary.totalFolded} 个和弦 · 点和弦查看按法
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 6 }}>主要和弦</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {chordsToShow.map(c => (
              <button
                key={c.name}
                onClick={() => setSelectedChord(c.name)}
                style={{
                  display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
                  padding: '4px 10px', borderRadius: 8,
                  background: 'var(--bg-soft)', border: '1px solid var(--line-soft)',
                  minWidth: 50, cursor: 'pointer',
                  font: 'inherit', color: 'inherit',
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand)' }}>{c.name}</span>
                {c.roman && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'serif' }}>{c.roman}</span>}
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>×{c.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Round 59: 经典走向 (顶部突出); Round 63: 概要模式切 top 2 */}
        {summary.classicMatches.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 6 }}>
              🎯 经典走向
            </div>
            {matchesToShow.map((m, i) => (
              <ClassicProgressionCard
                key={i}
                match={m}
                onChordClick={setSelectedChord}
              />
            ))}
          </div>
        )}

        {/* Round 63: 展开/收起按钮 (隐藏 > 0 时显示) */}
        {(hiddenChordCount > 0 || hiddenMatchCount > 0) && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              width: '100%', padding: '6px 10px', marginBottom: 8,
              fontSize: 12, color: 'var(--text-muted)',
              background: 'transparent', border: '1px dashed var(--line-soft)',
              borderRadius: 6, cursor: 'pointer',
            }}
          >
            {expanded
              ? '收起 ▲'
              : `展开看全部 ▼ (${hiddenChordCount > 0 ? `+${hiddenChordCount} 和弦` : ''}${hiddenChordCount > 0 && hiddenMatchCount > 0 ? ' / ' : ''}${hiddenMatchCount > 0 ? `+${hiddenMatchCount} 走向` : ''})`}
          </button>
        )}

        {/* 旧的"重复走向" 仅在没经典匹配时降级显示 */}
        {summary.classicMatches.length === 0 && summary.progressions.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
              其他重复走向
            </div>
            {summary.progressions.map((p, i) => (
              <div key={i} style={{
                padding: '8px 10px', marginBottom: 6, borderRadius: 8,
                background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)',
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)', letterSpacing: 1 }}>
                  {p.chords.map((ch, idx) => (
                    <span key={idx}>
                      <button
                        onClick={() => setSelectedChord(ch)}
                        style={{
                          background: 'transparent', border: 'none', padding: 0,
                          font: 'inherit', color: 'inherit', cursor: 'pointer',
                          textDecoration: 'underline', textDecorationStyle: 'dotted',
                          textDecorationColor: 'var(--text-muted)',
                        }}
                      >{ch}</button>
                      {idx < p.chords.length - 1 && <span> → </span>}
                    </span>
                  ))}
                </div>
                {p.romans.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'serif', letterSpacing: 1 }}>
                    {p.romans.join(' → ')}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>出现 {p.count} 次</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Round 48: 和弦图谱弹层 */}
      {selectedChord && (
        <ChordDetailModal
          chordName={selectedChord}
          chordDef={chordDef}
          onClose={() => setSelectedChord(null)}
        />
      )}
    </>
  );
}

/**
 * Round 59: 经典走向卡片
 *
 * 显示一个经典走向匹配:
 *   - 大字 nickname + 度数串 ID (1564 / 4536251 / 15634145)
 *   - 罗马数字 (I-V-vi-IV)
 *   - 实际和弦序列 (长度 ≤ 4 单行, 5-8 折叠两行)
 *   - 出现次数 ×N
 *   - 一行 description
 */
function ClassicProgressionCard({ match, onChordClick }: {
  match: ClassicMatch;
  onChordClick: (chordName: string) => void;
}) {
  const { progression, chords, count, strength, unitDist } = match;
  const isLong = chords.length >= 5;
  const mid = Math.ceil(chords.length / 2);
  const firstHalf = isLong ? chords.slice(0, mid) : chords;
  const secondHalf = isLong ? chords.slice(mid) : [];
  // Round 61: 匹配度 = 1 - unitDist (0%-100%)
  const matchPct = Math.max(0, Math.round((1 - unitDist) * 100));
  const isWeak = strength === 'weak';

  return (
    <Card variant={isWeak ? 'weak' : 'highlight'}>
      {/* 第一行: nickname (左, 含弱匹配徽章) + 度数串 ID (右) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)' }}>
          {progression.nickname}
          {isWeak && <Badge tone="warn">近似</Badge>}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 600, color: 'var(--brand)',
          fontFamily: 'ui-monospace, monospace',
        }}>
          {progression.id}
        </span>
      </div>

      {/* 第二行: 罗马数字 */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'serif', letterSpacing: 1 }}>
        {progression.roman}
      </div>

      {/* 第三行: 实际和弦序列 (≤4 单行 / 5-8 两行) */}
      <div style={{ marginTop: 6 }}>
        <ChordChain chords={firstHalf} onClick={onChordClick} />
        {secondHalf.length > 0 && (
          <div style={{ marginTop: 4 }}>
            <ChordChain chords={secondHalf} onClick={onChordClick} />
          </div>
        )}
      </div>

      {/* 第四行: 描述 + 匹配度 + 次数 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginTop: 6, gap: 8,
      }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
          💡 {progression.description}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
          匹配 {matchPct}% · ×{count}
        </span>
      </div>
    </Card>
  );
}

/** Round 48: 简易和弦详情弹层（轻 backdrop + 居中卡片） */
function ChordDetailModal({ chordName, chordDef, onClose }: {
  chordName: string;
  chordDef: import('../theory/chords').ChordDef | null | undefined;
  onClose: () => void;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-elev-1, #1a1a1a)',
          border: '1px solid var(--line-soft)',
          borderRadius: 12,
          padding: 18,
          maxWidth: 360, width: '100%',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand)' }}>{chordName}</div>
            {chordDef && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{chordDef.fullName}</div>}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 20, color: 'var(--text-muted)', padding: '4px 8px',
            }}
          >×</button>
        </div>

        {chordDef && chordDef.shapes[0] ? (
          <>
            <ChordDiagram shape={chordDef.shapes[0]} colorMode="dark" />
            {chordDef.tips && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
                💡 {chordDef.tips}
              </p>
            )}
            {chordDef.shapes.length > 1 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                另有 {chordDef.shapes.length - 1} 种替代按法
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
            该和弦暂未收录指法图谱。
            <br />
            <span style={{ fontSize: 11 }}>可在「乐理 → 和弦库」搜索类似根音的按法参考。</span>
          </div>
        )}
      </div>
    </div>
  );
}
