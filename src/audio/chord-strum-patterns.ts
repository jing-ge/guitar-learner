// 和弦节奏型库 + 自定义存储
// 描述一个小节内对和弦的扫弦/分解动作

export type StrumDir = 'D' | 'U' | 'd' | 'u' | 'B' | 'X' | '·';
// D = 下扫全部, U = 上扫高音弦, d = 下扫低音弦(根音), u = 上扫高音弦轻, B = 拇指弹根音(单音)
// X = 切音/拍弦, · = 留空

export interface StrumEvent {
  /** 该事件在小节中的位置（0..1），1 = 一小节长度的末尾 */
  beat: number;
  dir: StrumDir;
  /** 力度 0.4~1.2 */
  vel?: number;
}

export interface ChordStrumPattern {
  id: string;
  name: string;
  category: string;
  desc: string;
  /** 一小节多少拍（4 = 4/4, 3 = 3/4） */
  beatsPerBar: number;
  /** 事件序列（按 beat 升序） */
  events: StrumEvent[];
}

/** 工具：用拍位 + 类型快速构造 */
function ev(beat: number, dir: StrumDir, vel = 1): StrumEvent {
  return { beat, dir, vel };
}

export const CHORD_STRUM_PATTERNS: ChordStrumPattern[] = [
  // ============ 4/4 类 ============
  {
    id: 'whole',
    name: '整音（每小节一下）',
    category: '🟢 基础',
    desc: '第 1 拍下扫一次，让和弦尾音自然延展',
    beatsPerBar: 4,
    events: [ev(0, 'D')],
  },
  {
    id: 'half',
    name: '半拍（1+3）',
    category: '🟢 基础',
    desc: '第 1、3 拍各下扫一次，最简单的伴奏',
    beatsPerBar: 4,
    events: [ev(0, 'D'), ev(2, 'D', 0.85)],
  },
  {
    id: 'four-down',
    name: '强四拍（DDDD）',
    category: '🟢 基础',
    desc: '每拍下扫，朋克/摇滚常用',
    beatsPerBar: 4,
    events: [ev(0, 'D'), ev(1, 'D', 0.85), ev(2, 'D', 0.95), ev(3, 'D', 0.85)],
  },
  {
    id: 'ddu-du',
    name: '万能 D-D-U-U-D-U',
    category: '🎶 民谣/流行',
    desc: '吉他万能节奏型：下下上上下上',
    beatsPerBar: 4,
    events: [
      ev(0, 'D'), ev(1, 'D', 0.85), ev(1.5, 'U', 0.7),
      ev(2.5, 'U', 0.7), ev(3, 'D', 0.9), ev(3.5, 'U', 0.7),
    ],
  },
  {
    id: 'pop-8',
    name: '流行 8 拍',
    category: '🎶 民谣/流行',
    desc: '低音 + D-U 交替，温和好听',
    beatsPerBar: 4,
    events: [
      ev(0, 'B'), ev(0.5, 'U', 0.6),
      ev(1, 'D', 0.85), ev(1.5, 'U', 0.6),
      ev(2, 'd', 0.8), ev(2.5, 'U', 0.6),
      ev(3, 'D', 0.85), ev(3.5, 'U', 0.6),
    ],
  },
  {
    id: 'slow-rock',
    name: '慢摇 4/4',
    category: '🎶 民谣/流行',
    desc: 'D · D U · U D U，留空更有律动',
    beatsPerBar: 4,
    events: [
      ev(0, 'D'), ev(1, 'D', 0.85), ev(1.5, 'U', 0.7),
      ev(2.5, 'U', 0.7), ev(3, 'D', 0.9), ev(3.5, 'U', 0.7),
    ],
  },
  {
    id: 'ballad-fingerstyle',
    name: '抒情指弹分解',
    category: '🎸 指弹/分解',
    desc: '拇指→3弦→2弦→1弦→2弦→3弦 的经典分解',
    beatsPerBar: 4,
    events: [
      ev(0, 'B'),    ev(0.5, 'u', 0.7),
      ev(1, 'U', 0.7), ev(1.5, 'u', 0.7),
      ev(2, 'd', 0.8), ev(2.5, 'u', 0.7),
      ev(3, 'U', 0.7), ev(3.5, 'u', 0.7),
    ],
  },
  {
    id: 'travis',
    name: 'Travis Picking',
    category: '🎸 指弹/分解',
    desc: '乡村/民谣交替低音 + 内声部',
    beatsPerBar: 4,
    events: [
      ev(0, 'B'),    ev(0.75, 'u', 0.7),
      ev(1, 'd', 0.85), ev(1.75, 'U', 0.7),
      ev(2, 'B', 0.9), ev(2.75, 'u', 0.7),
      ev(3, 'd', 0.85), ev(3.75, 'U', 0.7),
    ],
  },
  {
    id: 'reggae',
    name: 'Reggae 反拍',
    category: '🌴 律动',
    desc: '只弹反拍（2、4 拍）的高音弦上扫',
    beatsPerBar: 4,
    events: [
      ev(1, 'U', 1), ev(3, 'U', 1),
    ],
  },
  {
    id: 'funk-cut',
    name: 'Funk 切分',
    category: '🌴 律动',
    desc: '16 分密集 + 切音律动',
    beatsPerBar: 4,
    events: [
      ev(0, 'D'),     ev(0.5, 'X', 0.7),
      ev(1, 'D', 0.8), ev(1.5, 'U', 0.7),
      ev(2, 'X', 0.7), ev(2.5, 'D', 0.85), ev(2.75, 'U', 0.7),
      ev(3, 'X', 0.7), ev(3.5, 'D', 0.85), ev(3.75, 'U', 0.7),
    ],
  },
  {
    id: 'shuffle',
    name: '布鲁斯 Shuffle',
    category: '🎷 布鲁斯',
    desc: '三连音律动，每拍 D-U（前长后短）',
    beatsPerBar: 4,
    events: [
      ev(0, 'D'),    ev(0.667, 'U', 0.7),
      ev(1, 'D', 0.9), ev(1.667, 'U', 0.7),
      ev(2, 'D', 0.95), ev(2.667, 'U', 0.7),
      ev(3, 'D', 0.9), ev(3.667, 'U', 0.7),
    ],
  },
  // ============ 3/4 类 ============
  {
    id: 'waltz',
    name: '华尔兹 3/4',
    category: '💃 三拍',
    desc: '强-弱-弱：根音 + 高音弦 + 高音弦',
    beatsPerBar: 3,
    events: [
      ev(0, 'B'), ev(1, 'U', 0.7), ev(2, 'U', 0.7),
    ],
  },
  {
    id: 'waltz-strum',
    name: '华尔兹扫弦 3/4',
    category: '💃 三拍',
    desc: '下扫 + 两次上扫',
    beatsPerBar: 3,
    events: [
      ev(0, 'D'), ev(1, 'U', 0.7), ev(2, 'U', 0.7),
    ],
  },
];

