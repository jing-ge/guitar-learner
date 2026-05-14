// 鼓点节奏型库
// 每个 pattern 由 16 个 step 组成（4/4 拍下的 16 分音符），可视化栅格 = 16 列
// step 数组里存放该步触发的鼓件名（DrumVoice）
// 不同 section（前奏/主歌/副歌/间奏/尾奏）使用不同强度/疏密的鼓点，并可叠加 fill-in 加花

import type { DrumVoice } from './drum-machine';

export type SectionKind = 'intro' | 'verse' | 'chorus' | 'bridge' | 'outro';

export interface DrumPattern {
  id: string;
  name: string;
  category: string;
  bpm: number;          // 默认 BPM
  steps: number;        // 16 或 12（3/4 拍）
  /** 每个 step 触发的鼓件列表，长度 = steps */
  grid: DrumVoice[][];
  /** 描述 */
  desc: string;
}

/** 工具：把"位置数组" 转成 grid */
function makeGrid(steps: number, lanes: Partial<Record<DrumVoice, number[]>>): DrumVoice[][] {
  const grid: DrumVoice[][] = Array.from({ length: steps }, () => []);
  (Object.keys(lanes) as DrumVoice[]).forEach(voice => {
    (lanes[voice] || []).forEach(i => {
      if (i >= 0 && i < steps) grid[i].push(voice);
    });
  });
  return grid;
}

/**
 * 标准 4/4 鼓点库
 * 16 step = 1 小节，每 step = 1 个 16 分音符
 * 拍点位置：beat1=0, beat2=4, beat3=8, beat4=12
 */
