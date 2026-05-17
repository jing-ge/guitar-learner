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

// 底部 4 大主区导航
const TABS = [
  { to: '/home',     icon: '🏠', label: '首页' },
  { to: '/learn',    icon: '📚', label: '学习' },
  { to: '/practice', icon: '🎯', label: '练习' },
  { to: '/play',     icon: '🎼', label: '伴奏' },
];

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
          <div className="brand">🎸 吉他学习</div>
        </NavLink>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={toggleTheme} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', padding: 4 }}>
            {theme === 'dark' ? '☀️' : '🌙'}
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
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}