/* ============ 自定义和弦节奏型（localStorage） ============ */
const KEY = 'gl_custom_chord_strum_patterns_v1';

export interface CustomChordStrumPattern extends ChordStrumPattern {
  custom: true;
  createdAt: number;
}

export function loadCustomStrumPatterns(): CustomChordStrumPattern[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as CustomChordStrumPattern[];
    return arr.filter(p => p && Array.isArray(p.events) && p.events.length > 0);
  } catch {
    return [];
  }
}

export function saveCustomStrumPatterns(list: CustomChordStrumPattern[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

export function createEmptyStrumPattern(beatsPerBar: 3 | 4 = 4, name = '我的节奏型'): CustomChordStrumPattern {
  return {
    id: 'cstrum-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    category: '⭐ 自定义',
    desc: '我自己编辑的扫弦节奏型',
    beatsPerBar,
    events: [{ beat: 0, dir: 'D', vel: 1 }],
    custom: true,
    createdAt: Date.now(),
  };
}

export function cloneStrumPattern(p: ChordStrumPattern, newName?: string): CustomChordStrumPattern {
  return {
    id: 'cstrum-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: newName || (p.name + ' 副本'),
    category: '⭐ 自定义',
    desc: '基于「' + p.name + '」修改',
    beatsPerBar: p.beatsPerBar,
    events: p.events.map(e => ({ ...e })),
    custom: true,
    createdAt: Date.now(),
  };
}