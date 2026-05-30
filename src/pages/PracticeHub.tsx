import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import TunerPage from './TunerPage';
import ListenPage from './ListenPage';
import PracticePage from './PracticePage';
import { Icon } from '../components/Icon';

type PracticeTab = 'menu' | 'tuner' | 'listen' | 'general';

const ENTRY_CARDS: { key: Exclude<PracticeTab, 'menu'>; icon: 'tuner' | 'headphones' | 'target'; label: string; desc: string; tag: string }[] = [
  { key: 'tuner', icon: 'tuner', label: '先把琴调准', desc: '适合刚拿起琴时先热身，确认六根弦音准再进入后面的练习。', tag: '建议先做' },
  { key: 'listen', icon: 'headphones', label: '用一段音频练耳朵', desc: '录一小段音乐或自己的弹奏，识别和弦、调性或主旋律。', tag: '练耳入口' },
  { key: 'general', icon: 'target', label: '开始今天的训练', desc: '进入听音、节奏、和弦走向等训练菜单，完成今天的主动练习。', tag: '主训练区' },
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
          <div className="card practice-hub-intro">
            <div className="card-kicker">今日先做什么</div>
            <h2>先完成一段短练习，再去自由探索</h2>
            <p>建议顺序：先调音，再做今日训练；如果你手边正有一段音乐，就直接用听歌识别练耳朵。</p>
          </div>
          <div className="section-title section-tight">练习中心</div>
          <div className="practice-entry-list">
            {ENTRY_CARDS.map((entry, index) => (
              <button key={entry.key} className={'module-menu-card practice-entry-card' + (index === 0 ? ' recommended' : '')} onClick={() => setTab(entry.key)}>
                <div className="entry-card-icon" aria-hidden="true">
                  <Icon name={entry.icon} size={24} />
                </div>
                <div className="entry-card-body">
                  <div className="menu-card-title">{entry.label}</div>
                  <p>{entry.desc}</p>
                </div>
                <span className="menu-card-tag">
                  {entry.tag} <Icon name="arrow-right" size={14} strokeWidth={2} style={{ marginLeft: 2 }} />
                </span>
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
            {tab === 'tuner' ? '调音器' : tab === 'listen' ? '听歌识别' : '今日训练'}
          </div>
          <div className="subpage-meta">
            {tab === 'tuner'
              ? '先确认音准，再进入后面的练习'
              : tab === 'listen'
                ? '录一小段音频，识别后继续练'
                : '听音、节奏、和弦走向等训练入口'}
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
