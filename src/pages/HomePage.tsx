import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Component, type ReactNode, useEffect, useMemo, useState } from 'react';
import { getHeatmapDaysWithIntensity, getPracticeSummary, getTodayStats, getTopMistakes, loadAll, getDailySetTodaySummary } from '../utils/progress';
import { loadSavedProgressions, type SavedProgression } from '../utils/saved-progressions';
import { CHORDS } from '../theory/chords';
import ChordDiagram from '../components/ChordDiagram';
import { Icon } from '../components/Icon';

const MODULE_CARDS = [
  {
    to: '/learn',
    icon: 'learn',
    hub: 'learn',
    title: '学习',
    desc: '系统掌握和弦、音阶与指板基础。',
  },
  {
    to: '/practice',
    icon: 'practice',
    hub: 'practice',
    title: '练习',
    desc: '从调音、听音到综合训练，马上开练。',
  },
  {
    to: '/play',
    icon: 'play',
    hub: 'play',
    title: '伴奏',
    desc: '跟着节奏和和弦，把练习变成完整演奏。',
  },
] as const;

const NEXT_ACTIONS = {
  newbie: {
    title: '先完成第一次练习',
    desc: '从调音开始，接着做 5 题听音，再跟一条最简单的和弦走向。',
    to: '/practice?start=newbie',
    cta: '开始新手路径',
  },
  daily: {
    title: '先做今日 5 分钟',
    desc: '用一轮短练习把手感和耳朵都接起来，做完再自由探索。',
    to: '/practice/daily',
    cta: '开始今日套餐',
  },
  continue: {
    title: '继续今天的练习',
    desc: '先把今天的主线练完，再决定去补弱项还是去伴奏里玩起来。',
    to: '/practice/daily',
    cta: '回到今日套餐',
  },
} as const;

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
  if (!summary.hasAnyRecord) return '欢迎';
  const hour = new Date().getHours();
  if (hour < 11) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function getPrimaryAction(summary: ReturnType<typeof getPracticeSummary>) {
  if (!summary.hasAnyRecord) {
    return { label: '从调音开始', helper: '第一次来? 3 分钟带你跑通：调音 → 听音 → 跟弹一首。' };
  }
  if (summary.hasTodayRecord) {
    return { label: '继续今天练习', helper: '你已经开始了，继续保持手感。' };
  }
  return { label: '开始今天的练习', helper: '延续之前的进度，把练习重新接起来。' };
}

