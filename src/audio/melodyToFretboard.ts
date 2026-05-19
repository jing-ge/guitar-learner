/**
 * Round 53: 主旋律 MIDI → 吉他指板位置推荐
 *
 * 策略: 最低把位 (a 方案)
 *   - 对每个 MIDI, 找指板上 fret 最低的位置
 *   - 多个位置同 fret 时, 选低音弦 (stringNum 大, 即靠下方第 6/5/4 弦)
 *     理由: 初学者更易找到低音弦, 横向距离 1 品/低音弦 比 12 品/高音弦 更易找
 *
 * 范围: MIDI 40 (E2, 6 弦空弦) ~ MIDI 76 (E5, 1 弦 12 品)
 *   - 超出范围返回 null, UI 显示 ⚠ 超出吉他范围
 *   - 不做八度移调 (避免"对的音不对的八度"迷惑初学者)
 *
 * Round 53 第 0 任务验证: 合成 sine 场景 R51 准确率 100%, 算法输入质量在清唱场景可控
 */

import { fretToMidi } from '../theory/notes';

export interface FretboardPosition {
  /** 弦号 1-6 (1 = 最细高音 E4 弦, 6 = 最粗低音 E2 弦) */
  stringNum: 1 | 2 | 3 | 4 | 5 | 6;
  /** 品位 0-12 (0 = 空弦) */
  fret: number;
}

/** 吉他标准调弦下每根弦的空弦 MIDI */
const OPEN_STRING_MIDIS = [40, 45, 50, 55, 59, 64];  // E2 A2 D3 G3 B3 E4
const MAX_FRET = 12;
const STRINGS: (1|2|3|4|5|6)[] = [1, 2, 3, 4, 5, 6];

/**
 * 给定 MIDI 找最低把位的吉他位置
 *
 * 算法:
 *   遍历每根弦, 计算该 MIDI 在该弦上的 fret = midi - openStringMidi
 *   收集所有 fret 在 [0, 12] 范围内的位置
 *   按 fret 升序排序; 同 fret 优先低音弦 (stringNum 大)
 *
 * @returns 最优位置, 或 null (MIDI 超出吉他范围)
 */
export function midiToLowestPosition(midi: number): FretboardPosition | null {
  const candidates: FretboardPosition[] = [];

  for (const stringNum of STRINGS) {
    // STRINGS 数组里 1 在前, 但 OPEN_STRING_MIDIS 索引是 0=6弦
    // string 1 = E4 (索引 5), string 6 = E2 (索引 0)
    const openMidi = OPEN_STRING_MIDIS[6 - stringNum];
    const fret = midi - openMidi;
    if (fret >= 0 && fret <= MAX_FRET) {
      candidates.push({ stringNum, fret });
    }
  }

  if (candidates.length === 0) return null;

  // 排序: fret 升序; 同 fret 时 stringNum 大者 (低音弦) 优先
  candidates.sort((a, b) => {
    if (a.fret !== b.fret) return a.fret - b.fret;
    return b.stringNum - a.stringNum;
  });

  return candidates[0];
}

/**
 * 批量把主旋律 notes 转成指板位置
 *
 * @param notes MelodyNote[] (含 midi 字段)
 * @returns 每个 note 对应的位置或 null
 */
export function melodyToFretboardPositions(
  notes: Array<{ midi: number; noteName: string }>,
): Array<{ position: FretboardPosition | null; midi: number; noteName: string }> {
  return notes.map(n => ({
    position: midiToLowestPosition(n.midi),
    midi: n.midi,
    noteName: n.noteName,
  }));
}

/**
 * 收集所有 unique 位置 (去重) + 每个位置在旋律里出现的序号
 *
 * 用于指板可视化: 同一位置可能被多次弹到 (如 C4 重复出现), 标多个序号
 *
 * @returns Array<{position, label: "C4", noteIndexes: [1, 4]}>
 */
export interface UniquePositionStat {
  position: FretboardPosition;
  noteName: string;
  /** 旋律里出现的顺序号 (从 1 开始, 1-based) */
  noteIndexes: number[];
}

export function getUniquePositions(
  notes: Array<{ midi: number; noteName: string }>,
): { positions: UniquePositionStat[]; outOfRange: string[] } {
  const positionMap = new Map<string, UniquePositionStat>();
  const outOfRangeNames = new Set<string>();

  notes.forEach((n, i) => {
    const pos = midiToLowestPosition(n.midi);
    if (!pos) {
      outOfRangeNames.add(n.noteName);
      return;
    }
    const key = `${pos.stringNum}-${pos.fret}`;
    const existing = positionMap.get(key);
    if (existing) {
      existing.noteIndexes.push(i + 1);
    } else {
      positionMap.set(key, {
        position: pos,
        noteName: n.noteName,
        noteIndexes: [i + 1],
      });
    }
  });

  return {
    positions: [...positionMap.values()],
    outOfRange: [...outOfRangeNames],
  };
}

// 编译期 sanity check: fretToMidi 与本文件 OPEN_STRING_MIDIS 一致
// (运行时验证, 防 theory/notes 改了调弦定义但本文件未跟进)
void fretToMidi;  // 引用以避免未使用警告

// ============ Round 56: 弹法策略 b (固定把位) + c (最少手指移动) ============

export type FretboardStrategy = 'lowest' | 'fixed' | 'least';

/** 固定把位选项: 4 个不重叠的区域 */
export const FIXED_FRET_RANGES: ReadonlyArray<readonly [number, number]> = [
  [1, 4], [4, 7], [7, 10], [10, 12],
];

