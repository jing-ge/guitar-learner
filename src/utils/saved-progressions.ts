/** 用户保存的和弦进行（识别 → 保存） */

const KEY = 'gl_saved_progressions_v1';
const MAX_ITEMS = 50;

export interface SavedProgression {
  id: string;
  name: string;
  ids: string[];
  detectedKey?: string;
  createdAt: number;
  lastPracticedAt?: number;
  practiceCount: number;
}

function normalizeItem(raw: any): SavedProgression | null {
  if (!raw || typeof raw !== 'object') return null;
  const ids = Array.isArray(raw.ids) ? raw.ids.filter((x: any) => typeof x === 'string' && x.length > 0) : [];
  if (ids.length === 0) return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : ('sp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const name = typeof raw.name === 'string' && raw.name ? raw.name : '未命名进行';
  const createdAt = Number(raw.createdAt);
  const lastPracticedAt = Number(raw.lastPracticedAt);
  const practiceCount = Number(raw.practiceCount);
  const detectedKey = typeof raw.detectedKey === 'string' && raw.detectedKey ? raw.detectedKey : undefined;
  return {
    id,
    name,
    ids,
    detectedKey,
    createdAt: isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    lastPracticedAt: isFinite(lastPracticedAt) && lastPracticedAt > 0 ? lastPracticedAt : undefined,
    practiceCount: isFinite(practiceCount) && practiceCount >= 0 ? Math.floor(practiceCount) : 0,
  };
}

export function loadSavedProgressions(): SavedProgression[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeItem).filter((x): x is SavedProgression => !!x);
  } catch {
    return [];
  }
}

export function saveSavedProgressions(items: SavedProgression[]): void {
  try {
    // FIFO: 超出上限时删最早 createdAt
    let list = items.slice();
    if (list.length > MAX_ITEMS) {
      list = list.slice().sort((a, b) => a.createdAt - b.createdAt).slice(list.length - MAX_ITEMS);
    }
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

export function addSavedProgression(
  p: Omit<SavedProgression, 'id' | 'createdAt' | 'practiceCount'>,
): SavedProgression {
  const list = loadSavedProgressions();
  const item: SavedProgression = {
    id: 'sp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: p.name,
    ids: p.ids.slice(),
    detectedKey: p.detectedKey,
    createdAt: Date.now(),
    practiceCount: 0,
  };
  list.push(item);
  saveSavedProgressions(list);
  return item;
}

export function removeSavedProgression(id: string): void {
  const list = loadSavedProgressions().filter(p => p.id !== id);
  saveSavedProgressions(list);
}

export function markPracticed(id: string): void {
  const list = loadSavedProgressions();
  const idx = list.findIndex(p => p.id === id);
  if (idx < 0) return;
  list[idx] = {
    ...list[idx],
    practiceCount: (list[idx].practiceCount || 0) + 1,
    lastPracticedAt: Date.now(),
  };
  saveSavedProgressions(list);
}
