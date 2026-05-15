import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import TunerPage from './TunerPage';
import ListenPage from './ListenPage';
import PracticePage from './PracticePage';

type PracticeTab = 'menu' | 'tuner' | 'listen' | 'general';

const ENTRY_CARDS: { key: Exclude<PracticeTab, 'menu'>; icon: string; label: string; desc: string }[] = [
  { key: 'tuner', icon: '🎛️', label: '调音器', desc: '先把六根弦调准，今天的练习更顺手。' },
  { key: 'listen', icon: '🎧', label: '听歌识别', desc: '播放音乐，识别和弦走向与变化。' },
  { key: 'general', icon: '🎯', label: '综合训练', desc: '进入训练菜单，做听音、节拍和记录。' },
];

export default function PracticeHub() {
  const [searchParams] = useSearchParams();
  const defaultTab = useMemo<PracticeTab>(() => {
    const start = searchParams.get('start');
    if (start === 'newbie') return 'tuner';
    return 'menu';
  }, [searchParams]);
  const [tab, setTab] = useState<PracticeTab>(defaultTab);

  return (
    <div>
      {tab === 'menu' && (
        <div className="practice-hub-menu">
          <div className="section-title section-tight">练习中心</div>
          <div className="practice-entry-list">
            {ENTRY_CARDS.map((entry) => (
              <button key={entry.key} className="module-menu-card practice-entry-card" onClick={() => setTab(entry.key)}>
                <div>
                  <div className="menu-card-title">{entry.icon} {entry.label}</div>
                  <p>{entry.desc}</p>
                </div>
                <span className="menu-card-tag">进入</span>
              </button>
            ))}
          </div>
          {searchParams.get('start') === 'newbie' && (
            <div className="empty-state">已为新手优先打开调音器入口，先从这里开始。</div>
          )}
        </div>
      )}

      {tab !== 'menu' && (
        <div className="subpage-header">
          <button className="btn btn-ghost subpage-back" onClick={() => setTab('menu')}>
            ← 返回练习菜单
          </button>
          <div className="subpage-title">
            {tab === 'tuner' ? '调音器' : tab === 'listen' ? '听歌识别' : '综合训练'}
          </div>
          <div className="subpage-meta">
            {tab === 'general' ? '7 个训练项' : '准备开始'}
          </div>
        </div>
      )}

      <div className={tab === 'menu' ? '' : 'practice-subpage'}>
        {tab === 'tuner' && <TunerPage />}
        {tab === 'listen' && <ListenPage />}
        {tab === 'general' && <PracticePage />}
      </div>
    </div>
  );
}
