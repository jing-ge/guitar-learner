import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { synth } from './audio/synth';
import { initTheme, setStoredTheme, type Theme } from './utils/theme';
import HomePage from './pages/HomePage';
import FretboardPage from './pages/FretboardPage';
import ChordsPage from './pages/ChordsPage';
import ScalesPage from './pages/ScalesPage';
import PracticePage from './pages/PracticePage';
import CircleOfFifthsPage from './pages/CircleOfFifthsPage';
import TunerPage from './pages/TunerPage';
import ListenPage from './pages/ListenPage';

const TABS = [
  { to: '/chords',     icon: '🎵', label: '和弦' },
  { to: '/scales',     icon: '🎼', label: '音阶' },
  { to: '/fretboard',  icon: '🎸', label: '指板' },
  { to: '/circle',     icon: '⭕', label: '五度圈' },
  { to: '/listen',     icon: '🎧', label: '听歌' },
  { to: '/tuner',      icon: '🎛', label: '调音' },
  { to: '/practice',   icon: '🎯', label: '练习' }
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

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/fretboard" element={<FretboardPage />} />
          <Route path="/chords" element={<ChordsPage />} />
          <Route path="/scales" element={<ScalesPage />} />
          <Route path="/circle" element={<CircleOfFifthsPage />} />
          <Route path="/listen" element={<ListenPage />} />
          <Route path="/tuner" element={<TunerPage />} />
          <Route path="/practice" element={<PracticePage />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>

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