export const DRUM_PATTERNS: DrumPattern[] = [
  // ============ 摇滚类 ============
  {
    id: 'rock-basic',
    name: '基础摇滚',
    category: '🤘 摇滚',
    bpm: 110,
    steps: 16,
    desc: '最经典的 4/4 摇滚节奏：底鼓在 1、3 拍，军鼓在 2、4 拍，踩镲 8 分。',
    grid: makeGrid(16, {
      kick:  [0, 8],
      snare: [4, 12],
      hihat: [0, 2, 4, 6, 8, 10, 12, 14],
    }),
  },
  {
    id: 'rock-power',
    name: '强力摇滚',
    category: '🤘 摇滚',
    bpm: 130,
    steps: 16,
    desc: '加密底鼓，更具推进力。',
    grid: makeGrid(16, {
      kick:  [0, 6, 8, 14],
      snare: [4, 12],
      hihat: [0, 2, 4, 6, 8, 10, 12, 14],
    }),
  },
  {
    id: 'rock-halftime',
    name: '半拍摇滚',
    category: '🤘 摇滚',
    bpm: 90,
    steps: 16,
    desc: '军鼓只落在第 3 拍，节奏沉重大气。',
    grid: makeGrid(16, {
      kick:  [0, 4, 10],
      snare: [8],
      hihat: [0, 2, 4, 6, 8, 10, 12, 14],
    }),
  },

  // ============ 流行/民谣类 ============
  {
    id: 'pop-basic',
    name: '流行基础',
    category: '🎤 流行/民谣',
    bpm: 100,
    steps: 16,
    desc: '流行口水歌通用鼓点，温和好听。',
    grid: makeGrid(16, {
      kick:  [0, 6, 8],
      snare: [4, 12],
      hihat: [0, 2, 4, 6, 8, 10, 12, 14],
    }),
  },
  {
    id: 'folk-light',
    name: '民谣轻拍',
    category: '🎤 流行/民谣',
    bpm: 90,
    steps: 16,
    desc: '只有 kick + clap，适合木吉他弹唱。',
    grid: makeGrid(16, {
      kick:  [0, 8],
      clap:  [4, 12],
      hihat: [2, 6, 10, 14],
    }),
  },
  {
    id: 'ballad',
    name: '抒情慢歌',
    category: '🎤 流行/民谣',
    bpm: 70,
    steps: 16,
    desc: '低速抒情，军鼓只在 2、4 拍。',
    grid: makeGrid(16, {
      kick:  [0, 8, 10],
      snare: [4, 12],
      hihat: [0, 4, 8, 12],
    }),
  },

  // ============ 布鲁斯/Shuffle ============
  {
    id: 'blues-shuffle',
    name: '布鲁斯 Shuffle',
    category: '🎷 布鲁斯',
    bpm: 95,
    steps: 12,
    desc: '12/8 拍三连音律动，每拍三连音。',
    grid: makeGrid(12, {
      kick:  [0, 6],
      snare: [3, 9],
      hihat: [0, 2, 3, 5, 6, 8, 9, 11],
    }),
  },
  {
    id: 'blues-slow',
    name: '慢布鲁斯',
    category: '🎷 布鲁斯',
    bpm: 65,
    steps: 12,
    desc: '低速 12/8，深沉。',
    grid: makeGrid(12, {
      kick:  [0, 6],
      snare: [3, 9],
      ride:  [0, 2, 3, 5, 6, 8, 9, 11],
    }),
  },

  // ============ 放克/律动 ============
  {
    id: 'funk-basic',
    name: '基础放克',
    category: '🕺 放克/律动',
    bpm: 105,
    steps: 16,
    desc: '切分的底鼓，律动感强。',
    grid: makeGrid(16, {
      kick:  [0, 3, 8, 10],
      snare: [4, 12],
      hihat: [0, 2, 4, 6, 8, 10, 12, 14],
    }),
  },
  {
    id: 'disco',
    name: 'Disco 律动',
    category: '🕺 放克/律动',
    bpm: 120,
    steps: 16,
    desc: '4 比 4 底鼓 + 反拍开镲。',
    grid: makeGrid(16, {
      kick:    [0, 4, 8, 12],
      snare:   [4, 12],
      hihat:   [0, 4, 8, 12],
      openhat: [2, 6, 10, 14],
    }),
  },
  {
    id: 'hiphop',
    name: 'Hip-Hop',
    category: '🕺 放克/律动',
    bpm: 88,
    steps: 16,
    desc: '说唱节奏，底鼓切分。',
    grid: makeGrid(16, {
      kick:  [0, 7, 10],
      snare: [4, 12],
      hihat: [0, 2, 4, 6, 8, 10, 12, 14],
    }),
  },

  // ============ 拉丁/雷鬼 ============
  {
    id: 'bossa',
    name: 'Bossa Nova',
    category: '🌴 拉丁/雷鬼',
    bpm: 120,
    steps: 16,
    desc: '巴萨诺瓦：温柔切分。',
    grid: makeGrid(16, {
      kick:  [0, 6, 8, 14],
      clap:  [3, 10],
      hihat: [0, 2, 4, 6, 8, 10, 12, 14],
    }),
  },
  {
    id: 'reggae',
    name: 'Reggae 雷鬼',
    category: '🌴 拉丁/雷鬼',
    bpm: 80,
    steps: 16,
    desc: '反拍重音，悠闲律动。',
    grid: makeGrid(16, {
      kick:  [4, 12],
      snare: [4, 12],
      hihat: [2, 6, 10, 14],
    }),
  },
  {
    id: 'samba',
    name: 'Samba 桑巴',
    category: '🌴 拉丁/雷鬼',
    bpm: 105,
    steps: 16,
    desc: '热情桑巴，繁密底鼓。',
    grid: makeGrid(16, {
      kick:  [0, 3, 6, 8, 11, 14],
      snare: [4, 12],
      hihat: [0, 2, 4, 6, 8, 10, 12, 14],
    }),
  },

  // ============ 华尔兹/三拍 ============
  {
    id: 'waltz',
    name: '华尔兹 3/4',
    category: '💃 三拍/华尔兹',
    bpm: 90,
    steps: 12,
    desc: '三拍子：强-弱-弱。',
    grid: makeGrid(12, {
      kick:  [0],
      snare: [4, 8],
      hihat: [0, 2, 4, 6, 8, 10],
    }),
  },
  {
    id: 'country-waltz',
    name: '乡村华尔兹',
    category: '💃 三拍/华尔兹',
    bpm: 110,
    steps: 12,
    desc: '欢快的三拍，常见于乡村歌曲。',
    grid: makeGrid(12, {
      kick:  [0, 6],
      snare: [4, 8],
      hihat: [0, 2, 4, 6, 8, 10],
    }),
  },

  // ============ 爵士/Swing ============
  {
    id: 'jazz-swing',
    name: '爵士 Swing',
    category: '🎺 爵士',
    bpm: 130,
    steps: 12,
    desc: 'Ride 镲为主，底鼓军鼓点缀。',
    grid: makeGrid(12, {
      kick:  [0],
      snare: [3, 9],
      ride:  [0, 2, 3, 5, 6, 8, 9, 11],
    }),
  },
];