function getRecommendation(
  summary: ReturnType<typeof getPracticeSummary>,
  today: ReturnType<typeof getTodayStats>,
  savedToPractice: SavedProgression | null,
  fullyTunedToday: boolean,
) {
  if (savedToPractice) {
    return `练习你保存的「${savedToPractice.name}」（${savedToPractice.ids.length}个和弦）`;
  }
  if (!summary.hasAnyRecord) {
    return '第一次来，先调音，再做一次听音辨认热身。';
  }
  if (!summary.tunedToday) {
    return '今天还没调音，先把琴调准，再进入综合训练。';
  }
  if (fullyTunedToday) {
    return '🎸 已完整调音，开始练习吧！';
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
  const heatmapDays = useMemo(() => getHeatmapDaysWithIntensity(30), []);
  const savedToPractice = useMemo<SavedProgression | null>(() => {
    const list = loadSavedProgressions().filter(p => (p.practiceCount || 0) < 5);
    list.sort((a, b) => b.createdAt - a.createdAt);
    return list[0] || null;
  }, []);
  const topMistakes = useMemo(() => getTopMistakes(3), []);
  const dailySet = useMemo(() => getDailySetTodaySummary(), []);
  const primaryAction = getPrimaryAction(summary);
  const greeting = getGreeting(summary);
  const fullyTunedToday = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayRec = loadAll().find(r => r.date === todayStr);
    const sessions = Array.isArray(todayRec?.sessions) ? todayRec.sessions : [];
    return sessions.some(s => s.module === 'tuner-full');
  }, []);
  const recommendText = getRecommendation(summary, today, savedToPractice, fullyTunedToday);
  const newbieActivated = searchParams.get('start') === 'newbie';

  const handlePracticeSaved = () => {
    if (!savedToPractice) return;
    localStorage.setItem('gl_practice_pending', savedToPractice.id);
    navigate('/learn');
  };

  const handleWeakChord = (chordId: string) => {
    localStorage.setItem('gl_chords_pending_id', chordId);
    navigate('/learn');
  };

  const nextAction = !summary.hasAnyRecord
    ? NEXT_ACTIONS.newbie
    : summary.hasTodayRecord
      ? NEXT_ACTIONS.continue
      : NEXT_ACTIONS.daily;

  return (
    <div className="home-layout">
      <section className="hero-card">
        <div className="hero-topline">{greeting}</div>
        <h1>{summary.hasAnyRecord ? '今日练什么' : '从这里开始'}</h1>
        <p>{primaryAction.helper}</p>

        {summary.hasAnyRecord && (
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
              <strong>{summary.streak > 0 ? summary.streak : '—'}</strong>
            </div>
          </div>
        )}

        {summary.hasAnyRecord ? (
          <div className="hero-actions">
            <button className="btn btn-primary hero-btn" onClick={() => navigate('/practice/daily')}>
              {dailySet.completedCount > 0 ? '再来一次套餐' : '每日 5 分钟'}
            </button>
            <button className="btn btn-ghost hero-btn" onClick={() => navigate('/practice')}>
              {primaryAction.label}
            </button>
          </div>
        ) : (
          <>
            <div className="hero-actions">
              <button
                className="btn btn-primary hero-btn newbie-cta"
                onClick={() => navigate('/practice?start=newbie')}
              >
                我是新手 · 从调音开始
                <Icon name="arrow-right" size={16} strokeWidth={2.2} style={{ marginLeft: 6 }} />
              </button>
            </div>
            <button
              type="button"
              className="hero-skip-link"
              onClick={() => navigate('/practice/daily')}
            >
              或直接看每日 5 分钟套餐
            </button>
          </>
        )}

        {newbieActivated && (
          <div className="hero-inline-tip">已为你打开新手路径入口，去练习中心从调音器开始。</div>
        )}
      </section>

      <section className="recommend-card primary-path-card">
        <div className="card-kicker">今日主线</div>
        <h2>{nextAction.title}</h2>
        <p>{nextAction.desc}</p>
        <div className="primary-path-actions">
          <Link to={nextAction.to} className="btn btn-primary" style={{ textDecoration: 'none' }}>
            {nextAction.cta}
          </Link>
          {dailySet.completedCount > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/practice/daily')}>
              今日已完成 × {dailySet.completedCount}
            </button>
          )}
        </div>
      </section>

      <section className="recommend-card">
        <div className="card-kicker">做完主线后</div>
        <h2>{recommendText}</h2>
        {savedToPractice ? (
          <button className="btn btn-primary" onClick={handlePracticeSaved}>
            → 去练
          </button>
        ) : (
          <Link to="/practice" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            去完成推荐
          </Link>
        )}
      </section>

      {topMistakes.length > 0 && (
        <section className="card weak-chords-card">
          <div className="section-title">📌 需要补练</div>
          <div className="weak-chords-list">
            {topMistakes.map(m => {
              const chord = CHORDS.find(c => c.id === m.chordId);
              if (!chord) return null;
              return (
                <button
                  key={m.chordId}
                  type="button"
                  className="weak-chord-item"
                  aria-label={`${chord.name} 和弦，错过 ${m.count} 次，点击去练习`}
                  onClick={() => handleWeakChord(m.chordId)}
                >
                  <ChordDiagram shape={chord.shapes[0]} size={80} title={chord.name} colorMode="dark" />
                  <div className="wc-name">{chord.name}</div>
                  <div className="wc-badge" aria-hidden="true">×{m.count}</div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="card home-secondary-card">
        <div className="section-title section-tight">继续探索</div>
        <p className="home-secondary-copy">主线完成后，再去学新知识、补训练，或进伴奏把今天的手感接上。</p>
        <div className="home-grid home-grid-modules">
          {MODULE_CARDS.map((card) => (
            <Link key={card.to} to={card.to} className={`module-card module-card-${card.hub}`}>
              <span className="hc-icon" aria-hidden="true">
                <Icon name={card.icon} size={26} strokeWidth={1.7} />
              </span>
              <span className="hc-title">{card.title}</span>
              <span className="hc-desc">{card.desc}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="card home-secondary-card">
        <div className="section-title section-tight">30 天打卡</div>
        <div className="heat-strip">
          {heatmapDays.map((day) => (
            <div
              key={day.date}
              title={`${day.date} · ${Math.round(day.seconds / 60)} 分钟`}
              className={
                'heat-cell ' +
                (day.isToday ? 'today ' : '') +
                'level-' + day.level
              }
            />
          ))}
        </div>
        <div className="heat-legend">
          <span>少</span>
          <span className="heat-cell level-0" />
          <span className="heat-cell level-1" />
          <span className="heat-cell level-2" />
          <span className="heat-cell level-3" />
          <span className="heat-cell level-4" />
          <span>多</span>
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
            {isIOS && !deferredPrompt && (
              <span> iOS Safari：点击底部 <span aria-hidden="true">⬆</span> 分享 → 添加到主屏幕</span>
            )}
            {isAndroid && !deferredPrompt && <span> Android Chrome：菜单 → 添加到主屏幕</span>}
            {!isAndroid && !isIOS && !deferredPrompt && <span> 可安装为桌面应用（Chrome / Edge）。</span>}
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
