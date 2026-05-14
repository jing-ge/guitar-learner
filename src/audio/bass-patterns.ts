// 贝斯节奏型库 + 自定义存储
// 描述一个小节内贝斯弹什么音、什么时刻

/** 贝斯音的"度数选择" */
export type BassNote =
  | 'R'   // 根音（root）
  | '5'   // 五度
  | '3'   // 三度（大三/小三由和弦决定）
  | 'O'   // 高八度根音
  | 'L'   // 低八度根音
  | 'p5'  // 经过音：根音→五度的过渡（一般是 2/3 度）
  | 'X';  // 静音/休止

export interface BassEvent {
  /** 该事件在小节中的位置（0..beatsPerBar） */
  beat: number;
  note: BassNote;
  /** 音符时长比例（相对一拍）—— 默认 1（一拍） */
  dur?: number;
  /** 力度 0.4~1.2 */
  vel?: number;
}

export interface BassPattern {
  id: string;
  name: string;
  category: string;
  desc: string;
  beatsPerBar: number;
  events: BassEvent[];
}

function ev(beat: number, note: BassNote, dur = 1, vel = 1): BassEvent {
  return { beat, note, dur, vel };
}

export const BASS_PATTERNS: BassPattern[] = [
  // ============ 基础 ============
  {
    id: 'root-only',
    name: '只弹根音',
    category: '🟢 基础',
    desc: '每小节第 1 拍弹一个根音（最简单的贝斯线）',
    beatsPerBar: 4,
    events: [ev(0, 'R', 4)],
  },
  {
    id: 'root-half',
    name: '根音 1/3 拍',
    category: '🟢 基础',
    desc: '第 1、3 拍弹根音',
    beatsPerBar: 4,
    events: [ev(0, 'R', 2), ev(2, 'R', 2, 0.85)],
  },
  {
    id: 'root-quarter',
    name: '强四拍根音',
    category: '🟢 基础',
    desc: '每拍一个根音（强力推进）',
    beatsPerBar: 4,
    events: [ev(0, 'R'), ev(1, 'R', 1, 0.85), ev(2, 'R', 1, 0.95), ev(3, 'R', 1, 0.85)],
  },
  // ============ 流行 / 民谣 ============
  {
    id: 'pop-r5',
    name: '根音 + 五度',
    category: '🎶 流行/民谣',
    desc: '1、3 拍根音，2、4 拍五度（最常用的流行贝斯线）',
    beatsPerBar: 4,
    events: [ev(0, 'R'), ev(1, '5', 1, 0.8), ev(2, 'R', 1, 0.9), ev(3, '5', 1, 0.8)],
  },
  {
    id: 'pop-walking',
    name: '走动贝斯（R-5-R-p5）',
    category: '🎶 流行/民谣',
    desc: '根音、五度、根音、经过音（流畅过渡到下一小节）',
    beatsPerBar: 4,
    events: [ev(0, 'R'), ev(1, '5'), ev(2, 'R', 1, 0.85), ev(3, 'p5', 1, 0.9)],
  },
  {
    id: 'pop-octave',
    name: '根音 + 高八度',
    category: '🎶 流行/民谣',
    desc: '低高根音交替，常见于 Disco/Pop/Funk',
    beatsPerBar: 4,
    events: [ev(0, 'R'), ev(1, 'O', 1, 0.8), ev(2, 'R', 1, 0.9), ev(3, 'O', 1, 0.8)],
  },
  // ============ 律动 / 摇滚 ============
  {
    id: 'rock-eighth',
    name: '摇滚 8 分根音',
    category: '🤘 摇滚/律动',
    desc: '每拍两个根音（8 分音符密度，摇滚标配）',
    beatsPerBar: 4,
    events: [
      ev(0, 'R', 0.5), ev(0.5, 'R', 0.5, 0.75),
      ev(1, 'R', 0.5, 0.85), ev(1.5, 'R', 0.5, 0.75),
      ev(2, 'R', 0.5, 0.95), ev(2.5, 'R', 0.5, 0.75),
      ev(3, 'R', 0.5, 0.85), ev(3.5, 'R', 0.5, 0.75),
    ],
  },
  {
    id: 'funk-syncopated',
    name: 'Funk 切分',
    category: '🤘 摇滚/律动',
    desc: '切分律动 + 八度跳跃',
    beatsPerBar: 4,
    events: [
      ev(0, 'R', 0.5), ev(0.75, 'R', 0.25, 0.7),
      ev(1.5, 'O', 0.5, 0.85),
      ev(2, 'R', 0.5, 0.9), ev(2.5, '5', 0.5, 0.7),
      ev(3, 'R', 0.5, 0.85), ev(3.5, 'O', 0.5, 0.75),
    ],
  },
  {
    id: 'reggae',
    name: 'Reggae 反拍',
    category: '🤘 摇滚/律动',
    desc: '只在 2、4 拍弹根音，与雷鬼鼓配套',
    beatsPerBar: 4,
    events: [ev(1, 'R', 1), ev(3, 'R', 1)],
  },
  // ============ 蓝调 ============
  {
    id: 'blues-shuffle',
    name: '布鲁斯 Shuffle',
    category: '🎷 蓝调',
    desc: '三连音律动的根-五-六循环（12 bar Blues 经典）',
    beatsPerBar: 4,
    events: [
      ev(0, 'R'),    ev(0.667, '5', 0.333, 0.8),
      ev(1, '5'),    ev(1.667, '6' as BassNote, 0.333, 0.8), // 6 暂不实现，用 5 替代
      ev(2, 'R', 1, 0.9), ev(2.667, '5', 0.333, 0.8),
      ev(3, '5'),    ev(3.667, 'R', 0.333, 0.8),
    ],
  },
  // ============ 三拍 ============
  {
    id: 'waltz',
    name: '华尔兹根音',
    category: '💃 三拍',
    desc: '强-弱-弱：根音 + 五度 + 五度',
    beatsPerBar: 3,
    events: [ev(0, 'R'), ev(1, '5', 1, 0.7), ev(2, '5', 1, 0.7)],
  },
];

