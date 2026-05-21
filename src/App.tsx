import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { synth } from './audio/synth';
import { initTheme, setStoredTheme, type Theme } from './utils/theme';
import HomePage from './pages/HomePage';
import LearnHub from './pages/LearnHub';
import PracticeHub from './pages/PracticeHub';
import PlayHub from './pages/PlayHub';
import DailySetPage from './pages/DailySetPage';
import ProgressToast from './components/ProgressToast';
import { Icon } from './components/Icon';

// 底部 4 大主区导航
const TABS = [
  { to: '/home',     icon: 'home',     label: '首页' },
  { to: '/learn',    icon: 'learn',    label: '学习' },
  { to: '/practice', icon: 'practice', label: '练习' },
  { to: '/play',     icon: 'play',     label: '伴奏' },
] as const;

export default function App() {
  const [theme, setTheme] = useState<Theme>(initTheme);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setStoredTheme(next);
  };

  useEffect(() => {
    const handler = () => {
      synth.unlock();
      window.removeEventListener('pointerdown', handler);
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, []);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">跳到主内容</a>
      <header className="app-header">
        <NavLink to="/home" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <Icon name="play-fill" size={14} />
            </span>
            吉他学习
          </div>
        </NavLink>
        <div className="header-cluster">
          <button
            className="btn btn-ghost btn-sm theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
          </button>
          <div className="brand-sub">离线版</div>
        </div>
      </header>

      <main className="app-main" id="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/learn" element={<LearnHub />} />
          <Route path="/practice" element={<PracticeHub />} />
          <Route path="/practice/daily" element={<DailySetPage />} />
          <Route path="/play" element={<PlayHub />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>

      <ProgressToast />

      <nav className="bottom-nav">
        {TABS.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => 'tab-item' + (isActive ? ' active' : '')}
          >
            <span className="tab-icon">
              <Icon name={t.icon} size={22} strokeWidth={1.9} />
            </span>
            <span className="tab-label">{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}