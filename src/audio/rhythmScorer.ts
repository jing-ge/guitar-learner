/**
 * Round 50: 节奏稳定度评分
 *
 * 输入: 期望拍点 (expectedBeats, 秒) + 用户实际起音点 (detectedOnsets, 秒)
 * 输出: 每拍偏差 (ms) + 命中率 + 平均偏差 + 校准 offset
 *
 * 流程:
 *   1. 校准阶段: 用前 N 拍算 median(detected - expected) 作为系统延迟基线
 *   2. 评分阶段: detected - offset 与 expected 做最近邻匹配
 *   3. 偏差分级:
 *      ≤ 20 ms  绿 (准)
 *      ≤ 50 ms  黄 (偏)
 *      ≤ 150 ms 红 (不准)
 *      > 150 ms 或无 onset 灰 (漏)
 *
 * 关键设计:
 *   - 用中位数算 offset 抗异常 onset (用户多扫了/少扫了 1 下不会污染基线)
 *   - 最近邻匹配每个 expectedBeat 找最近的 detectedOnset, 距离 > 150ms 算漏
 *   - 防止一个 onset 被多个 expectedBeat 共用 (一对一)
 */

export type BeatGrade = 'hit' | 'near' | 'miss' | 'absent';

export interface BeatMatch {
  /** 期望的拍点时间 (秒) */
  expected: number;
  /** 匹配到的用户 onset (秒, 已减 calibrationOffset)。null = 漏 */
  detected: number | null;
  /** 偏差 (ms, +抢 / -拖) */
  deviationMs: number | null;
  grade: BeatGrade;
}

export interface RhythmScore {
  matches: BeatMatch[];
  /** 平均绝对偏差 (ms, 越小越准) */
  meanAbsDeviationMs: number;
  /** 平均偏差 (ms, 带正负: + 表示整体抢 / - 表示整体拖) */
  meanSignedDeviationMs: number;
  /** hit / near 总数 与应有拍数的比 */
  hitRate: number;
  /** 漏拍数 (no onset matched) */
  absentCount: number;
  /** 校准 offset (ms, 评分前减掉) */
  calibrationOffsetMs: number;
  /**
   * Round 55 A5: 疑似检测到节拍器 click 被麦克风收录回授
   * 触发条件: 评分阶段 onset 落在 expected beat ±5ms 内的比例 > 60%
   * 人类节奏感知阈值 ~20ms, ±5ms 是远超人类扫弦精度的异常一致性,
   * 几乎一定是节拍器自我录入. UI 应提示 '戴耳机或降低外放音量'
   */
  feedbackSuspected: boolean;
}

const HIT_THRESHOLD_MS = 20;
const NEAR_THRESHOLD_MS = 50;
const MAX_MATCH_THRESHOLD_MS = 150;
const FEEDBACK_DETECT_WINDOW_MS = 5;      // ±5ms 内视为可疑回授
const FEEDBACK_DETECT_RATIO_MIN = 0.6;    // 占比 > 60% 标记为 feedbackSuspected

/** 计算中位数（用于校准 offset） */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 计算校准 offset: 用前 N 拍的偏差中位数估计系统延迟
 *
 * 算法: 对每个 calibration expectedBeat, 在 detectedOnsets 里找最近的 onset
 *      (距离 < 300ms 才采纳, 防止用户没在跟拍), 算 detected - expected 中位数
 *
 * @returns { offsetSec, matched }
 *   offsetSec: 秒, 正数 = 用户实际比预期晚 (系统延迟 + 主观拖拍)
 *   matched: 成功匹配到的 calibration 拍数, < 2 时 UI 应阻止进入评分 (用户没扫弦)
 */
export function computeCalibrationOffset(
  calibrationExpected: number[],
  detectedOnsets: number[],
): { offsetSec: number; matched: number } {
  const deltas: number[] = [];
  for (const exp of calibrationExpected) {
    let bestDelta: number | null = null;
    for (const det of detectedOnsets) {
      const d = det - exp;
      if (Math.abs(d) > 0.3) continue;
      if (bestDelta === null || Math.abs(d) < Math.abs(bestDelta)) bestDelta = d;
    }
    if (bestDelta !== null) deltas.push(bestDelta);
  }
  return { offsetSec: median(deltas), matched: deltas.length };
}

