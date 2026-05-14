/** 练习记录持久化（localStorage） */

export interface DailyRecord {
  date: string;       // YYYY-MM-DD
  totalSeconds: number;
  sessions: { module: string; score: number; total: number; seconds: number }[];
}

const KEY = 'guitar-learner-progress';

function loadAll(): DailyRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch { return []; }
}

function saveAll(records: DailyRecord[]) {
  // 只保留最近 90 天
  const cut = records.slice(-90);
  localStorage.setItem(KEY, JSON.stringify(cut));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function getToday(): DailyRecord {
  const all = loadAll();
  const d = today();
  let rec = all.find(r => r.date === d);
  if (!rec) { rec = { date: d, totalSeconds: 0, sessions: [] }; all.push(rec); saveAll(all); }
  return rec;
}

/** 记录一次练习 */
export function recordSession(module: string, score: number, total: number, seconds: number) {
  const all = loadAll();
  const d = today();
  let rec = all.find(r => r.date === d);
  if (!rec) { rec = { date: d, totalSeconds: 0, sessions: [] }; all.push(rec); }
  rec.sessions.push({ module, score, total, seconds });
  rec.totalSeconds += seconds;
  saveAll(all);
}

/** 获取最近 N 天的记录 */
export function getRecentDays(n = 30): DailyRecord[] {
  return loadAll().slice(-n);
}

/** 获取今日统计 */
export function getTodayStats(): { totalSeconds: number; totalRight: number; totalQuestions: number } {
  const rec = getToday();
  const totalRight = rec.sessions.reduce((a, s) => a + s.score, 0);
  const totalQuestions = rec.sessions.reduce((a, s) => a + s.total, 0);
  return { totalSeconds: rec.totalSeconds, totalRight, totalQuestions };
}