/** 给定 MIDI, 列出所有可弹位置 (fret 0-12 之内) */
function midiToAllPositions(midi: number): FretboardPosition[] {
  const out: FretboardPosition[] = [];
  for (const stringNum of STRINGS) {
    const openMidi = OPEN_STRING_MIDIS[6 - stringNum];
    const fret = midi - openMidi;
    if (fret >= 0 && fret <= MAX_FRET) {
      out.push({ stringNum, fret });
    }
  }
  return out;
}

/** 策略 b: 在指定 fret 范围内找位置, 同 fret 选低音弦 */
export function midiToFixedPosition(
  midi: number,
  fromFret: number,
  toFret: number,
): FretboardPosition | null {
  const cands = midiToAllPositions(midi).filter(
    p => p.fret >= fromFret && p.fret <= toFret,
  );
  if (cands.length === 0) return null;
  cands.sort((a, b) => {
    if (a.fret !== b.fret) return a.fret - b.fret;
    return b.stringNum - a.stringNum;
  });
  return cands[0];
}

/**
 * 自动选最优把位: 在 FIXED_FRET_RANGES 中选覆盖最多音的把位
 * 覆盖 = 该 MIDI 在该范围内能弹出来 (无需 fallback)
 * 平局取最低范围 (最易按)
 */
export function pickAutoFretRange(
  notes: Array<{ midi: number }>,
): readonly [number, number] {
  let best = FIXED_FRET_RANGES[0];
  let bestCount = -1;
  for (const range of FIXED_FRET_RANGES) {
    const count = notes.filter(
      n => midiToFixedPosition(n.midi, range[0], range[1]) !== null,
    ).length;
    if (count > bestCount) {
      bestCount = count;
      best = range;
    }
  }
  return best;
}

/** Manhattan 距离 (string_diff + fret_diff) — 吉他指型移动 1 阶近似 */
function manhattanDistance(a: FretboardPosition, b: FretboardPosition): number {
  return Math.abs(a.stringNum - b.stringNum) + Math.abs(a.fret - b.fret);
}

export interface MappedPosition {
  position: FretboardPosition | null;
  midi: number;
  noteName: string;
  /** Round 56: 策略 b 时, 此音超出指定把位范围, 已用最低把位兜底 */
  fallback?: boolean;
}

/** 策略 b 主入口: 固定把位, 范围外用最低把位兜底 */
export function mapMelodyFixed(
  notes: Array<{ midi: number; noteName: string }>,
  fromFret: number,
  toFret: number,
): MappedPosition[] {
  return notes.map(n => {
    const inRange = midiToFixedPosition(n.midi, fromFret, toFret);
    if (inRange) {
      return { position: inRange, midi: n.midi, noteName: n.noteName };
    }
    const fallback = midiToLowestPosition(n.midi);
    return {
      position: fallback,
      midi: n.midi,
      noteName: n.noteName,
      fallback: fallback !== null,
    };
  });
}

/** 策略 c 主入口: 最少手指移动 (贪心 Manhattan), 首音用最低把位 */
export function mapMelodyLeastMovement(
  notes: Array<{ midi: number; noteName: string }>,
): MappedPosition[] {
  let prev: FretboardPosition | null = null;
  return notes.map((n, i) => {
    const cands = midiToAllPositions(n.midi);
    if (cands.length === 0) {
      return { position: null, midi: n.midi, noteName: n.noteName };
    }
    if (i === 0 || !prev) {
      // 首音: 用最低把位作起点
      const start = midiToLowestPosition(n.midi);
      prev = start;
      return { position: start, midi: n.midi, noteName: n.noteName };
    }
    // 后续音: 选距 prev 最近的位置 (Manhattan 最小)
    let best = cands[0];
    let bestDist = manhattanDistance(prev, cands[0]);
    for (let k = 1; k < cands.length; k++) {
      const d = manhattanDistance(prev, cands[k]);
      if (d < bestDist) {
        best = cands[k];
        bestDist = d;
      }
    }
    prev = best;
    return { position: best, midi: n.midi, noteName: n.noteName };
  });
}

/** 策略 a (复用 R53): 最低把位, 包装成 MappedPosition[] */
export function mapMelodyLowest(
  notes: Array<{ midi: number; noteName: string }>,
): MappedPosition[] {
  return notes.map(n => ({
    position: midiToLowestPosition(n.midi),
    midi: n.midi,
    noteName: n.noteName,
  }));
}

/**
 * Round 56: 统一入口, 按策略选算法
 * 返回去重位置 + 出现顺序 (与 R53 getUniquePositions 兼容)
 */
export function getUniquePositionsByStrategy(
  notes: Array<{ midi: number; noteName: string }>,
  strategy: FretboardStrategy,
  fixedRange?: readonly [number, number],
): { positions: UniquePositionStat[]; outOfRange: string[]; fallbackKeys: Set<string> } {
  let mapped: MappedPosition[];
  if (strategy === 'fixed' && fixedRange) {
    mapped = mapMelodyFixed(notes, fixedRange[0], fixedRange[1]);
  } else if (strategy === 'least') {
    mapped = mapMelodyLeastMovement(notes);
  } else {
    mapped = mapMelodyLowest(notes);
  }

  const positionMap = new Map<string, UniquePositionStat>();
  const outOfRange = new Set<string>();
  const fallbackKeys = new Set<string>();

  mapped.forEach((m, i) => {
    if (!m.position) {
      outOfRange.add(m.noteName);
      return;
    }
    const key = `${m.position.stringNum}-${m.position.fret}`;
    if (m.fallback) fallbackKeys.add(key);
    const existing = positionMap.get(key);
    if (existing) {
      existing.noteIndexes.push(i + 1);
    } else {
      positionMap.set(key, {
        position: m.position,
        noteName: m.noteName,
        noteIndexes: [i + 1],
      });
    }
  });

  return {
    positions: [...positionMap.values()],
    outOfRange: [...outOfRange],
    fallbackKeys,
  };
}
