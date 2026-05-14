// 和弦库：包含常用开放和弦、横按和弦、七和弦等
// 数组顺序：[6弦, 5弦, 4弦, 3弦, 2弦, 1弦]（低音 → 高音）
// 数字 = 品位，-1 = 不弹（mute），0 = 空弦
// fingers: 对应的手指（1=食指 2=中指 3=无名指 4=小指，0=空弦/不弹）

export interface ChordShape {
  frets: number[];   // 长度 6
  fingers?: number[];// 长度 6，可选
  baseFret?: number; // 起始品（默认为 1）。例如横按 5 品时 baseFret=5
  barre?: { fromString: number; toString: number; fret: number }; // 横按
}

export interface ChordDef {
  id: string;
  name: string;        // 显示名 如 C, Am, G7
  fullName: string;    // 中文全称
  quality: 'major' | 'minor' | 'dom7' | 'maj7' | 'min7' | 'sus' | 'dim' | 'aug';
  category: '开放和弦' | '横按和弦' | '七和弦' | '挂留和弦';
  shapes: ChordShape[]; // 一个和弦可能有多种按法
  difficulty: 1 | 2 | 3 | 4 | 5;
  tips?: string;
}

export const CHORDS: ChordDef[] = [
  // ============ 开放大三和弦 ============
  {
    id: 'C', name: 'C', fullName: 'C 大三和弦',
    quality: 'major', category: '开放和弦', difficulty: 1,
    shapes: [{ frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] }],
    tips: '基础和弦：5弦3品(无名指)、4弦2品(中指)、2弦1品(食指)，6弦不弹。'
  },
  {
    id: 'G', name: 'G', fullName: 'G 大三和弦',
    quality: 'major', category: '开放和弦', difficulty: 2,
    shapes: [{ frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] }],
    tips: '6弦3品、5弦2品、1弦3品，中间三根空弦响起。'
  },
  {
    id: 'D', name: 'D', fullName: 'D 大三和弦',
    quality: 'major', category: '开放和弦', difficulty: 1,
    shapes: [{ frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] }],
    tips: '只弹 4-1 弦。3弦2品、2弦3品、1弦2品，呈三角形。'
  },
  {
    id: 'A', name: 'A', fullName: 'A 大三和弦',
    quality: 'major', category: '开放和弦', difficulty: 1,
    shapes: [{ frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] }],
    tips: '4-2 弦都按 2 品，三个手指挤在一起。'
  },
  {
    id: 'E', name: 'E', fullName: 'E 大三和弦',
    quality: 'major', category: '开放和弦', difficulty: 1,
    shapes: [{ frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] }],
    tips: '6 根弦全弹响。最常用的开放和弦之一。'
  },
  {
    id: 'F', name: 'F', fullName: 'F 大三和弦（横按）',
    quality: 'major', category: '横按和弦', difficulty: 4,
    shapes: [{
      frets: [1, 3, 3, 2, 1, 1],
      fingers: [1, 3, 4, 2, 1, 1],
      barre: { fromString: 1, toString: 6, fret: 1 }
    }],
    tips: '吉他第一道难关：食指横按 1 品所有弦，其他手指做 E 形和弦。'
  },

  // ============ 开放小三和弦 ============
  {
    id: 'Am', name: 'Am', fullName: 'A 小三和弦',
    quality: 'minor', category: '开放和弦', difficulty: 1,
    shapes: [{ frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] }],
    tips: '把 A 和弦的 2 弦从 2 品下移到 1 品。'
  },
  {
    id: 'Em', name: 'Em', fullName: 'E 小三和弦',
    quality: 'minor', category: '开放和弦', difficulty: 1,
    shapes: [{ frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] }],
    tips: '最简单的和弦之一，只用两个手指。'
  },
  {
    id: 'Dm', name: 'Dm', fullName: 'D 小三和弦',
    quality: 'minor', category: '开放和弦', difficulty: 2,
    shapes: [{ frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] }],
    tips: '只弹 4-1 弦。1 弦由 D 和弦的 2 品下移到 1 品。'
  },

  // ============ 七和弦 ============
  {
    id: 'G7', name: 'G7', fullName: 'G 属七和弦',
    quality: 'dom7', category: '七和弦', difficulty: 2,
    shapes: [{ frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] }],
    tips: '把 G 和弦 1 弦的 3 品改到 1 品，听起来有"想回到 C"的感觉。'
  },
  {
    id: 'C7', name: 'C7', fullName: 'C 属七和弦',
    quality: 'dom7', category: '七和弦', difficulty: 2,
    shapes: [{ frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] }],
    tips: '在 C 和弦基础上 3 弦按 3 品（加入 bB 音）。'
  },
  {
    id: 'D7', name: 'D7', fullName: 'D 属七和弦',
    quality: 'dom7', category: '七和弦', difficulty: 1,
    shapes: [{ frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] }],
    tips: '指型很整齐，比 D 更"想往 G 走"。'
  },
  {
    id: 'A7', name: 'A7', fullName: 'A 属七和弦',
    quality: 'dom7', category: '七和弦', difficulty: 1,
    shapes: [{ frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 1, 0, 2, 0] }],
    tips: '只用两个手指，比 A 简单。'
  },
  {
    id: 'E7', name: 'E7', fullName: 'E 属七和弦',
    quality: 'dom7', category: '七和弦', difficulty: 1,
    shapes: [{ frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] }],
    tips: '布鲁斯的灵魂和弦之一。'
  },
  {
    id: 'Am7', name: 'Am7', fullName: 'A 小七和弦',
    quality: 'min7', category: '七和弦', difficulty: 1,
    shapes: [{ frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] }],
    tips: '在 Am 基础上把 3 弦的 2 品松开，变成空弦。'
  },
  {
    id: 'Dm7', name: 'Dm7', fullName: 'D 小七和弦',
    quality: 'min7', category: '七和弦', difficulty: 2,
    shapes: [{ frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 2, 1, 1] }],
  },
  {
    id: 'Em7', name: 'Em7', fullName: 'E 小七和弦',
    quality: 'min7', category: '七和弦', difficulty: 1,
    shapes: [{ frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0] }],
    tips: '最简单的和弦——只按一个音！'
  },
  {
    id: 'Cmaj7', name: 'Cmaj7', fullName: 'C 大七和弦',
    quality: 'maj7', category: '七和弦', difficulty: 1,
    shapes: [{ frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] }],
    tips: '在 C 和弦基础上松开 2 弦 1 品（变空弦），梦幻氛围感。'
  },
  {
    id: 'Gmaj7', name: 'Gmaj7', fullName: 'G 大七和弦',
    quality: 'maj7', category: '七和弦', difficulty: 2,
    shapes: [{ frets: [3, 2, 0, 0, 0, 2], fingers: [3, 2, 0, 0, 0, 1] }],
  },

  // ============ 横按和弦 ============
  {
    id: 'Bm', name: 'Bm', fullName: 'B 小三和弦（横按）',
    quality: 'minor', category: '横按和弦', difficulty: 4,
    shapes: [{
      frets: [-1, 2, 4, 4, 3, 2],
      fingers: [0, 1, 3, 4, 2, 1],
      barre: { fromString: 1, toString: 5, fret: 2 }
    }],
    tips: 'Am 形横按：食指横按 2 品 5-1 弦。'
  },
  {
    id: 'F#m', name: 'F#m', fullName: 'F# 小三和弦（横按）',
    quality: 'minor', category: '横按和弦', difficulty: 4,
    shapes: [{
      frets: [2, 4, 4, 2, 2, 2],
      fingers: [1, 3, 4, 1, 1, 1],
      barre: { fromString: 1, toString: 6, fret: 2 }
    }],
    tips: 'Em 形横按：食指横按 2 品全部 6 弦。'
  },
  {
    id: 'B7', name: 'B7', fullName: 'B 属七和弦',
    quality: 'dom7', category: '七和弦', difficulty: 3,
    shapes: [{ frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] }],
    tips: '不需要横按的 B7，弹民谣常用。'
  },

  // ============ 挂留和弦 ============
  {
    id: 'Dsus2', name: 'Dsus2', fullName: 'D 二度挂留和弦',
    quality: 'sus', category: '挂留和弦', difficulty: 1,
    shapes: [{ frets: [-1, -1, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 2, 0] }],
    tips: '在 D 基础上把 1 弦松开成空弦，更空灵。'
  },
  {
    id: 'Dsus4', name: 'Dsus4', fullName: 'D 四度挂留和弦',
    quality: 'sus', category: '挂留和弦', difficulty: 1,
    shapes: [{ frets: [-1, -1, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 2, 4] }],
    tips: '在 D 基础上把 1 弦从 2 品按到 3 品。常和 D 交替使用。'
  },
  {
    id: 'Asus2', name: 'Asus2', fullName: 'A 二度挂留和弦',
    quality: 'sus', category: '挂留和弦', difficulty: 1,
    shapes: [{ frets: [-1, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0] }],
  },
  {
    id: 'Asus4', name: 'Asus4', fullName: 'A 四度挂留和弦',
    quality: 'sus', category: '挂留和弦', difficulty: 1,
    shapes: [{ frets: [-1, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] }],
  },
  {
    id: 'Esus4', name: 'Esus4', fullName: 'E 四度挂留和弦',
    quality: 'sus', category: '挂留和弦', difficulty: 1,
    shapes: [{ frets: [0, 2, 2, 2, 0, 0], fingers: [0, 1, 2, 3, 0, 0] }],
  },
];

/** 按分类分组 */
export function chordsByCategory(): Record<string, ChordDef[]> {
  return CHORDS.reduce((acc, c) => {
    (acc[c.category] ||= []).push(c);
    return acc;
  }, {} as Record<string, ChordDef[]>);
}

/** 把和弦形状解析成实际发声的 (string, fret) 列表 */
export function chordPlayablePositions(shape: ChordShape): { stringNum: 1|2|3|4|5|6; fret: number }[] {
  // shape.frets[0] 对应 6 弦
  const result: { stringNum: 1|2|3|4|5|6; fret: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const fret = shape.frets[i];
    if (fret < 0) continue;
    const stringNum = (6 - i) as 1|2|3|4|5|6;
    result.push({ stringNum, fret });
  }
  return result;
}