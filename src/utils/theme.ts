/** 深色/浅色主题切换 */
export type Theme = 'dark' | 'light';

const KEY = 'guitar-learner-theme';

export function getStoredTheme(): Theme {
  return (localStorage.getItem(KEY) as Theme) || 'dark';
}

export function setStoredTheme(t: Theme) {
  localStorage.setItem(KEY, t);
  applyTheme(t);
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
}

/** 初始化 */
export function initTheme() {
  const t = getStoredTheme();
  applyTheme(t);
  return t;
}