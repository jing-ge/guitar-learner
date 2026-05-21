// 伴奏中心：菜单 + sticky 返回头（与 PracticeHub 同构）
import { useMemo, useState } from 'react';
import DrumMachinePage from './DrumMachinePage';
import { loadCustomPatterns } from '../utils/custom-drums';
import { loadCustomProgressions } from '../audio/chord-progressions';
import { loadCustomStrumPatterns } from '../audio/chord-strum-patterns';
import { loadCustomBassPatterns } from '../audio/bass-patterns';
import { Icon } from '../components/Icon';

type PlayMode = 'menu' | 'play-song' | 'lib-drum' | 'lib-chord' | 'lib-strum' | 'lib-bass';
type PlayIcon = 'song' | 'drum' | 'progression' | 'strum' | 'bass';

const MODE_TITLE: Record<Exclude<PlayMode, 'menu'>, string> = {
  'play-song': '歌曲合奏',
  'lib-drum': '鼓机节奏',
  'lib-chord': '和弦走向',
  'lib-strum': '吉他节奏',
  'lib-bass': '贝斯节奏',
};

export default function PlayHub() {
  const [mode, setMode] = useState<PlayMode>('menu');

  const counts = useMemo(() => {
    if (mode !== 'menu') return null;
    return {
      drum: loadCustomPatterns().length,
      chord: loadCustomProgressions().length,
      strum: loadCustomStrumPatterns().length,
      bass: loadCustomBassPatterns().length,
    };
  }, [mode]);

  const ENTRY_CARDS: { key: Exclude<PlayMode, 'menu'>; icon: PlayIcon; label: string; desc: string; tag?: string }[] = [
    { key: 'play-song', icon: 'song',        label: '歌曲合奏', desc: '选段落、选鼓+和弦+贝斯，一键合奏。' },
    { key: 'lib-drum',  icon: 'drum',        label: '鼓机节奏', desc: '编辑自定义鼓机节奏型。', tag: counts ? `${counts.drum} 个自定义` : undefined },
    { key: 'lib-chord', icon: 'progression', label: '和弦走向', desc: '编辑自定义和弦走向。',   tag: counts ? `${counts.chord} 个自定义` : undefined },
    { key: 'lib-strum', icon: 'strum',       label: '吉他节奏', desc: '编辑吉他扫弦/分解节奏型。', tag: counts ? `${counts.strum} 个自定义` : undefined },
    { key: 'lib-bass',  icon: 'bass',        label: '贝斯节奏', desc: '编辑贝斯走句节奏型。',   tag: counts ? `${counts.bass} 个自定义` : undefined },
  ];

  if (mode === 'menu') {
    return (
      <div className="practice-hub-menu">
        <div className="section-title section-tight">伴奏中心</div>
        <div className="practice-entry-list">
          {ENTRY_CARDS.map((entry) => (
            <button
              key={entry.key}
              className="module-menu-card play-entry-card"
              onClick={() => setMode(entry.key)}
            >
              <div className="entry-card-icon" aria-hidden="true">
                <Icon name={entry.icon} size={24} />
              </div>
              <div className="entry-card-body">
                <div className="menu-card-title">
                  {entry.label}
                  {entry.tag && <span className="play-entry-tag-num">{entry.tag}</span>}
                </div>
                <p>{entry.desc}</p>
              </div>
              <span className="menu-card-tag">
                进入 <Icon name="arrow-right" size={14} strokeWidth={2} style={{ marginLeft: 2 }} />
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="subpage-header">
        <button className="btn btn-ghost subpage-back" onClick={() => setMode('menu')}>
          ← 返回伴奏菜单
        </button>
        <div className="subpage-title">{MODE_TITLE[mode]}</div>
        <div className="subpage-meta" />
      </div>
      <div className="practice-subpage">
        <DrumMachinePage mode={mode} />
      </div>
    </div>
  );
}
