/**
 * Round 59.1: 经典和弦走向词典 (扩展版, 含大调 12 条 + 小调 4 条)
 *
 * Oracle PRD 决策:
 *   - 大调 4-chord 8 条 (流行核心)
 *   - 大调长走向 4 条 (爵士 + 卡农)
 *   - 小调原生 4 条 (Round 59.1 新增, keyScale=minor 时匹配)
 *
 * 砍掉 (Karpathy):
 *   - 5/6-chord (罕见独立成型, 多是装饰)
 *   - 与已有距离 ≤ 0.5 的候选 (false positive 风险)
 *   - 七和弦/挂留细化 (本轮 chord quality 简化为 major/minor)
 *
 * 度数计算 (基于 keyScale):
 *   - 大调 I=0, ii=2, iii=4, IV=5, V=7, vi=9, vii=11
 *   - 小调 i=0, ii=2, III=3, iv=5, v=7, VI=8, VII=10
 *     (注: 小调天然降三六七, 度数在 minor key 视角下不同于 major)
 *
 * scale='any' 用于不区分大小调的进行 (本轮无, 字段保留以备扩展).
 */

export interface ClassicProgression {
  /** 数字串 ID, 与用户口语对齐 */
  id: string;
  /** 走向长度 */
  length: number;
  /** 适用调式 ('major' / 'minor' / 'any') */
  scale: 'major' | 'minor' | 'any';
  /** 相对**对应 scale 主和弦**的半音度数 */
  degrees: number[];
  /** 罗马数字标注 */
  roman: string;
  /** 走向昵称 */
  nickname: string;
  /** 一句话功能/出处描述 */
  description: string;
}

export const CLASSIC_PROGRESSIONS: readonly ClassicProgression[] = [
  // ============ 大调 4-chord 流行核心 (8 条) ============
  {
    id: '1564', length: 4, scale: 'major',
    degrees: [0, 7, 9, 5],
    roman: 'I-V-vi-IV',
    nickname: '流行黄金',
    description: '温暖向上, 最常见的流行进行',
  },
  {
    id: '1645', length: 4, scale: 'major',
    degrees: [0, 9, 5, 7],
    roman: 'I-vi-IV-V',
    nickname: '50年代进行',
    description: '怀旧 / Doo-wop 风格 / Stand By Me',
  },
  {
    id: '6415', length: 4, scale: 'major',
    degrees: [9, 5, 0, 7],
    roman: 'vi-IV-I-V',
    nickname: '感伤变体',
    description: '小调起手的流行变体, 也是关系小调主进行的等价',
  },
  {
    id: '1465', length: 4, scale: 'major',
    degrees: [0, 5, 9, 7],
    roman: 'I-IV-vi-V',
    nickname: 'J-pop 上行',
    description: '日系城市感, 明亮上行',
  },
  {
    id: '4561', length: 4, scale: 'major',
    degrees: [5, 7, 9, 0],
    roman: 'IV-V-vi-I',
    nickname: '上升解决',
    description: 'IV 起手向 I 解决, 副歌常用',
  },
  {
    id: '1456', length: 4, scale: 'major',
    degrees: [0, 5, 7, 9],
    roman: 'I-IV-V-vi',
    nickname: '意外终止',
    description: '末位 vi 替代 I, 悬而未决感',
  },
  {
    id: '1451', length: 4, scale: 'major',
    degrees: [0, 5, 7, 0],
    roman: 'I-IV-V-I',
    nickname: '圣咏式',
    description: '最古典的正格终止四件套',
  },
  {
    id: '6451', length: 4, scale: 'major',
    degrees: [9, 5, 7, 0],
    roman: 'vi-IV-V-I',
    nickname: '小起大解决',
    description: '6415 的尾音落 I 版本, 副歌收束',
  },

  // ============ 大调长走向 (爵士 + 卡农, 4 条) ============
  {
    id: '4536251', length: 7, scale: 'major',
    degrees: [5, 7, 4, 9, 2, 7, 0],
    roman: 'IV-V-iii-vi-ii-V-I',
    nickname: '爵士万用',
    description: '七和弦下行五度循环, 最经典的爵士进行',
  },
  {
    id: '1453625', length: 7, scale: 'major',
    degrees: [0, 5, 7, 4, 9, 2, 7],
    roman: 'I-IV-V-iii-vi-ii-V',
    nickname: '爵士开放',
    description: '以 I 起手的爵士循环变体',
  },
  {
    id: '15634125', length: 8, scale: 'major',
    degrees: [0, 7, 9, 4, 5, 0, 2, 7],
    roman: 'I-V-vi-iii-IV-I-ii-V',
    nickname: '卡农变体',
    description: '卡农进行的 ii-V 收尾版本',
  },
  {
    id: '15634145', length: 8, scale: 'major',
    degrees: [0, 7, 9, 4, 5, 0, 5, 7],
    roman: 'I-V-vi-iii-IV-I-IV-V',
    nickname: '卡农进行',
    description: 'Pachelbel 卡农经典走向, 大量流行歌基础',
  },

  // ============ 小调原生 (4 条, Round 59.1 新增) ============
  // 小调度数: i=0, ii°=2, III=3, iv=5, v=7, VI=8, VII=10
  {
    id: 'i-VI-III-VII', length: 4, scale: 'minor',
    degrees: [0, 8, 3, 10],
    roman: 'i-VI-III-VII',
    nickname: '小调流行循环',
    description: '小调最经典的流行进行 (= 关系大调 1564 视角)',
  },
  {
    id: 'i-iv-VII-III', length: 4, scale: 'minor',
    degrees: [0, 5, 10, 3],
    roman: 'i-iv-VII-III',
    nickname: '小调民谣',
    description: '民谣/独立摇滚常见, 暗到亮的过渡',
  },
  {
    id: 'i-VII-VI-V', length: 4, scale: 'minor',
    degrees: [0, 10, 8, 7],
    roman: 'i-VII-VI-V',
    nickname: '弗拉门戈式下行',
    description: '小调降阶下行, 西班牙/戏剧风格',
  },
  {
    id: 'i-iv-v-i', length: 4, scale: 'minor',
    degrees: [0, 5, 7, 0],
    roman: 'i-iv-v-i',
    nickname: '小调正格',
    description: '最古典的小调终止式',
  },
] as const;

/** 度数串严格相等比较 (长度 + 顺序必须完全一致) */
export function degreesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
