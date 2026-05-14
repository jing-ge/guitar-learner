// 音符与音程基础
// 使用 12 半音体系，0=C, 1=C#, ..., 11=B（半音类 pitch class）

export const SHARP_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'] as const;
export const FLAT_NAMES  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'] as const;
export const SOLFEGE     = ['Do','Do#','Re','Re#','Mi','Fa','Fa#','Sol','Sol#','La','La#','Si'] as const;

export type NoteName = typeof SHARP_NAMES[number] | typeof FLAT_NAMES[number];
export type Accidental = 'sharp' | 'flat';

/** 把任意音名（含升降号）转成 0-11 的半音类 */
export function noteToPc(name: string): number {
  const m = name.trim().match(/^([A-Ga-g])([#b]?)$/);
  if (!m) throw new Error('非法音名: ' + name);
  const base: Record<string, number> = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
  let pc = base[m[1].toUpperCase()];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  return ((pc % 12) + 12) % 12;
}

/** 半音类 → 音名（按升降号偏好） */
export function pcToName(pc: number, acc: Accidental = 'sharp'): string {
  const idx = ((pc % 12) + 12) % 12;
  return acc === 'flat' ? FLAT_NAMES[idx] : SHARP_NAMES[idx];
}

/** 半音类 → 唱名 */
export function pcToSolfege(pc: number): string {
  return SOLFEGE[((pc % 12) + 12) % 12];
}

/**
 * MIDI 编号工具：A4=69, 中央C(C4)=60
 * 吉他六根弦（标准调弦，从 6 弦低音到 1 弦高音）：E2 A2 D3 G3 B3 E4
 * 对应 MIDI: 40, 45, 50, 55, 59, 64
 */
export const STANDARD_TUNING_MIDI: number[] = [40, 45, 50, 55, 59, 64];

/** 弦序号（1=最高音 e 弦，6=最低音 E 弦）+ 品位 → MIDI */
export function fretToMidi(stringNum: 1|2|3|4|5|6, fret: number, tuning = STANDARD_TUNING_MIDI): number {
  // tuning[0] 是 6 弦（最低音）, tuning[5] 是 1 弦（最高音）
  const open = tuning[6 - stringNum];
  return open + fret;
}

/** MIDI → 频率（A4=440Hz） */
export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** MIDI → 音名 + 八度，如 60 → "C4" */
export function midiToNoteName(midi: number, acc: Accidental = 'sharp'): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return pcToName(pc, acc) + octave;
}

/** 音程半音数表 */
export const INTERVAL_SEMITONES: Record<string, number> = {
  P1: 0,  m2: 1,  M2: 2,  m3: 3,  M3: 4,
  P4: 5,  TT: 6,  P5: 7,  m6: 8,  M6: 9,
  m7: 10, M7: 11, P8: 12,
};

export const INTERVAL_CN: Record<string, string> = {
  P1: '纯一度', m2: '小二度', M2: '大二度',
  m3: '小三度', M3: '大三度', P4: '纯四度',
  TT: '三全音', P5: '纯五度', m6: '小六度',
  M6: '大六度', m7: '小七度', M7: '大七度', P8: '纯八度',
};

/** 度数（相对主音的半音差）→ 度数标签 */
export function semitonesToDegree(semi: number): string {
  const map: Record<number, string> = {
    0:'1', 1:'b2', 2:'2', 3:'b3', 4:'3', 5:'4',
    6:'b5', 7:'5', 8:'b6', 9:'6', 10:'b7', 11:'7'
  };
  return map[((semi % 12) + 12) % 12];
}

/** 计算某音名相对主音的度数标签 */
export function noteDegree(rootPc: number, notePc: number): string {
  return semitonesToDegree(notePc - rootPc);
}

/** 全部 12 个根音（用于选择器） */
export const ALL_ROOTS: { pc: number; sharp: string; flat: string }[] = Array.from({ length: 12 }, (_, i) => ({
  pc: i,
  sharp: SHARP_NAMES[i],
  flat: FLAT_NAMES[i]
}));