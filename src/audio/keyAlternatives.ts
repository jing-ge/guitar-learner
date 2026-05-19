/**
 * Round 59.1: 关系大小调工具
 *
 * 音乐学事实: A 小调与 C 大调使用完全相同的顺阶和弦集合
 *   (Am Bdim C Dm Em F G), 仅主和弦 (i vs I) 起手不同.
 *   Essentia.KeyExtractor 在二者之间的判别本质上是"哪个和弦能量重",
 *   置信度往往不高 (40-60%), 单一结论会误导用户.
 *
 * 解法 (借鉴 Round 43 README):
 *   UI 同时标注关系大小调, 让用户自行判断
 *
 * 关系调规则:
 *   - 大调 X → 关系小调 (X+9) % 12 (如 C(0) → A(9))
 *   - 小调 X → 关系大调 (X+3) % 12 (如 A(9) → C(0))
 *     ((9+3) % 12 = 0 ✓)
 */

import { SHARP_NAMES } from '../theory/notes';

export interface KeyDescriptor {
  rootPc: number;
  scale: 'major' | 'minor';
}

/** 给定调, 返回其关系调 */
export function getRelativeKey(rootPc: number, scale: 'major' | 'minor'): KeyDescriptor {
  if (scale === 'major') {
    return { rootPc: (rootPc + 9) % 12, scale: 'minor' };
  } else {
    return { rootPc: (rootPc + 3) % 12, scale: 'major' };
  }
}

/** 返回展示名 "C 大调" / "A 小调" */
export function keyDisplayName(rootPc: number, scale: 'major' | 'minor'): string {
  const name = SHARP_NAMES[((rootPc % 12) + 12) % 12];
  return `${name} ${scale === 'major' ? '大调' : '小调'}`;
}

/** 同时返回主调 + 关系调展示名, 用于双标注 */
export function bothKeysDisplay(rootPc: number, scale: 'major' | 'minor'): {
  primary: string;
  relative: string;
} {
  const rel = getRelativeKey(rootPc, scale);
  return {
    primary: keyDisplayName(rootPc, scale),
    relative: keyDisplayName(rel.rootPc, rel.scale),
  };
}
