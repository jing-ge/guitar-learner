// 音阶定义：每种音阶用相对主音的半音偏移数组表示
import { pcToName, type Accidental } from './notes';

export interface ScaleDef {
  id: string;
  name: string;       // 中文名
  enName: string;     // 英文名
  intervals: number[]; // 相对主音的半音偏移
  degrees: string[];   // 对应度数标签
  desc: string;
}

export const SCALES: ScaleDef[] = [
  {
    id: 'major',
    name: '自然大调',
    enName: 'Major (Ionian)',
    intervals: [0, 2, 4, 5, 7, 9, 11],
    degrees: ['1','2','3','4','5','6','7'],
    desc: '最常用的大调音阶，明亮、稳定。结构：全全半全全全半。'
  },
  {
    id: 'natural-minor',
    name: '自然小调',
    enName: 'Natural Minor (Aeolian)',
    intervals: [0, 2, 3, 5, 7, 8, 10],
    degrees: ['1','2','b3','4','5','b6','b7'],
    desc: '最常用的小调音阶，柔和、忧伤。结构：全半全全半全全。'
  },
  {
    id: 'harmonic-minor',
    name: '和声小调',
    enName: 'Harmonic Minor',
    intervals: [0, 2, 3, 5, 7, 8, 11],
    degrees: ['1','2','b3','4','5','b6','7'],
    desc: '将自然小调的 b7 升高半音，常用于古典与新古典金属。'
  },
  {
    id: 'melodic-minor',
    name: '旋律小调（上行）',
    enName: 'Melodic Minor (ascending)',
    intervals: [0, 2, 3, 5, 7, 9, 11],
    degrees: ['1','2','b3','4','5','6','7'],
    desc: '在自然小调基础上把 b6、b7 都升高半音，爵士常用。'
  },
  {
    id: 'major-pentatonic',
    name: '大调五声音阶',
    enName: 'Major Pentatonic',
    intervals: [0, 2, 4, 7, 9],
    degrees: ['1','2','3','5','6'],
    desc: '去除大调中的 4 和 7，五个音和谐安全，民谣/流行常用。'
  },
  {
    id: 'minor-pentatonic',
    name: '小调五声音阶',
    enName: 'Minor Pentatonic',
    intervals: [0, 3, 5, 7, 10],
    degrees: ['1','b3','4','5','b7'],
    desc: '摇滚与蓝调 solo 的基石，五个音怎么弹都不易出错。'
  },
  {
    id: 'blues',
    name: '蓝调音阶',
    enName: 'Blues Scale',
    intervals: [0, 3, 5, 6, 7, 10],
    degrees: ['1','b3','4','b5','5','b7'],
    desc: '在小调五声基础上加入 b5（蓝调音），充满蓝调味道。'
  },
  {
    id: 'dorian',
    name: '多利亚调式',
    enName: 'Dorian',
    intervals: [0, 2, 3, 5, 7, 9, 10],
    degrees: ['1','2','b3','4','5','6','b7'],
    desc: '比自然小调多了一个大六度，爵士、放克、摇滚常用。'
  },
  {
    id: 'mixolydian',
    name: '混合利底亚调式',
    enName: 'Mixolydian',
    intervals: [0, 2, 4, 5, 7, 9, 10],
    degrees: ['1','2','3','4','5','6','b7'],
    desc: '比大调把 7 降半音，常用于布鲁斯/南方摇滚 solo。'
  }
];

/** 根据根音(pc)和音阶定义，返回该音阶 7（或 5/6）个音的 pitch class */
export function scalePitchClasses(rootPc: number, scale: ScaleDef): number[] {
  return scale.intervals.map(i => ((rootPc + i) % 12 + 12) % 12);
}

/** 根据根音和音阶定义，返回每个音的音名 */
export function scaleNoteNames(rootPc: number, scale: ScaleDef, acc: Accidental = 'sharp'): string[] {
  return scalePitchClasses(rootPc, scale).map(pc => pcToName(pc, acc));
}