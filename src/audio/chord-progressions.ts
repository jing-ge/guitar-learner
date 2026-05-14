// 和弦进行库 + 自定义存储
import { CHORDS } from '../theory/chords';

export interface ChordProgression {
  id: string;
  name: string;
  desc: string;
  chords: string[]; // 每个元素是 CHORDS 中的 id
}

/** 内置预设进行（覆盖最常见的歌曲走向） */
export const CHORD_PROGRESSIONS: ChordProgression[] = [
  { id: 'pop-1645',  name: '流行 1-6-4-5',  desc: '万能流行进行，C 大调示范', chords: ['C', 'Am', 'F', 'G'] },
  { id: 'pop-1564',  name: '流行 1-5-6-4',  desc: 'Axis of Awesome 万能进行', chords: ['C', 'G', 'Am', 'F'] },
  { id: 'pop-6415',  name: '流行 6-4-1-5',  desc: '小调起头，副歌常用',     chords: ['Am', 'F', 'C', 'G'] },
  { id: 'pop-4536',  name: '日系 4-5-3-6',  desc: '日系流行卡农进行',       chords: ['F', 'G', 'Em', 'Am'] },
  { id: 'canon',     name: '卡农进行',       desc: 'Pachelbel 卡农经典走向', chords: ['C', 'G', 'Am', 'Em', 'F', 'C', 'F', 'G'] },
  { id: 'blues-12',  name: '12 小节布鲁斯', desc: 'A 调 12-bar Blues',     chords: ['A7','A7','A7','A7','D7','D7','A7','A7','E7','D7','A7','E7'] },
  { id: 'folk-cgam', name: '民谣 C-G-Am-F', desc: '民谣弹唱基础',           chords: ['C', 'G', 'Am', 'F'] },
  { id: 'folk-em',   name: '民谣小调 Em',   desc: 'Em 调悲伤民谣',         chords: ['Em', 'C', 'G', 'D'] },
  { id: 'jazz-251',  name: '爵士 2-5-1',    desc: 'C 大调 ii-V-I',         chords: ['Dm7', 'G7', 'Cmaj7', 'Cmaj7'] },
  { id: 'doo-wop',   name: 'Doo-Wop 1-6-4-5', desc: '50s 复古 Doo-Wop',    chords: ['C', 'Am', 'F', 'G'] },
  { id: 'ballad',    name: '抒情 1-3-6-4',  desc: '深情起音 C-Em-Am-F',    chords: ['C', 'Em', 'Am', 'F'] },
  { id: 'rock-1567', name: '摇滚 1-5-6-7',  desc: '硬摇滚 C-G-Am-Em',     chords: ['C', 'G', 'Am', 'Em'] },
];

/** 校验：和弦 ID 是否存在 */
export function isValidChordId(id: string): boolean {
  return CHORDS.some(c => c.id === id);
}

/** 获取和弦显示名 */
export function chordDisplayName(id: string): string {
  return CHORDS.find(c => c.id === id)?.name ?? id;
}

/* ============ 自定义和弦进行（localStorage） ============ */
const KEY = 'gl_custom_chord_progressions_v1';

export interface CustomChordProgression extends ChordProgression {
  custom: true;
  createdAt: number;
}

export function loadCustomProgressions(): CustomChordProgression[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as CustomChordProgression[];
    return arr.filter(p => p && Array.isArray(p.chords) && p.chords.length > 0);
  } catch {
    return [];
  }
}

export function saveCustomProgressions(list: CustomChordProgression[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

export function createEmptyProgression(name = '我的和弦进行'): CustomChordProgression {
  return {
    id: 'cprog-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    desc: '我自己编辑的和弦进行',
    chords: ['C', 'G', 'Am', 'F'],
    custom: true,
    createdAt: Date.now(),
  };
}

export function cloneProgression(p: ChordProgression, newName?: string): CustomChordProgression {
  return {
    id: 'cprog-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: newName || (p.name + ' 副本'),
    desc: '基于「' + p.name + '」修改',
    chords: [...p.chords],
    custom: true,
    createdAt: Date.now(),
  };
}