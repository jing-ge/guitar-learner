// 学习中心：聚合所有"理论与基础"类页面
// 内部用子 tab 切换：和弦、音阶、五声音阶、指板、五度圈

import { useState } from 'react';
import ChordsPage from './ChordsPage';
import ScalesPage from './ScalesPage';
import PentatonicPage from './PentatonicPage';
import FretboardPage from './FretboardPage';
import CircleOfFifthsPage from './CircleOfFifthsPage';

type LearnTab = 'chords' | 'scales' | 'penta' | 'fretboard' | 'circle';

const TABS: { key: LearnTab; icon: string; label: string }[] = [
  { key: 'chords',    icon: '🎵', label: '和弦' },
  { key: 'scales',    icon: '🎼', label: '音阶' },
  { key: 'penta',     icon: '🎯', label: '五声' },
  { key: 'fretboard', icon: '🎸', label: '指板' },
  { key: 'circle',    icon: '⭕', label: '五度圈' },
];

export default function LearnHub() {
  const [tab, setTab] = useState<LearnTab>('chords');

  return (
    <div>
      <div className="hub-tabs">
        {TABS.map(t => (
          <button key={t.key}
            className={'hub-tab' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}>
            <span className="hub-tab-icon">{t.icon}</span>
            <span className="hub-tab-label">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="hub-content">
        {tab === 'chords' && <ChordsPage />}
        {tab === 'scales' && <ScalesPage />}
        {tab === 'penta' && <PentatonicPage />}
        {tab === 'fretboard' && <FretboardPage />}
        {tab === 'circle' && <CircleOfFifthsPage />}
      </div>
    </div>
  );
}