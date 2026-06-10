import { useEffect, useMemo, useRef, useState } from 'react';
import Fretboard, { type LabelMode } from '../components/Fretboard';
import SubpageHero from '../components/SubpageHero';
import { ALL_ROOTS, fretToMidi, pcToName } from '../theory/notes';
import { synth } from '../audio/synth';
import { vibrate, vibratePattern } from '../utils/haptic';
import { recordSession } from '../utils/progress';

type Mode = 'explore' | 'find';

const MODE_META: Record<Mode, { label: string; title: string; desc: string }> = {
  explore: {
    label: '🔍 自由探索',
    title: '指板探索',
    desc: '点击任意位置发声，自由查看 12 个音的分布',
  },
  find: {
    label: '🎯 找音练习',
    title: '找音练习',
    desc: '出题后在指板上找出对应的音，不限定弦',
  },
};

export default function FretboardPage() {
  const [mode, setMode] = useState<Mode>('explore');
  const [labelMode, setLabelMode] = useState<LabelMode>('name');
  const [showAll, setShowAll] = useState(true);
  const [vertical, setVertical] = useState(false);

  // 找音练习相关状态
  const [target, setTarget] = useState<number>(() => Math.floor(Math.random() * 12));
  const [answered, setAnswered] = useState<{ correct: boolean; note: string } | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });

  // 找音模式的进度记录
  const findStartRef = useRef<number>(0);
  const lastFlushedRef = useRef<{ right: number; total: number }>({ right: 0, total: 0 });
  const scoreRef = useRef(score);
  useEffect(() => { scoreRef.current = score; }, [score]);

  const flushFind = (silent = false) => {
    const s = scoreRef.current;
    const pendingRight = s.right - lastFlushedRef.current.right;
    const pendingTotal = s.total - lastFlushedRef.current.total;
    if (pendingTotal <= 0) return;
    const elapsedSec = findStartRef.current > 0
      ? Math.max(1, Math.round((Date.now() - findStartRef.current) / 1000))
      : 1;
    recordSession('fretboard-find', pendingRight, pendingTotal, elapsedSec);
    lastFlushedRef.current = { right: s.right, total: s.total };
    findStartRef.current = Date.now();
    if (!silent) {
      window.dispatchEvent(new CustomEvent('progress-recorded', {
        detail: { text: `已记录 · 找音 ${s.right}/${s.total}` }
      }));
    }
  };

  // 进入 find 模式时初始化；离开 find 模式或卸载时 flush
  useEffect(() => {
    if (mode === 'find') {
      findStartRef.current = Date.now();
      lastFlushedRef.current = { right: 0, total: 0 };
      return () => { flushFind(false); };
    }
  }, [mode]);

  // 每答 5 题自动 flush
  useEffect(() => {
    if (mode !== 'find') return;
    const sinceFlushed = score.total - lastFlushedRef.current.total;
    if (sinceFlushed >= 5) flushFind(false);
  }, [score.total, mode]);

  // 探索模式下：展示全部 12 个音 / 仅自然音
  const exploreHighlight = useMemo(() => {
    const palette: Record<number, string> = {
      0:'#FB7185', 1:'#9ca3af', 2:'#f59e0b', 3:'#9ca3af', 4:'#84cc16',
      5:'#22D3EE', 6:'#9ca3af', 7:'#34D399', 8:'#9ca3af', 9:'#6366f1',
      10:'#9ca3af', 11:'#A78BFA'
    };
    if (showAll) return { pcColors: palette };
    return { pcColors: { 0: palette[0], 2: palette[2], 4: palette[4], 5: palette[5], 7: palette[7], 9: palette[9], 11: palette[11] } };
  }, [showAll]);

  const handleFindAnswer = async (stringNum: 1|2|3|4|5|6, fret: number) => {
    await synth.unlock();
    synth.playFret(stringNum, fret);
    const midi = fretToMidi(stringNum, fret);
    const pc = ((midi % 12) + 12) % 12;
    const correct = pc === target;
    setAnswered({ correct, note: pcToName(pc) });
    setScore(s => ({ right: s.right + (correct ? 1 : 0), total: s.total + 1 }));
    if (correct) vibrate(15); else vibratePattern([30, 50, 30]);
  };

  const nextQuestion = () => {
    setAnswered(null);
    let next = target;
    while (next === target) next = Math.floor(Math.random() * 12);
    setTarget(next);
  };

  return (
    <div>
      <SubpageHero
        eyebrow="LEARN · FRETBOARD"
        title={MODE_META[mode].title}
        desc={MODE_META[mode].desc}
        rightSlot={
          <button
            className="chip"
            onClick={() => setVertical(v => !v)}
            style={{ height: 32 }}
          >
            {vertical ? '↔ 横屏' : '↕ 竖屏'}
          </button>
        }
      >
        <div className="subpage-segmented" role="tablist">
          {(['explore', 'find'] as Mode[]).map(m => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'active' : ''}
              onClick={() => {
                setMode(m);
                if (m === 'find') { setAnswered(null); setScore({ right: 0, total: 0 }); }
              }}
            >
              {MODE_META[m].label}
            </button>
          ))}
        </div>
      </SubpageHero>

      {mode === 'explore' && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <div className="field">
              <label className="field-label">显示标签</label>
              <select className="select" value={labelMode} onChange={e => setLabelMode(e.target.value as LabelMode)}>
                <option value="name">音名（C/D/E…）</option>
                <option value="solfege">唱名（Do/Re/Mi…）</option>
                <option value="none">不显示</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label">显示范围</label>
              <select className="select" value={showAll ? 'all' : 'natural'} onChange={e => setShowAll(e.target.value === 'all')}>
                <option value="all">全部 12 个音</option>
                <option value="natural">仅自然音（白键）</option>
              </select>
            </div>
          </div>
          <div className={vertical ? 'fretboard-vertical-wrap' : 'fretboard-wrap'}>
            <Fretboard
              fromFret={0}
              toFret={vertical ? 7 : 12}
              highlight={exploreHighlight}
              labelMode={labelMode}
              vertical={vertical}
            />
          </div>
          <p className="fretboard-hint">💡 点击指板上任意位置即可发声。{vertical ? '竖屏模式：6弦在左、1弦在右，0-7品从上到下。' : '手机请左右滑动查看完整指板。'}</p>
        </>
      )}

      {mode === 'find' && (
        <>
          <div className="quiz-prompt">
            请在指板上找到：<span style={{ color: 'var(--brand-strong)' }}>{ALL_ROOTS[target].sharp}</span>
          </div>
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div>得分：<b>{score.right}</b> / {score.total}</div>
            <button className="btn btn-sm" onClick={nextQuestion}>换一题 →</button>
          </div>

          <div className={vertical ? 'fretboard-vertical-wrap' : 'fretboard-wrap'}>
            <Fretboard
              fromFret={0}
              toFret={vertical ? 7 : 12}
              labelMode="none"
              onClickPosition={handleFindAnswer}
              highlight={undefined}
              vertical={vertical}
            />
          </div>

          {answered && (
            <div className={'quiz-feedback ' + (answered.correct ? 'right' : 'wrong')}>
              {answered.correct
                ? `✅ 正确！这个位置就是 ${answered.note}`
                : `❌ 你点的是 ${answered.note}，再试试看`}
              {answered.correct && (
                <div style={{ marginTop: 8 }}>
                  <button className="btn btn-primary btn-sm" onClick={nextQuestion}>下一题</button>
                </div>
              )}
            </div>
          )}

          <p className="fretboard-hint" style={{ marginTop: 10 }}>
            💡 不限定弦，任何位置只要音对就算正确。
          </p>
        </>
      )}

      {/* 知识小贴士 */}
      <div className="section-title">基础知识</div>
      <div className="card">
        <p><b>标准调弦</b>（从 6 弦到 1 弦，由低到高）：<b>E A D G B E</b></p>
        <p><b>八度规律</b>：同一弦上 12 品 = 空弦音的高八度；相邻两弦同品位通常相差 5 个半音（除了 3 弦到 2 弦差 4 个半音）。</p>
        <p><b>记忆窍门</b>：先把 5、7、12 品的位置记牢，因为 12 品有双圆点指示，5 / 7 品有单圆点。</p>
      </div>
    </div>
  );
}