/** 单次偏差 ms → 等级 */
function gradeDeviation(devMs: number | null): BeatGrade {
  if (devMs === null) return 'absent';
  const abs = Math.abs(devMs);
  if (abs <= HIT_THRESHOLD_MS) return 'hit';
  if (abs <= NEAR_THRESHOLD_MS) return 'near';
  if (abs <= MAX_MATCH_THRESHOLD_MS) return 'miss';
  return 'absent';
}

/**
 * 主评分函数
 *
 * @param expectedBeats 期望拍点 (秒, 评分阶段)
 * @param detectedOnsets 用户实际起音点 (秒, 整段录音绝对时间)
 * @param calibrationOffsetSec 校准 offset (秒, 评分阶段 onset 减掉这个)
 */
export function scoreRhythm(
  expectedBeats: number[],
  detectedOnsets: number[],
  calibrationOffsetSec: number,
): RhythmScore {
  // 1. 应用校准
  const adjustedOnsets = detectedOnsets.map(t => t - calibrationOffsetSec);

  // 2. 最近邻匹配 (一对一: 每个 onset 至多匹配一个 expected, 反之亦然)
  //    贪心算法: 对每个 expected, 在剩余 onsets 里挑最近的
  const usedOnsetIdx = new Set<number>();
  const matches: BeatMatch[] = [];
  for (const expected of expectedBeats) {
    let bestIdx = -1;
    let bestAbsDelta = Infinity;
    for (let i = 0; i < adjustedOnsets.length; i++) {
      if (usedOnsetIdx.has(i)) continue;
      const absD = Math.abs(adjustedOnsets[i] - expected);
      if (absD < bestAbsDelta) {
        bestAbsDelta = absD;
        bestIdx = i;
      }
    }
    if (bestIdx === -1 || bestAbsDelta > MAX_MATCH_THRESHOLD_MS / 1000) {
      matches.push({ expected, detected: null, deviationMs: null, grade: 'absent' });
    } else {
      usedOnsetIdx.add(bestIdx);
      const devMs = (adjustedOnsets[bestIdx] - expected) * 1000;
      matches.push({
        expected,
        detected: adjustedOnsets[bestIdx],
        deviationMs: devMs,
        grade: gradeDeviation(devMs),
      });
    }
  }

  // 3. 汇总
  const validDevs = matches.filter(m => m.deviationMs !== null).map(m => m.deviationMs!);
  const meanAbsDeviationMs = validDevs.length > 0
    ? validDevs.reduce((s, d) => s + Math.abs(d), 0) / validDevs.length
    : 0;
  const meanSignedDeviationMs = validDevs.length > 0
    ? validDevs.reduce((s, d) => s + d, 0) / validDevs.length
    : 0;
  const hitCount = matches.filter(m => m.grade === 'hit' || m.grade === 'near').length;
  const absentCount = matches.filter(m => m.grade === 'absent').length;

  // Round 55 A5: 检测节拍器回授 — onset 异常密集落在 expected ±5ms 内, 远超人类扫弦精度
  // 人类节奏感知阈值 ~20ms, ±5ms 的一致性几乎不可能是用户扫弦, 必是节拍器自我录入
  const validMatches = matches.filter(m => m.deviationMs !== null);
  const tightMatches = validMatches.filter(m => Math.abs(m.deviationMs!) <= FEEDBACK_DETECT_WINDOW_MS).length;
  const tightRatio = validMatches.length > 0 ? tightMatches / validMatches.length : 0;
  const feedbackSuspected = validMatches.length >= 8 && tightRatio > FEEDBACK_DETECT_RATIO_MIN;
  //                       ^^^^^^^^^^^^^^^^^^^^^^^^ 至少 8 个有效匹配, 防小样本误报

  return {
    matches,
    meanAbsDeviationMs,
    meanSignedDeviationMs,
    hitRate: expectedBeats.length > 0 ? hitCount / expectedBeats.length : 0,
    absentCount,
    calibrationOffsetMs: calibrationOffsetSec * 1000,
    feedbackSuspected,
  };
}

/** 等级 → 颜色 (供 UI 用，使用 CSS 变量) */
export function gradeColor(grade: BeatGrade): string {
  switch (grade) {
    case 'hit':    return 'var(--success, #10b981)';
    case 'near':   return 'var(--brand)';
    case 'miss':   return 'var(--danger, #ef4444)';
    case 'absent': return 'var(--text-muted)';
  }
}

/** 等级 → 文字标签 */
export function gradeLabel(grade: BeatGrade): string {
  switch (grade) {
    case 'hit':    return '准';
    case 'near':   return '偏';
    case 'miss':   return '差';
    case 'absent': return '漏';
  }
}
