// 自定义鼓机模式：保存到 localStorage
import type { DrumVoice } from '../audio/drum-machine';
import type { DrumPattern } from '../audio/drum-patterns';

const KEY = 'gl_custom_drum_patterns_v1';

export interface CustomDrumPattern extends DrumPattern {
  /** 自定义模式标记，用于和内置区分 */
  custom: true;
  createdAt: number;
}

export function loadCustomPatterns(): CustomDrumPattern[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as CustomDrumPattern[];
    // 简单校验
    return arr.filter(p => p && Array.isArray(p.grid) && (p.steps === 16 || p.steps === 12));
  } catch {
    return [];
  }
}

export function saveCustomPatterns(list: CustomDrumPattern[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

export function createEmptyPattern(steps: 16 | 12, name = '我的鼓点'): CustomDrumPattern {
  return {
    id: 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    category: '⭐ 自定义',
    bpm: 100,
    steps,
    grid: Array.from({ length: steps }, () => []),
    desc: '我自己编辑的鼓点',
    custom: true,
    createdAt: Date.now(),
  };
}

export function clonePattern(p: DrumPattern, newName?: string): CustomDrumPattern {
  return {
    id: 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: newName || (p.name + ' 副本'),
    category: '⭐ 自定义',
    bpm: p.bpm,
    steps: p.steps,
    grid: p.grid.map(s => [...s]),
    desc: '基于「' + p.name + '」修改',
    custom: true,
    createdAt: Date.now(),
  };
}

/** 切换某个 step 上的某个鼓件 */
export function toggleCell(grid: DrumVoice[][], step: number, voice: DrumVoice): DrumVoice[][] {
  return grid.map((cell, i) => {
    if (i !== step) return cell;
    return cell.includes(voice) ? cell.filter(v => v !== voice) : [...cell, voice];
  });
}