/* ============ 自定义贝斯节奏型（localStorage） ============ */
const KEY = 'gl_custom_bass_patterns_v1';

export interface CustomBassPattern extends BassPattern {
  custom: true;
  createdAt: number;
}

export function loadCustomBassPatterns(): CustomBassPattern[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as CustomBassPattern[];
    return arr.filter(p => p && Array.isArray(p.events) && p.events.length > 0);
  } catch {
    return [];
  }
}

export function saveCustomBassPatterns(list: CustomBassPattern[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

export function createEmptyBassPattern(beatsPerBar: 3 | 4 = 4, name = '我的贝斯'): CustomBassPattern {
  return {
    id: 'cbass-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    category: '⭐ 自定义',
    desc: '我自己编辑的贝斯节奏型',
    beatsPerBar,
    events: [{ beat: 0, note: 'R', dur: 1, vel: 1 }],
    custom: true,
    createdAt: Date.now(),
  };
}

export function cloneBassPattern(p: BassPattern, newName?: string): CustomBassPattern {
  return {
    id: 'cbass-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: newName || (p.name + ' 副本'),
    category: '⭐ 自定义',
    desc: '基于「' + p.name + '」修改',
    beatsPerBar: p.beatsPerBar,
    events: p.events.map(e => ({ ...e })),
    custom: true,
    createdAt: Date.now(),
  };
}

/**
 * 根据和弦根音 pc 和音质，把 BassNote 转成实际 midi 音符
 * @param chordRootPc 和弦根音 pitch class (0-11)
 * @param isMinor 是否小调和弦
 * @param note BassNote 类型
 * @returns midi 编号（贝斯音域 E1=28 到 G3=55）
 */
export function bassNoteToMidi(chordRootPc: number, isMinor: boolean, note: BassNote): number | null {
  // 根音落在低音区（E1=28 到 D#3=51 之间），优先选择最接近 A1(33) 的八度
  const baseRoot = 33 + ((chordRootPc - 9 + 12) % 12); // 以 A1=33 为基准（pc=9）
  // 让根音落在 E1(28) 到 E2(40) 之间
  let root = baseRoot;
  while (root >= 41) root -= 12;
  while (root < 28) root += 12;

  switch (note) {
    case 'R':  return root;
    case 'L':  return root - 12;
    case 'O':  return root + 12;
    case '5':  return root + 7;
    case '3':  return root + (isMinor ? 3 : 4);
    case 'p5': return root + (isMinor ? 5 : 5); // 经过音用 4 度（往 5 度走的过渡）
    case 'X':  return null;
    default:   return root;
  }
}