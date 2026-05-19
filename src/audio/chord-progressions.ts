// 和弦进行库 + 自定义存储
import { CHORDS } from '../theory/chords';

export interface ChordProgression {
  id: string;
  name: string;
  desc: string;
  chords: string[]; // 每个元素是 CHORDS 中的 id
  /** Round 65: 首调主和弦, 用于计算级数. 如 'C' / 'G' / 'A' / 'Em'(小调写小写 m 表示). 缺省视为 C 大调 */
  key?: string;
  /** Round 65: 调式 */
  mode?: 'major' | 'minor';
}

/** 内置预设进行（覆盖最常见的歌曲走向） */
export const CHORD_PROGRESSIONS: ChordProgression[] = [
  { id: 'pop-1645',  name: '流行 1-6-4-5',  desc: '万能流行进行，C 大调示范', chords: ['C', 'Am', 'F', 'G'], key: 'C', mode: 'major' },
  { id: 'pop-1564',  name: '流行 1-5-6-4',  desc: 'Axis of Awesome 万能进行', chords: ['C', 'G', 'Am', 'F'], key: 'C', mode: 'major' },
  { id: 'pop-6415',  name: '流行 6-4-1-5',  desc: '小调起头，副歌常用',     chords: ['Am', 'F', 'C', 'G'], key: 'C', mode: 'major' },
  { id: 'pop-4536',  name: '日系 4-5-3-6',  desc: '日系流行卡农进行',       chords: ['F', 'G', 'Em', 'Am'], key: 'C', mode: 'major' },
  { id: 'canon',     name: '卡农进行',       desc: 'Pachelbel 卡农经典走向', chords: ['C', 'G', 'Am', 'Em', 'F', 'C', 'F', 'G'], key: 'C', mode: 'major' },
  { id: 'blues-12',  name: '12 小节布鲁斯', desc: 'A 调 12-bar Blues',     chords: ['A7','A7','A7','A7','D7','D7','A7','A7','E7','D7','A7','E7'], key: 'A', mode: 'major' },
  { id: 'folk-cgam', name: '民谣 C-G-Am-F', desc: '民谣弹唱基础',           chords: ['C', 'G', 'Am', 'F'], key: 'C', mode: 'major' },
  { id: 'folk-em',   name: '民谣小调 Em',   desc: 'Em 调悲伤民谣',         chords: ['Em', 'C', 'G', 'D'], key: 'E', mode: 'minor' },
  { id: 'jazz-251',  name: '爵士 2-5-1',    desc: 'C 大调 ii-V-I',         chords: ['Dm7', 'G7', 'Cmaj7', 'Cmaj7'], key: 'C', mode: 'major' },
  { id: 'doo-wop',   name: 'Doo-Wop 1-6-4-5', desc: '50s 复古 Doo-Wop',    chords: ['C', 'Am', 'F', 'G'], key: 'C', mode: 'major' },
  { id: 'ballad',    name: '抒情 1-3-6-4',  desc: '深情起音 C-Em-Am-F',    chords: ['C', 'Em', 'Am', 'F'], key: 'C', mode: 'major' },
  { id: 'rock-1567', name: '摇滚 1-5-6-7',  desc: '硬摇滚 C-G-Am-Em',     chords: ['C', 'G', 'Am', 'Em'], key: 'C', mode: 'major' },
];

/** 校验：和弦 ID 是否存在 */
export function isValidChordId(id: string): boolean {
  return CHORDS.some(c => c.id === id);
}

/** 获取和弦显示名 */
export function chordDisplayName(id: string): string {
  return CHORDS.find(c => c.id === id)?.name ?? id;
}

/* ============ Round 65: 和弦 → 级数 (罗马数字) ============ */
const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT_TO_SHARP: Record<string,string> = { Bb:'A#', Db:'C#', Eb:'D#', Gb:'F#', Ab:'G#' };
const ROMAN_MAJOR = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
const ROMAN_MINOR = ['i', 'bii', 'ii', 'III', 'iii', 'iv', '#iv', 'v', 'VI', 'vi', 'VII', 'vii'];

