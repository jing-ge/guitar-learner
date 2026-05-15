/** 练习记录持久化（localStorage） */

export interface DailyRecord {
  date: string;       // YYYY-MM-DD
  totalSeconds: number;
  sessions: { module: string; score: number; total: number; seconds: number; t?: number }[];
}

const KEY = 'guitar-learner-progress';

function normalizeSession(s: any): { module: string; score: number; total: number; seconds: number; t: number } {
  return {
    module: typeof s?.module === 'string' ? s.module : '',
    score: Number(s?.score) || 0,
    total: Number(s?.total) || 0,
    seconds: Number(s?.seconds) || 0,
    t: Number(s?.t) || 0,
  };
}

function normalizeRecord(r: any): DailyRecord {
  return {
    date: typeof r?.date === 'string' ? r.date : '',
    totalSeconds: Number(r?.totalSeconds) || 0,
    sessions: Array.isArray(r?.sessions) ? r.sessions.map(normalizeSession) : [],
  };
}

export type ProgressSummary = {
  hasAnyRecord: boolean;
  hasTodayRecord: boolean;
  totalDays: number;
  totalMinutes: number;
  streak: number;
  tunedToday: boolean;
  totalRight: number;
  totalQuestions: number;
};

export function loadAll(): DailyRecord[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalizeRecord)
      .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  } catch {
    return [];
  }
}

export function saveAll(records: DailyRecord[]) {
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
  if (!Array.isArray(rec.sessions)) rec.sessions = [];
  if (typeof rec.totalSeconds !== 'number') rec.totalSeconds = 0;
  rec.sessions.push({ module, score, total, seconds, t: Date.now() });
  rec.totalSeconds += seconds;
  saveAll(all);
}

/**
 * 限频记录：若今日同 module 最后一条 session 在 throttleSec 秒内，合并累加；
 * 否则 push 新 session。
 */
export function recordSessionThrottled(
  module: string,
  score: number,
  total: number,
  seconds: number,
  throttleSec = 30
): void {
  const all = loadAll();
  const d = today();
  let rec = all.find(r => r.date === d);
  if (!rec) { rec = { date: d, totalSeconds: 0, sessions: [] }; all.push(rec); }
  if (!Array.isArray(rec.sessions)) rec.sessions = [];
  if (typeof rec.totalSeconds !== 'number') rec.totalSeconds = 0;

  const now = Date.now();
  // 找最后一条 module 匹配的 session
  let lastIdx = -1;
  for (let i = rec.sessions.length - 1; i >= 0; i--) {
    if (rec.sessions[i].module === module) { lastIdx = i; break; }
  }
  const last = lastIdx >= 0 ? rec.sessions[lastIdx] : null;
  if (last && typeof last.t === 'number' && last.t > 0 && (now - last.t) < throttleSec * 1000) {
    last.score = (Number(last.score) || 0) + score;
    last.total = (Number(last.total) || 0) + total;
    last.seconds = (Number(last.seconds) || 0) + seconds;
    last.t = now;
    rec.totalSeconds += seconds;
  } else {
    rec.sessions.push({ module, score, total, seconds, t: now });
    rec.totalSeconds += seconds;
  }
  saveAll(all);
}

/** 获取最近 N 天的记录 */
export function getRecentDays(n = 30): DailyRecord[] {
  return loadAll().slice(-n);
}

/** 获取今日统计 */
export function getTodayStats(): { totalSeconds: number; totalRight: number; totalQuestions: number } {
  const rec = getToday();
  const sessions = Array.isArray(rec.sessions) ? rec.sessions : [];
  const totalRight = sessions.reduce((a, s) => a + s.score, 0);
  const totalQuestions = sessions.reduce((a, s) => a + s.total, 0);
  return { totalSeconds: rec.totalSeconds, totalRight, totalQuestions };
}

export function getPracticeSummary(): ProgressSummary {
  const all = loadAll();
  const todayDate = today();
  const todayRecord = all.find(record => record.date === todayDate);
  const practicedDates = new Set(all.filter(record => record.totalSeconds > 0).map(record => record.date));

  let streak = 0;
  const cursor = new Date();
  for (let i = 0; i < 90; i += 1) {
    const date = cursor.toISOString().slice(0, 10);
    if (practicedDates.has(date)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    if (i === 0) {
      cursor.setDate(cursor.getDate() - 1);
      continue;
    }
    break;
  }

  const totalSeconds = all.reduce((sum, record) => sum + record.totalSeconds, 0);
  const totalRight = all.reduce((sum, record) => {
    const sessions = Array.isArray(record.sessions) ? record.sessions : [];
    return sum + sessions.reduce((acc, session) => acc + session.score, 0);
  }, 0);
  const totalQuestions = all.reduce((sum, record) => {
    const sessions = Array.isArray(record.sessions) ? record.sessions : [];
    return sum + sessions.reduce((acc, session) => acc + session.total, 0);
  }, 0);
  const todaySessions = Array.isArray(todayRecord?.sessions) ? todayRecord.sessions : [];
  const tunedToday = todaySessions.some(session => session.module === 'tuner');

  return {
    hasAnyRecord: all.some(record => {
      const sessions = Array.isArray(record.sessions) ? record.sessions : [];
      return record.totalSeconds > 0 || sessions.length > 0;
    }),
    hasTodayRecord: !!todayRecord && (() => {
      const sessions = Array.isArray(todayRecord.sessions) ? todayRecord.sessions : [];
      return todayRecord.totalSeconds > 0 || sessions.length > 0;
    })(),
    totalDays: practicedDates.size,
    totalMinutes: Math.floor(totalSeconds / 60),
    streak,
    tunedToday,
    totalRight,
    totalQuestions,
  };
}

export function getHeatmapDays(days = 30): { date: string; active: boolean; isToday: boolean }[] {
  const recentMap = new Map(loadAll().map(record => [record.date, record]));
  const todayDate = today();

  return Array.from({ length: days }, (_, index) => {
    const dateValue = new Date();
    dateValue.setDate(dateValue.getDate() - (days - 1 - index));
    const date = dateValue.toISOString().slice(0, 10);
    const record = recentMap.get(date);
    const sessions = Array.isArray(record?.sessions) ? record.sessions : [];
    return {
      date,
      active: !!record && (record.totalSeconds > 0 || sessions.length > 0),
      isToday: date === todayDate,
    };
  });
}

/* ============ 热力图强度 (4 级) ============ */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

function secondsToLevel(seconds: number): HeatLevel {
  const s = Number(seconds) || 0;
  if (s < 60) return 0;
  if (s < 300) return 1;
  if (s < 900) return 2;
  if (s < 1800) return 3;
  return 4;
}

export function getHeatmapDaysWithIntensity(
  days = 30,
): { date: string; level: HeatLevel; isToday: boolean; seconds: number }[] {
  const recentMap = new Map(loadAll().map(record => [record.date, record]));
  const todayDate = today();

  return Array.from({ length: days }, (_, index) => {
    const dateValue = new Date();
    dateValue.setDate(dateValue.getDate() - (days - 1 - index));
    const date = dateValue.toISOString().slice(0, 10);
    const record = recentMap.get(date);
    // 守卫：sessions 可能不是数组；totalSeconds 可能不是 number
    const seconds = record && typeof record.totalSeconds === 'number' && isFinite(record.totalSeconds)
      ? Math.max(0, record.totalSeconds)
      : 0;
    return {
      date,
      seconds,
      level: secondsToLevel(seconds),
      isToday: date === todayDate,
    };
  });
}
