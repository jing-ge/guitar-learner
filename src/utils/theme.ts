/** 深色/浅色主题切换 */
export type Theme = 'dark' | 'light';

const KEY = 'guitar-learner-theme';

/** Round 66: 主题对应的 native chrome 颜色 (与 web 端 .app-header / .bottom-nav 视觉对齐) */
export const THEME_CHROME: Record<Theme, string> = {
  dark:  '#0f1419',
  light: '#ffffff',
};

export function getStoredTheme(): Theme {
  return (localStorage.getItem(KEY) as Theme) || 'dark';
}

export function setStoredTheme(t: Theme) {
  localStorage.setItem(KEY, t);
  applyTheme(t);
  notifyNative(t);
}

export function applyTheme(t: Theme) {
  document.documentElement.setAttribute('data-theme', t);
}

/** Round 66: 通知 native WebView 容器切换 status bar / nav bar 颜色 */
export function notifyNative(t: Theme) {
  try {
    const rn = (window as any).ReactNativeWebView;
    if (rn && typeof rn.postMessage === 'function') {
      rn.postMessage(JSON.stringify({ type: 'theme', theme: t, chrome: THEME_CHROME[t] }));
    }
  } catch {}
}

/** 初始化 */
export function initTheme() {
  const t = getStoredTheme();
  applyTheme(t);
  notifyNative(t);
  return t;
}