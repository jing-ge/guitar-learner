// 练习中心：带反馈/计分的训练
// 调音器、听歌识别、听音辨认、五度圈速答、CAGED、记录

import { useState } from 'react';
import TunerPage from './TunerPage';
import ListenPage from './ListenPage';
// 复用 PracticePage 内部组件需要把它们抽出来；这里先用 PracticePage 整个，但
// 为简化，我们让 PracticeHub 直接嵌入 PracticePage 的子区段
// 简化方案：把 PracticePage 整体在「综合」子 tab 显示
import PracticePage from './PracticePage';

type PracticeTab = 'tuner' | 'listen' | 'general';

const TABS: { key: PracticeTab; icon: string; label: string; desc: string }[] = [
  { key: 'tuner',   icon: '🎛', label: '调音',     desc: '麦克风实时检测弦音' },
  { key: 'listen',  icon: '🎧', label: '听歌识别', desc: '播放音乐识别和弦走向' },
  { key: 'general', icon: '🎯', label: '综合训练', desc: '听音、五度圈、CAGED、记录' },
];

export default function PracticeHub() {
  const [tab, setTab] = useState<PracticeTab>('general');

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
        {tab === 'tuner' && <TunerPage />}
        {tab === 'listen' && <ListenPage />}
        {tab === 'general' && <PracticePage />}
      </div>
    </div>
  );
}