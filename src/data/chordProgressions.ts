/**
 * Round 57: 和弦走向训练题库
 *
 * 6 个最经典 2-chord 走向 (在 C 大调中), 覆盖 95% 常见进行,
 * 罗马数字两两可区分 (功能/方向/终止感都不同).
 *
 * 砍掉:
 *   - 4-chord 进行 (另一认知层级, Round 58+)
 *   - 难度分级 / 多调支持 / 小调走向 (本轮 MVP 不做)
 */

export interface ProgressionDef {
  /** 唯一 ID */
  id: string;
  /** 罗马数字标注 (用户看到的标签) */
  roman: string;
  /** 走向昵称 (强终止/半终止...) */
  nickname: string;
  /** C 大调下的具体和弦 ID (与 chords.ts CHORDS 对齐) */
  chordsInC: readonly [string, string];
  /** 一句话功能解释 */
  description: string;
}

export const PROGRESSION_QUESTIONS: readonly ProgressionDef[] = [
  {
    id: 'V-I',
    roman: 'V → I',
    nickname: '强终止',
    chordsInC: ['G', 'C'],
    description: '最稳定的终止感, 流行/古典歌曲结尾最常见',
  },
  {
    id: 'IV-I',
    roman: 'IV → I',
    nickname: '变格终止 (Amen)',
    chordsInC: ['F', 'C'],
    description: '柔和的回归, 圣歌"阿门"般的结束',
  },
  {
    id: 'I-V',
    roman: 'I → V',
    nickname: '半终止',
    chordsInC: ['C', 'G'],
    description: '悬而未决, 期待回到 I 级, 流行歌曲半句结尾',
  },
  {
    id: 'V-vi',
    roman: 'V → vi',
    nickname: '阻碍终止',
    chordsInC: ['G', 'Am'],
    description: '意外的去向, 替代 V→I 产生戏剧感',
  },
  {
    id: 'I-IV',
    roman: 'I → IV',
    nickname: '上行延展',
    chordsInC: ['C', 'F'],
    description: '从主和弦展开, 流行歌主歌起句最常用',
  },
  {
    id: 'vi-V',
    roman: 'vi → V',
    nickname: '小调上行',
    chordsInC: ['Am', 'G'],
    description: '从忧伤到希望, vi 引出 V 重新推进',
  },
] as const;

export interface ProgressionQuestion {
  /** 正确答案的 ProgressionDef */
  answer: ProgressionDef;
  /** 4 个选项 (含答案 + 3 个干扰项, 已 shuffle) */
  options: ProgressionDef[];
}

/**
 * 随机生成 1 道题:
 *   - 从题库随机抽 1 个走向作为答案
 *   - 干扰项随机抽另外 3 个走向 (不重复)
 *   - 4 选 1 shuffle 后返回
 */
export function generateProgressionQuestion(): ProgressionQuestion {
  const pool = [...PROGRESSION_QUESTIONS];
  // shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const [answer, ...rest] = pool;
  const distractors = rest.slice(0, 3);
  const options = [answer, ...distractors];
  // shuffle options
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return { answer, options };
}
