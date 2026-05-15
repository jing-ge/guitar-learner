// 学习中心：聚合所有"理论与基础"类页面
// 内部用子 tab 切换：和弦、音阶、五声音阶、指板、五度圈

import { useMemo, useState } from 'react';
import ChordsPage from './ChordsPage';
import ScalesPage from './ScalesPage';
import PentatonicPage from './PentatonicPage';
import FretboardPage from './FretboardPage';
import CircleOfFifthsPage from './CircleOfFifthsPage';
import { CHORDS } from '../theory/chords';
import { SCALES } from '../theory/scales';

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

  const subtitle = useMemo<{ title: string; meta?: string }>(() => {
    switch (tab) {
      case 'chords':    return { title: `🎵 和弦 · ${CHORDS.length} 个`, meta: '标准调弦' };
      case 'scales':    return { title: `🎼 音阶 · ${SCALES.length} 种` };
      case 'penta':     return { title: '🎯 五声 · 3 类', meta: '5 把位' };
      case 'fretboard': return { title: '🎸 指板' };
      case 'circle':    return { title: '⭕ 五度圈 · 12 调' };
    }
  }, [tab]);

  return (
    <div>
      <div className="hub-tabs" role="tablist" aria-label="学习中心子模块">
        {TABS.map(t => (
          <button key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            aria-label={t.label}
            className={'hub-tab' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}>
            <span className="hub-tab-icon" aria-hidden="true">{t.icon}</span>
            <span className="hub-tab-label">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="learn-subtitle" key={tab}>
        <span className="ls-title">{subtitle.title}</span>
        {subtitle.meta && <span className="ls-meta">{subtitle.meta}</span>}
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