/** 加花 fill-in（4 拍内打满，最后一小节用）— 16 step */
export const FILL_IN: DrumVoice[][] = (() => {
  const g: DrumVoice[][] = Array.from({ length: 16 }, () => []);
  // tom 滚奏
  g[0].push('snare');
  g[2].push('snare');
  g[4].push('tomH');
  g[6].push('tomH');
  g[8].push('tomM');
  g[10].push('tomM');
  g[12].push('tomL');
  g[14].push('tomL');
  // 收尾大镲
  g[0].push('crash');
  return g;
})();

/** 副歌起始的"开场镲" */
export const SECTION_OPEN: DrumVoice[][] = (() => {
  const g: DrumVoice[][] = Array.from({ length: 16 }, () => []);
  g[0].push('crash');
  return g;
})();

/**
 * 根据 section 类型给 pattern 加上"修饰"：
 * - intro: 简化（去掉踩镲，只保留 kick + 部分 snare）
 * - verse: 原版
 * - chorus: 加强（替换为 ride/openhat，每小节首拍叠 crash）
 * - bridge: 切分变化（kick 加密）
 * - outro: 渐弱版（同 verse 但建议降低音量，由播放器外部控制）
 */
export function applySection(
  base: DrumVoice[][],
  section: SectionKind,
  isFirstBarOfSection: boolean
): DrumVoice[][] {
  // 深拷贝
  let grid: DrumVoice[][] = base.map(s => [...s]);

  if (section === 'intro') {
    grid = grid.map(s => s.filter(v => v === 'kick' || v === 'snare' || v === 'hihat'));
    // 进一步稀释踩镲
    grid = grid.map((s, i) => i % 4 === 0 ? s : s.filter(v => v !== 'hihat'));
  } else if (section === 'chorus') {
    // 把 hihat 换成 ride，并在反拍多一个 openhat
    grid = grid.map(s => s.map(v => v === 'hihat' ? 'ride' : v));
    if (isFirstBarOfSection) grid[0].push('crash');
  } else if (section === 'bridge') {
    // 加密底鼓
    if (!grid[6].includes('kick')) grid[6].push('kick');
    if (!grid[14].includes('kick')) grid[14].push('kick');
  } else if (section === 'outro') {
    // 简化版
    grid = grid.map((s, i) => i % 4 === 0 ? s : s.filter(v => v !== 'kick'));
  }

  // 段落首拍叠 crash
  if (isFirstBarOfSection && section !== 'intro' && section !== 'chorus') {
    if (!grid[0].includes('crash')) grid[0].push('crash');
  }
  // 抑制 voiceless 步骤里只剩重复的 voice
  return grid.map(s => Array.from(new Set(s)));
}

/** Section 默认配置（每段重复几小节） */
export const SECTION_DEFAULTS: Record<SectionKind, { bars: number; label: string; color: string }> = {
  intro:  { bars: 2, label: '前奏',  color: '#6366f1' },
  verse:  { bars: 4, label: '主歌',  color: '#10b981' },
  chorus: { bars: 4, label: '副歌',  color: '#f59e0b' },
  bridge: { bars: 2, label: '间奏',  color: '#8b5cf6' },
  outro:  { bars: 2, label: '尾奏',  color: '#64748b' },
};