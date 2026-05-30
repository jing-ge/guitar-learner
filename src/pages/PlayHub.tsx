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

  const primaryEntry: { key: Exclude<PlayMode, 'menu'>; icon: PlayIcon; label: string; desc: string; tag: string } = {
    key: 'play-song',
    icon: 'song',
    label: '立即开弹',
    desc: '选一组段落和伴奏，直接把今天练的和弦与节奏弹起来。',
    tag: '主入口',
  };

  const libraryEntries: { key: Exclude<PlayMode, 'menu'>; icon: PlayIcon; label: string; desc: string; tag?: string }[] = [
    { key: 'lib-drum',  icon: 'drum',        label: '鼓机节奏库', desc: '挑一个 groove 或编辑你自己的鼓机 pattern。', tag: counts ? `${counts.drum} 个自定义` : undefined },
    { key: 'lib-chord', icon: 'progression', label: '和弦走向库', desc: '挑常见和弦进行，或保存你常练的走向。', tag: counts ? `${counts.chord} 个自定义` : undefined },
    { key: 'lib-strum', icon: 'strum',       label: '吉他节奏库', desc: '选择扫弦或分解型，让右手节奏更快接上。', tag: counts ? `${counts.strum} 个自定义` : undefined },
    { key: 'lib-bass',  icon: 'bass',        label: '贝斯节奏库', desc: '给和弦进行补一条低频走句，让合奏更完整。', tag: counts ? `${counts.bass} 个自定义` : undefined },
  ];

  if (mode === 'menu') {
    return (
      <div className="practice-hub-menu">
        <div className="card play-hub-intro">
          <div className="card-kicker">先玩起来</div>
          <h2>先用一套现成伴奏开弹，再决定要不要细调资源。</h2>
          <p>上面是立即使用入口，下面四项是你平时会复用的鼓机、和弦和节奏库。</p>
        </div>

        <div className="section-title section-tight">立即开弹</div>
        <button
          className="module-menu-card play-entry-card play-entry-primary"
          onClick={() => setMode(primaryEntry.key)}
        >
          <div className="entry-card-icon" aria-hidden="true">
            <Icon name={primaryEntry.icon} size={24} />
          </div>
          <div className="entry-card-body">
            <div className="menu-card-title">{primaryEntry.label}</div>
            <p>{primaryEntry.desc}</p>
          </div>
          <span className="menu-card-tag">
            {primaryEntry.tag} <Icon name="arrow-right" size={14} strokeWidth={2} style={{ marginLeft: 2 }} />
          </span>
        </button>

        <div className="section-title">编辑与复用资源</div>
        <div className="practice-entry-list">
          {libraryEntries.map((entry) => (
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
                进入资源库 <Icon name="arrow-right" size={14} strokeWidth={2} style={{ marginLeft: 2 }} />
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
