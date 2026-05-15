import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Component, type ReactNode, useEffect, useMemo, useState } from 'react';
import { getHeatmapDays, getPracticeSummary, getTodayStats } from '../utils/progress';

const MODULE_CARDS = [
  {
    to: '/learn',
    icon: '📚',
    title: '学习',
    desc: '系统掌握和弦、音阶与指板基础。',
  },
  {
    to: '/practice',
    icon: '🎯',
    title: '练习',
    desc: '从调音、听音到综合训练，马上开练。',
  },
  {
    to: '/play',
    icon: '🎼',
    title: '伴奏',
    desc: '跟着节奏和和弦，把练习变成完整演奏。',
  },
] as const;

function useInstallInfo() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  useEffect(() => {
    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true,
    );
    const handler = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const install = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      setDeferredPrompt(null);
    }
  };

  return { deferredPrompt, isStandalone, isIOS, isAndroid, install };
}

function getGreeting(summary: ReturnType<typeof getPracticeSummary>) {
  if (!summary.hasAnyRecord) return '继续练琴';
  const hour = new Date().getHours();
  if (hour < 11) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function getPrimaryAction(summary: ReturnType<typeof getPracticeSummary>) {
  if (!summary.hasAnyRecord) {
    return { label: '从调音开始', helper: '先把琴调准，再进入今天的练习。' };
  }
  if (summary.hasTodayRecord) {
    return { label: '继续今天练习', helper: '你已经开始了，继续保持手感。' };
  }
  return { label: '开始今天的练习', helper: '延续之前的进度，把练习重新接起来。' };
}

function getRecommendation(summary: ReturnType<typeof getPracticeSummary>, today: ReturnType<typeof getTodayStats>) {
  if (!summary.hasAnyRecord) {
    return '第一次来，先调音，再做一次听音辨认热身。';
  }
  if (!summary.tunedToday) {
    return '今天还没调音，先把琴调准，再进入综合训练。';
  }
  if (today.totalSeconds < 600) {
    return '已调音 ✓，再来一次听歌识别或听音辨认。';
  }
  if (today.totalQuestions > 0) {
    return `今天已答对 ${today.totalRight} 题，继续做五度圈速答巩固记忆。`;
  }
  return '今天状态不错，试试节拍器或歌曲跟弹把手感接上。';
}

type HomeErrorBoundaryState = {
  hasError: boolean;
};

class HomeErrorBoundary extends Component<{ children: ReactNode }, HomeErrorBoundaryState> {
  state: HomeErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): HomeErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('Home page render failed', error);
  }

  handleReset = () => {
    localStorage.removeItem('guitar-learner-progress');
    location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="home-layout">
          <section className="card">
            <div className="section-title">加载首页时出错</div>
            <p>进度数据可能已损坏。你可以重置本地进度数据后重新加载首页。</p>
            <div className="hero-actions">
              <button className="btn btn-primary hero-btn" onClick={this.handleReset}>
                重置进度数据
              </button>
              <Link to="/practice" className="btn btn-ghost hero-btn" style={{ textDecoration: 'none' }}>
                返回练习中心
              </Link>
            </div>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}

function HomePageInner() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { deferredPrompt, isStandalone, isIOS, isAndroid, install } = useInstallInfo();
  const today = getTodayStats();
  const summary = getPracticeSummary();
  const heatmapDays = useMemo(() => getHeatmapDays(30), []);
  const primaryAction = getPrimaryAction(summary);
  const greeting = getGreeting(summary);
  const recommendText = getRecommendation(summary, today);
  const newbieActivated = searchParams.get('start') === 'newbie';

  return (
    <div className="home-layout">
      <section className="hero-card">
        <div className="hero-topline">{greeting}</div>
        <h1>今日练什么</h1>
        <p>{primaryAction.helper}</p>

        <div className="hero-stats">
          <div className="stat-pill">
            <span>分钟</span>
            <strong>{Math.floor(today.totalSeconds / 60)}</strong>
          </div>
          <div className="stat-pill">
            <span>答对</span>
            <strong>{today.totalRight || 0}</strong>
          </div>
          <div className="stat-pill">
            <span>连续天数</span>
            <strong>{summary.streak || 0}</strong>
          </div>
        </div>

        <div className="hero-actions">
          <button className="btn btn-primary hero-btn" onClick={() => navigate('/practice')}>
            {primaryAction.label}
          </button>
          <button
            className="btn btn-ghost hero-btn"
            onClick={() => navigate('/practice?start=newbie')}
          >
            我是新手，带我开始
          </button>
        </div>

        {newbieActivated && (
          <div className="hero-inline-tip">已为你打开新手路径入口，去练习中心从调音器开始。</div>
        )}
      </section>

      <section className="recommend-card">
        <div className="card-kicker">今日推荐任务</div>
        <h2>{recommendText}</h2>
        <Link to="/practice" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          去完成推荐
        </Link>
      </section>

      <section>
        <div className="section-title">继续探索</div>
        <div className="home-grid home-grid-modules">
          {MODULE_CARDS.map((card) => (
            <Link key={card.to} to={card.to} className="module-card">
              <span className="hc-icon">{card.icon}</span>
              <span className="hc-title">{card.title}</span>
              <span className="hc-desc">{card.desc}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="section-title section-tight">30 天打卡</div>
        <div className="heat-strip">
          {heatmapDays.map((day) => (
            <div
              key={day.date}
              title={day.date}
              className={[
                'heat-cell',
                day.active ? 'active' : '',
                day.isToday ? 'today' : '',
              ].filter(Boolean).join(' ')}
            />
          ))}
        </div>
        <p>
          已累计练习 {summary.totalDays} 天，共 {summary.totalMinutes} 分钟。
        </p>
      </section>

      {!isStandalone && (
        <section className="install-bar">
          <div>
            <strong>安装到主屏幕</strong>
            {deferredPrompt && <span> 支持一键安装，离线也能打开。</span>}
            {isAndroid && !deferredPrompt && <span> Android Chrome：菜单 → 添加到主屏幕</span>}
            {isIOS && <span> iPhone Safari：分享 → 添加到主屏幕</span>}
            {!isAndroid && !isIOS && !deferredPrompt && <span> 可安装为桌面应用。</span>}
          </div>
          {deferredPrompt && (
            <button className="btn btn-ghost" onClick={install}>立即安装</button>
          )}
        </section>
      )}
    </div>
  );
}

export default function HomePageRoot() {
  return (
    <HomeErrorBoundary>
      <HomePageInner />
    </HomeErrorBoundary>
  );
}