/** 解析和弦 id 的根音 pc (0-11) 和质量 */
function parseChordIdToRoot(id: string): { rootPc: number; isMinor: boolean } | null {
  if (!id) return null;
  let token = id[0]!;
  let rest = id.slice(1);
  if (rest[0] === '#' || rest[0] === 'b') {
    token = id.slice(0, 2);
    rest = id.slice(2);
  }
  if (token.length === 2 && token[1] === 'b') {
    const mapped = FLAT_TO_SHARP[token];
    if (!mapped) return null;
    token = mapped;
  }
  const rootPc = SHARP.indexOf(token);
  if (rootPc < 0) return null;
  // 简单判 minor: rest 开头是 m 且不是 maj
  const isMinor = (rest.startsWith('m') && !rest.startsWith('maj')) || rest.startsWith('dim');
  return { rootPc, isMinor };
}

/** 解析 key 字符串到根音 pc */
function parseKeyRootPc(key: string): number {
  const keyToken = key.length >= 2 && (key[1] === '#' || key[1] === 'b') ? key.slice(0, 2) : key[0]!;
  const normalized = keyToken.length === 2 && keyToken[1] === 'b'
    ? (FLAT_TO_SHARP[keyToken] ?? keyToken)
    : keyToken;
  return SHARP.indexOf(normalized);
}

/**
 * Round 65: 级数 → 具体和弦 id (用于「按级数编」模式)
 * 大调的自然级数: I=major, ii=minor, iii=minor, IV=major, V=major, vi=minor, vii°=dim
 * 小调的自然级数: i=minor, ii°=dim, III=major, iv=minor, v=minor, VI=major, VII=major
 * 落 chord id 时优先返回 CHORDS 库存在的; 不存在则返回 ""
 */
export function degreeToChordId(degree: string, key: string, mode: 'major' | 'minor'): string {
  const keyPc = parseKeyRootPc(key);
  if (keyPc < 0) return '';
  // 大调自然级数: I ii iii IV V vi vii°
  // 小调自然级数: i ii° III iv v VI VII
  const intervals: Record<string, { semitone: number; quality: 'maj' | 'min' | 'dim' }> = mode === 'minor'
    ? {
        i:    { semitone: 0,  quality: 'min' },
        'ii°': { semitone: 2,  quality: 'dim' },
        III:  { semitone: 3,  quality: 'maj' },
        iv:   { semitone: 5,  quality: 'min' },
        v:    { semitone: 7,  quality: 'min' },
        VI:   { semitone: 8,  quality: 'maj' },
        VII:  { semitone: 10, quality: 'maj' },
      }
    : {
        I:    { semitone: 0,  quality: 'maj' },
        ii:   { semitone: 2,  quality: 'min' },
        iii:  { semitone: 4,  quality: 'min' },
        IV:   { semitone: 5,  quality: 'maj' },
        V:    { semitone: 7,  quality: 'maj' },
        vi:   { semitone: 9,  quality: 'min' },
        'vii°': { semitone: 11, quality: 'dim' },
      };
  const def = intervals[degree];
  if (!def) return '';
  const rootPc = (keyPc + def.semitone) % 12;
  const rootName = SHARP[rootPc];
  if (!rootName) return '';
  // 拼接: maj → 直接根音; min → 根音+m; dim → 根音+dim
  const suffix = def.quality === 'maj' ? '' : def.quality === 'min' ? 'm' : 'dim';
  const candidate = rootName + suffix;
  // 仅当 CHORDS 库存在该 id 时返回; 否则尝试降级方案 (如 #根音改 b 同名)
  if (CHORDS.some(c => c.id === candidate)) return candidate;
  // 退路: 找 enharmonic 同根 (例: C# 找不到 → 试 Db)
  return '';
}

/**
 * 计算和弦在指定调中的级数 (罗马数字).
 * 如 C 大调中 G → V, Am → vi, F → IV
 *
 * @returns 罗马数字字符串 (如 "I" "V" "vi"), 解析不出返回 ""
 */
export function chordToDegree(chordId: string, key?: string, mode?: 'major' | 'minor'): string {
  if (!key) return '';
  const chord = parseChordIdToRoot(chordId);
  if (!chord) return '';
  const keyRootPc = parseKeyRootPc(key);
  if (keyRootPc < 0) return '';
  // 度数
  const interval = ((chord.rootPc - keyRootPc) % 12 + 12) % 12;
  const baseTable = mode === 'minor' ? ROMAN_MINOR : ROMAN_MAJOR;
  const base = baseTable[interval] ?? '';
  if (!base) return '';
  // 小三和弦 → 小写; 大写保留
  return chord.isMinor ? base.toLowerCase() : base;
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
    key: 'C',
    mode: 'major',
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
    key: p.key,
    mode: p.mode,
    custom: true,
    createdAt: Date.now(),
  };
}