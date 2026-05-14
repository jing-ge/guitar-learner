import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getTodayStats, getRecentDays } from '../utils/progress';

const CARDS = [
  { to: '/tuner',     icon: '🎛', title: '调音器',       desc: '麦克风实时检测弦音，帮你把吉他调准再练习。' },
  { to: '/chords',    icon: '🎵', title: '和弦学习',     desc: '和弦指法图、转换练习、弹琴检测。' },
  { to: '/scales',    icon: '🎼', title: '音阶学习',     desc: '听音测试 + 弹琴识别 + 跟弹通关。' },
  { to: '/fretboard', icon: '🎸', title: '指板学习',     desc: '点击指板发声，含找音练习。' },
  { to: '/circle',    icon: '⭕', title: '五度圈',       desc: '乐理终极工具，学习调性关系与和弦走向。' },
  { to: '/listen',    icon: '🎧', title: '听歌识别',     desc: '实时识别和弦走向 + 听曲定调。' },
  { to: '/practice',  icon: '🎯', title: '综合练习',     desc: '节拍器、节奏型、歌曲谱、CAGED等。' }
];

function useInstallInfo() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  useEffect(() => {
    setIsStandalone(window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true);
    const handler = (e: Event) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  const install = async () => { if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; setDeferredPrompt(null); } };
  return { deferredPrompt, isStandalone, isIOS, isAndroid, install };
}

export default function HomePage() {
  const { deferredPrompt, isStandalone, isIOS, isAndroid, install } = useInstallInfo();
  const today = getTodayStats();
  const recent = getRecentDays(30);

  // 打卡日历：最近 30 天哪些天有练习
  const practicedDates = new Set(recent.filter(r => r.totalSeconds > 0).map(r => r.date));
  const calendarDays = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - 29 + i);
    return d.toISOString().slice(0, 10);
  });
  const streak = (() => {
    let count = 0;
    for (let i = calendarDays.length - 1; i >= 0; i--) {
      if (practicedDates.has(calendarDays[i])) count++;
      else if (i < calendarDays.length - 1) break; // 今天还没练也算（可能还没开始）
      else break;
    }
    return count;
  })();

  return (
    <div>
      {/* 今日练习摘要 */}
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, margin: '6px 0 10px' }}>
          <div>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--primary)' }}>{Math.floor(today.totalSeconds / 60)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>分钟</div>
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--green)' }}>{today.totalRight}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>答对</div>
          </div>
          <div>
            <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)' }}>{streak}</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>连续天数</div>
          </div>
        </div>

        {/* 30天打卡日历 */}
        <div style={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap' }}>
          {calendarDays.map(d => {
            const practiced = practicedDates.has(d);
            const isToday = d === new Date().toISOString().slice(0, 10);
            return (
              <div key={d} title={d} style={{
                width: 14, height: 14, borderRadius: 3,
                background: practiced ? 'var(--green)' : 'var(--bg-soft)',
                border: isToday ? '2px solid var(--primary)' : '1px solid var(--border)',
                opacity: practiced ? 1 : 0.4,
              }} />
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>最近 30 天打卡 · 绿色 = 当天有练习</div>
      </div>

      {/* 安装引导 */}
      {!isStandalone && (
        <div className="card" style={{ borderColor: 'var(--primary)', borderWidth: 2 }}>
          <h2>📱 安装到手机主屏幕</h2>
          {deferredPrompt && (<><p>检测到支持 PWA 安装：</p><button className="btn btn-primary" onClick={install}>安装到主屏幕</button></>)}
          {isAndroid && !deferredPrompt && (<p>Android Chrome：⋮ 菜单 → 「添加到主屏幕」</p>)}
          {isIOS && (<p>iOS Safari：分享 ⬆ → 「添加到主屏幕」</p>)}
          {!isAndroid && !isIOS && (<p>可将本站添加到桌面离线运行。</p>)}
        </div>
      )}

      <div className="section-title">学习模块</div>
      <div className="home-grid">
        {CARDS.map(c => (
          <Link key={c.to} to={c.to} className="home-card">
            <span className="hc-icon">{c.icon}</span>
            <span className="hc-title">{c.title}</span>
            <span className="hc-desc">{c.desc}</span>
          </Link>
        ))}
      </div>

      <div className="section-title">学习路径</div>
      <div className="card">
        <p><b>🌱 入门</b>（前 4 周）：调音器校准 → 指板认音 → 5 个开放和弦（C/G/D/Am/Em）→ 民谣万能节奏型。</p>
        <p><b>🎸 进阶</b>（1-3 月）：F 横按 → 和弦转换计时练习 → 五声音阶跟弹 → 歌曲和弦谱跟弹。</p>
        <p><b>🔥 提高</b>（3 月+）：五度圈 → CAGED 体系 → 调式音阶 → 听音/弹琴识别 → Blues 即兴。</p>
      </div>
    </div>
  );
}