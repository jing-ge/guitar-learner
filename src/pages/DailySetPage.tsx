import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { synth } from '../audio/synth';
import { ALL_ROOTS, pcToName } from '../theory/notes';
import { CHORDS, chordPlayablePositions } from '../theory/chords';
import { recordSession, loadAll } from '../utils/progress';
import { vibrate, vibratePattern } from '../utils/haptic';

/**
 * 每日 5 分钟练习套餐（round30）
 *
 * 3 步串行：
 *  1) 热身 — 检查今日是否已调音；未调音引导去调音器（不强制阻塞）
 *  2) 乐理 — 听音辨认 5 题，自动进下一步
 *  3) 手感 — 跟一首短和弦走向跟弹（C-Am-F-G × 2，每和弦 4 拍 BPM 80）
 *
 * 完成后写入一条 'daily-set' 记录到 progress。
 */

type Step = 'intro' | 'warmup' | 'ear' | 'play' | 'done';

/** 听音题型（round33） */
interface NoteQuestion {
  kind: 'note';
  pc: number;            // 0~11
}
interface QualityQuestion {
  kind: 'quality';
  rootPc: number;        // 根音
  quality: 'major' | 'minor';
}
type EarQuestion = NoteQuestion | QualityQuestion;

type EarMistake =
  | { kind: 'note'; target: number; chosen: number }
  | { kind: 'quality'; rootPc: number; correct: 'major' | 'minor'; chosen: 'major' | 'minor' };

const QUIZ_QUESTIONS = 5;
const PLAY_BPM = 80;
const PLAY_BEATS_PER_CHORD = 4;

/** 跟弹走向池（round32）：每次进入随机选一个 */
interface ProgressionDef {
  id: string;
  name: string;          // 显示用名
  /** 一轮走向（4 个和弦），DailySetPage 会自动重复 2 轮 */
  chords: string[];
}
const PROGRESSIONS: ProgressionDef[] = [
  { id: '1-6-4-5',  name: '50 年代经典 (C-Am-F-G)', chords: ['C', 'Am', 'F', 'G'] },
  { id: '1-5-6-4',  name: '万能流行 (C-G-Am-F)',    chords: ['C', 'G', 'Am', 'F'] },
  { id: '6-4-1-5',  name: '感伤进行 (Am-F-C-G)',    chords: ['Am', 'F', 'C', 'G'] },
  { id: 'g-d-em-c', name: '清新民谣 (G-D-Em-C)',    chords: ['G', 'D', 'Em', 'C'] },
];

function pickProgression(): ProgressionDef {
  return PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
}

function isTunedToday(): boolean {
  const todayStr = new Date().toISOString().slice(0, 10);
  const rec = loadAll().find(r => r.date === todayStr);
  const sessions = Array.isArray(rec?.sessions) ? rec.sessions : [];
  return sessions.some(s => s.module === 'tuner' || s.module === 'tuner-full');
}

export default function DailySetPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('intro');
  const [earRight, setEarRight] = useState(0);
  const [earTotal, setEarTotal] = useState(0);
  const [mistakes, setMistakes] = useState<EarMistake[]>([]);
  const startRef = useRef<number>(Date.now());
  const completedStepsRef = useRef<number>(0);
  // 防止 finalize 在卸载兜底 + 显式完成时双记录
  const recordedRef = useRef<boolean>(false);

  // 完成 / 退出时统一记录
  const finalize = (completed: boolean) => {
    if (recordedRef.current) {
      // 已经记过 → 仅切视图
      if (completed) setStep('done');
      else navigate(-1);
      return;
    }
    const secs = Math.round((Date.now() - startRef.current) / 1000);
    // 用户明确完成 → 总是记录；否则至少练了 10 秒才记录（避免误触）
    if (completed || secs >= 10) {
      recordSession('daily-set', completedStepsRef.current, 3, secs);
      recordedRef.current = true;
    }
    if (completed) {
      setStep('done');
    } else {
      navigate(-1);
    }
  };

  // 兜底：组件卸载时（用户切底部 nav 跳走、关 PWA 等），若有进度但没完成，
  // 写一条记录，避免数据丢失。
  useEffect(() => {
    return () => {
      if (recordedRef.current) return;
      if (completedStepsRef.current === 0) return; // 还在 intro/warmup 起点，不记录
      const secs = Math.round((Date.now() - startRef.current) / 1000);
      if (secs >= 10) {
        recordSession('daily-set', completedStepsRef.current, 3, secs);
        recordedRef.current = true;
      }
    };
  }, []);

  // 步骤推进
  const goToWarmup = () => {
    startRef.current = Date.now();
    setStep('warmup');
  };
  const finishWarmup = () => {
    completedStepsRef.current = Math.max(completedStepsRef.current, 1);
    setStep('ear');
  };
  const finishEar = () => {
    completedStepsRef.current = Math.max(completedStepsRef.current, 2);
    setStep('play');
  };
  const finishPlay = () => {
    completedStepsRef.current = 3;
    finalize(true);
  };

  const stepTitle = step === 'warmup' ? '热身 · 调音' : step === 'ear' ? '听音辨认' : step === 'play' ? '和弦跟弹' : '';

  return (
    <div className="daily-set page-enter">
      {step !== 'intro' && step !== 'done' && (
        <>
          <div className="subpage-header">
            <button
              className="btn btn-ghost subpage-back"
              onClick={() => finalize(false)}
              aria-label="退出每日套餐"
            >
              ← 退出套餐
            </button>
            <div className="subpage-title">{stepTitle}</div>
            <div className="subpage-meta">每日 5 分钟</div>
          </div>
          <ProgressBar step={step} />
        </>
      )}

      {step === 'intro' && (
        <IntroStep onStart={goToWarmup} onCancel={() => navigate(-1)} />
      )}
      {step === 'warmup' && (
        <WarmupStep onNext={finishWarmup} onSkip={finishWarmup} />
      )}
      {step === 'ear' && (
        <EarStep
          right={earRight}
          total={earTotal}
          onAnswer={(correct, mistake) => {
            setEarTotal(t => t + 1);
            if (correct) setEarRight(r => r + 1);
            else if (mistake) setMistakes(prev => [...prev, mistake]);
          }}
          onDone={finishEar}
          onSkip={finishEar}
        />
      )}
      {step === 'play' && (
        <PlayStep onDone={finishPlay} onSkip={finishPlay} />
      )}
      {step === 'done' && (
        <DoneStep
          earRight={earRight}
          earTotal={earTotal}
          mistakes={mistakes}
          totalSeconds={Math.round((Date.now() - startRef.current) / 1000)}
          onAgain={() => {
            startRef.current = Date.now();
            completedStepsRef.current = 0;
            recordedRef.current = false;
            setEarRight(0);
            setEarTotal(0);
            setMistakes([]);
            setStep('warmup');
          }}
          onHome={() => navigate('/home')}
        />
      )}
    </div>
  );
}

/* ============ 顶部进度条 ============ */
function ProgressBar({ step }: { step: Step }) {
  const labels: { key: Step; label: string }[] = [
    { key: 'warmup', label: '调音' },
    { key: 'ear', label: '听音' },
    { key: 'play', label: '跟弹' },
  ];
  const activeIdx = labels.findIndex(l => l.key === step);
  return (
    <div className="daily-progress" role="progressbar"
      aria-valuemin={0} aria-valuemax={3} aria-valuenow={activeIdx + 1}>
      {labels.map((l, i) => (
        <div key={l.key} className={'daily-step' + (i < activeIdx ? ' done' : i === activeIdx ? ' active' : '')}>
          <span className="daily-step-dot">{i < activeIdx ? '✓' : i + 1}</span>
          <span className="daily-step-label">{l.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ============ Step 0: 介绍 ============ */
function IntroStep({ onStart, onCancel }: { onStart: () => void; onCancel: () => void }) {
  return (
    <section className="card daily-intro">
      <div className="card-kicker">每日 5 分钟练习</div>
      <h2>今日套餐</h2>
      <ol className="daily-intro-list">
        <li><b>调音</b> · 先确认琴已调准（已调音则一键跳过）</li>
        <li><b>听音辨认</b> · 5 道题热热耳朵</li>
        <li><b>和弦跟弹</b> · C–Am–F–G 走向 × 2 轮</li>
      </ol>
      <p className="daily-intro-tip">中途可以跳过任何一步，完成后会自动记录到练习数据。</p>
      <div className="daily-actions">
        <button className="btn btn-primary daily-btn-primary" onClick={onStart}>▶ 开始</button>
        <button className="btn btn-ghost" onClick={onCancel}>返回</button>
      </div>
    </section>
  );
}

/* ============ Step 1: 热身 / 调音 ============ */
function WarmupStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  const navigate = useNavigate();
  const tuned = useMemo(isTunedToday, []);
  return (
    <section className="card daily-step-card">
      <div className="card-kicker">第 1 步 · 热身</div>
      <h2>{tuned ? '✓ 今日已调音' : '🎛️ 先把琴调准'}</h2>
      <p>
        {tuned
          ? '你今天已经调过音了，可以直接进入听音热身。'
          : '点开调音器把六根弦调准，回到这里继续。如果你确认已调好，也可以直接跳过。'}
      </p>
      <div className="daily-actions">
        {!tuned && (
          <button className="btn btn-ghost" onClick={() => navigate('/practice')}>
            去调音器
          </button>
        )}
        <button className="btn btn-primary daily-btn-primary" onClick={onNext}>
          {tuned ? '继续 →' : '我已调好 →'}
        </button>
        {!tuned && (
          <button className="btn btn-ghost" onClick={onSkip}>跳过</button>
        )}
      </div>
    </section>
  );
}

/* ============ Step 2: 听音辨认 ============ */

/** 5 题题型组合：3 道单音 + 2 道大小三辨认，位置随机打乱 */
function buildEarQuiz(): EarQuestion[] {
  const qs: EarQuestion[] = [];
  const usedPc = new Set<number>();
  // 3 道单音
  while (qs.filter(q => q.kind === 'note').length < 3) {
    const pc = Math.floor(Math.random() * 12);
    if (usedPc.has(pc)) continue;
    usedPc.add(pc);
    qs.push({ kind: 'note', pc });
  }
  // 2 道大小三辨认（根音从常见 6 个里挑：C D E F G A）
  const QUALITY_ROOTS = [0, 2, 4, 5, 7, 9];
  const usedQ = new Set<string>();
  while (qs.filter(q => q.kind === 'quality').length < 2) {
    const root = QUALITY_ROOTS[Math.floor(Math.random() * QUALITY_ROOTS.length)];
    const q: 'major' | 'minor' = Math.random() < 0.5 ? 'major' : 'minor';
    const key = `${root}-${q}`;
    if (usedQ.has(key)) continue;
    usedQ.add(key);
    qs.push({ kind: 'quality', rootPc: root, quality: q });
  }
  // Fisher-Yates shuffle
  for (let i = qs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [qs[i], qs[j]] = [qs[j], qs[i]];
  }
  return qs;
}

/** 播放单音：基准 C4 = midi 60，pc 0 → C4 */
function playNote(pc: number) {
  return synth.unlock().then(() => synth.playMidi(60 + pc, 2.0));
}

/** 播放三和弦：根音 + 3rd + 5th（major: 4 半音; minor: 3 半音）以分解 + 同步混合方式 */
function playTriad(rootPc: number, quality: 'major' | 'minor') {
  return synth.unlock().then(() => {
    const t0 = synth.getCurrentTime();
    const third = quality === 'major' ? 4 : 3;
    const root = 60 + rootPc;
    // 先分解播一遍（低 → 高），再合奏一次，便于用户听清质量
    synth.playMidi(root,         1.2, t0);
    synth.playMidi(root + third, 1.2, t0 + 0.25);
    synth.playMidi(root + 7,     1.2, t0 + 0.50);
    synth.playMidi(root,         2.0, t0 + 0.9);
    synth.playMidi(root + third, 2.0, t0 + 0.9);
    synth.playMidi(root + 7,     2.0, t0 + 0.9);
  });
}

function EarStep({
  right, total, onAnswer, onDone, onSkip,
}: {
  right: number;
  total: number;
  onAnswer: (correct: boolean, mistake: EarMistake | null) => void;
  onDone: () => void;
  onSkip: () => void;
}) {
  // 整套题在挂载时一次生成
  const [quiz] = useState<EarQuestion[]>(buildEarQuiz);
  const current = quiz[Math.min(total, quiz.length - 1)];
  const [answered, setAnswered] = useState<
    | { kind: 'note'; chosenPc: number; correct: boolean }
    | { kind: 'quality'; chosenQuality: 'major' | 'minor'; correct: boolean }
    | null
  >(null);

  // 答完最后一题自动结束
  useEffect(() => {
    if (total >= QUIZ_QUESTIONS) {
      const t = window.setTimeout(onDone, 700);
      return () => window.clearTimeout(t);
    }
  }, [total, onDone]);

  // 进入第一题时自动播一次（后续题在 nextOne 里显式触发）
  useEffect(() => {
    const t = window.setTimeout(() => {
      const q = quiz[0];
      if (q.kind === 'note') playNote(q.pc);
      else playTriad(q.rootPc, q.quality);
    }, 300);
    return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 防止快速重点击造成多音叠加：1.5s 内冷却
  const lastPlayRef = useRef<number>(0);
  const replay = () => {
    const now = Date.now();
    if (now - lastPlayRef.current < 1500) return;
    lastPlayRef.current = now;
    if (current.kind === 'note') playNote(current.pc);
    else playTriad(current.rootPc, current.quality);
  };

  const chooseNote = (pc: number) => {
    if (answered || current.kind !== 'note') return;
    const correct = pc === current.pc;
    setAnswered({ kind: 'note', chosenPc: pc, correct });
    if (correct) vibrate(15); else vibratePattern([30, 50, 30]);
    onAnswer(correct, correct ? null : { kind: 'note', target: current.pc, chosen: pc });
  };

  const chooseQuality = (q: 'major' | 'minor') => {
    if (answered || current.kind !== 'quality') return;
    const correct = q === current.quality;
    setAnswered({ kind: 'quality', chosenQuality: q, correct });
    if (correct) vibrate(15); else vibratePattern([30, 50, 30]);
    onAnswer(
      correct,
      correct ? null : { kind: 'quality', rootPc: current.rootPc, correct: current.quality, chosen: q },
    );
  };

  const nextOne = () => {
    setAnswered(null);
    // 显式播放下一题（300ms 后，给 UI 切换留点时间）
    const nextIdx = total; // total 已被父组件递增过，下一题就是 quiz[total]
    const q = quiz[Math.min(nextIdx, quiz.length - 1)];
    window.setTimeout(() => {
      lastPlayRef.current = Date.now();
      if (q.kind === 'note') playNote(q.pc);
      else playTriad(q.rootPc, q.quality);
    }, 300);
  };

  const remaining = QUIZ_QUESTIONS - total;

  return (
    <section className="card daily-step-card">
      <div className="card-kicker">
        第 2 步 · 听音辨认 · 剩 {Math.max(0, remaining)} / {QUIZ_QUESTIONS}
      </div>
      <h2>
        {current.kind === 'note' ? '👂 这是什么音？' : '🎼 这是大三还是小三和弦？'}
      </h2>
      <div className="btn-row" style={{ justifyContent: 'center', marginTop: 6 }}>
        <button className="btn btn-primary" onClick={replay}>▶ 再听一次</button>
      </div>

      {current.kind === 'note' ? (
        <div className="chip-row" style={{ marginTop: 12, justifyContent: 'center' }}>
          {ALL_ROOTS.map(r => {
            const isChosen = answered?.kind === 'note' && answered.chosenPc === r.pc;
            const isCorrect = !!answered && r.pc === current.pc;
            const isWrong = !!answered && !answered.correct && isChosen;
            const mod = isCorrect ? ' correct' : isWrong ? ' wrong' : '';
            return (
              <button
                key={r.pc}
                className={'chip' + mod}
                onClick={() => chooseNote(r.pc)}
                disabled={!!answered}
              >
                {r.sharp}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="chip-row" style={{ marginTop: 14, justifyContent: 'center', gap: 12 }}>
          {(['major', 'minor'] as const).map(q => {
            const isChosen = answered?.kind === 'quality' && answered.chosenQuality === q;
            const isCorrect = !!answered && q === current.quality;
            const isWrong = !!answered && !answered.correct && isChosen;
            const mod = isCorrect ? ' correct' : isWrong ? ' wrong' : '';
            return (
              <button
                key={q}
                className={'chip chip-quality' + mod}
                onClick={() => chooseQuality(q)}
                disabled={!!answered}
              >
                {q === 'major' ? '大三 (明亮)' : '小三 (忧郁)'}
              </button>
            );
          })}
        </div>
      )}

      {answered && (
        <div className={'quiz-feedback ' + (answered.correct ? 'right' : 'wrong')}>
          {current.kind === 'note'
            ? (answered.correct ? `正确！${pcToName(current.pc)}` : `正确答案：${pcToName(current.pc)}`)
            : (answered.correct
                ? `正确！${pcToName(current.rootPc)} ${current.quality === 'major' ? '大三' : '小三'}`
                : `正确答案：${pcToName(current.rootPc)} ${current.quality === 'major' ? '大三' : '小三'}`)}
          <div style={{ marginTop: 8 }}>
            {total < QUIZ_QUESTIONS ? (
              <button className="btn btn-primary btn-sm" onClick={nextOne}>下一题 →</button>
            ) : (
              <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>完成本步</span>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 10, textAlign: 'center', fontSize: 13, color: 'var(--text-dim)' }}>
        本步得分：<b>{right}</b> / {total}
      </div>
      <div className="daily-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-ghost" onClick={onSkip}>跳过本步</button>
      </div>
    </section>
  );
}

/* ============ Step 3: 和弦跟弹 ============ */
function PlayStep({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  // 每次挂载时随机一个走向（重 mount 时刷新）
  const [progression, setProgression] = useState<ProgressionDef>(() => pickProgression());
  // 实际播放序列 = 走向 × 2 轮
  const sequence = useMemo(() => [...progression.chords, ...progression.chords], [progression]);

  const [playing, setPlaying] = useState(false);
  const [chordIdx, setChordIdx] = useState(0);
  const [beat, setBeat] = useState(0);
  const [bigMode, setBigMode] = useState(true);

  const nextNoteRef = useRef(0);
  const beatRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const uiQueueRef = useRef<{ beat: number; time: number; chordIdx: number }[]>([]);
  const uiTimerRef = useRef<number | null>(null);
  const doneFiredRef = useRef(false);

  // 把 onDone 存到 ref，避免每次父组件重渲染都重启调度器
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  // 走向变化时也要把 sequence 暴露给调度器（用 ref 持有最新值）
  const sequenceRef = useRef(sequence);
  useEffect(() => { sequenceRef.current = sequence; }, [sequence]);

  useEffect(() => {
    if (!playing) {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (uiTimerRef.current) cancelAnimationFrame(uiTimerRef.current);
      return;
    }

    const start = async () => {
      await synth.unlock();
      nextNoteRef.current = synth.getCurrentTime() + 0.15;
      beatRef.current = 0;
      uiQueueRef.current = [];
      doneFiredRef.current = false;
      setChordIdx(0);
      setBeat(0);

      const seq = sequenceRef.current;
      const totalBeats = seq.length * PLAY_BEATS_PER_CHORD;
      const interval = 60.0 / PLAY_BPM;
      const scheduleAheadTime = 0.15;
      const lookahead = 25.0;

      const scheduler = () => {
        while (nextNoteRef.current < synth.getCurrentTime() + scheduleAheadTime) {
          const b = beatRef.current;
          if (b >= totalBeats) {
            // 完成所有节拍 — 让 UI 显示到最后一拍再结束
            if (!doneFiredRef.current) {
              doneFiredRef.current = true;
              window.setTimeout(() => {
                setPlaying(false);
                onDoneRef.current();
              }, 200);
            }
            return;
          }
          const cIdx = Math.floor(b / PLAY_BEATS_PER_CHORD);
          const posInChord = b % PLAY_BEATS_PER_CHORD;
          if (posInChord === 0) {
            const ch = CHORDS.find(x => x.id === seq[cIdx]);
            if (ch) synth.strum(chordPlayablePositions(ch.shapes[0]), { when: nextNoteRef.current });
          } else {
            synth.click(false, nextNoteRef.current);
          }
          uiQueueRef.current.push({ beat: posInChord, time: nextNoteRef.current, chordIdx: cIdx });
          nextNoteRef.current += interval;
          beatRef.current = b + 1;
        }
        timerRef.current = window.setTimeout(scheduler, lookahead);
      };

      const drawUI = () => {
        const now = synth.getCurrentTime();
        let last: { beat: number; chordIdx: number } | null = null;
        while (uiQueueRef.current.length > 0 && uiQueueRef.current[0].time <= now) {
          const h = uiQueueRef.current.shift()!;
          last = { beat: h.beat, chordIdx: h.chordIdx };
        }
        if (last) {
          setBeat(last.beat);
          setChordIdx(last.chordIdx);
          if (last.beat === 0) vibrate(20);
        }
        uiTimerRef.current = requestAnimationFrame(drawUI);
      };

      scheduler();
      drawUI();
    };

    start();

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (uiTimerRef.current) cancelAnimationFrame(uiTimerRef.current);
    };
  }, [playing]);

  // 用户点"换一个走向"按钮：未播放时直接换；播放中先停
  const shuffle = () => {
    setPlaying(false);
    let next = progression;
    while (next.id === progression.id) {
      next = pickProgression();
    }
    setProgression(next);
    setChordIdx(0);
    setBeat(0);
  };

  const current = sequence[chordIdx];
  const next = chordIdx + 1 < sequence.length ? sequence[chordIdx + 1] : '完成';
  const arrow = progression.chords.join(' → ');

  return (
    <section className="card daily-step-card">
      <div className="card-kicker">
        第 3 步 · 和弦跟弹 · BPM {PLAY_BPM}
      </div>
      <h2>🎸 {progression.name}</h2>
      <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-dim)', marginTop: -4 }}>
        走向：<b>{arrow}</b>，重复 2 轮
      </p>
      {bigMode ? (
        <div className="daily-bigchord">
          <div className="daily-bigchord-now">{current}</div>
          <div className="daily-bigchord-next">下一个 → {next}</div>
          <div className="beat-dots" style={{ justifyContent: 'center', marginTop: 12 }}>
            {Array.from({ length: PLAY_BEATS_PER_CHORD }, (_, i) => (
              <div key={i} className={'beat-dot' + (playing && i === beat ? ' on' : '')} />
            ))}
          </div>
        </div>
      ) : (
        <div className="chip-row" style={{ justifyContent: 'center', marginTop: 8 }}>
          {sequence.map((id, i) => {
            const isCurrent = i === chordIdx && playing;
            return (
              <span key={i} className={'chip' + (isCurrent ? ' playing' : '')} style={{ minWidth: 56 }}>
                {id}
              </span>
            );
          })}
        </div>
      )}

      <div className="daily-actions" style={{ marginTop: 16 }}>
        <button
          className={'btn ' + (playing ? '' : 'btn-primary')}
          onClick={async () => { await synth.unlock(); setPlaying(p => !p); }}
        >
          {playing ? '■ 停止' : '▶ 开始跟弹'}
        </button>
        <button className="btn btn-ghost" onClick={() => setBigMode(b => !b)}>
          {bigMode ? '📋 列表' : '🔤 大字'}
        </button>
        <button className="btn btn-ghost" onClick={shuffle} aria-label="换一个走向">
          🎲 换走向
        </button>
        <button className="btn btn-ghost" onClick={onSkip}>完成本步</button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', marginTop: 10 }}>
        每个和弦持续 4 拍。听示范跟弹，或关掉示范自己练。
      </p>
    </section>
  );
}

/* ============ Step 4: 完成 ============ */
function DoneStep({
  earRight, earTotal, mistakes, totalSeconds, onAgain, onHome,
}: {
  earRight: number;
  earTotal: number;
  mistakes: EarMistake[];
  totalSeconds: number;
  onAgain: () => void;
  onHome: () => void;
}) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const replayMistake = (m: EarMistake) => {
    if (m.kind === 'note') playNote(m.target);
    else playTriad(m.rootPc, m.correct);
  };

  return (
    <section className="card daily-done">
      <div className="card-kicker">完成 ✓</div>
      <h2>🎉 今日套餐已完成</h2>
      <div className="daily-done-stats">
        <div>
          <div className="daily-done-num">{minutes}:{String(seconds).padStart(2, '0')}</div>
          <div className="daily-done-label">用时</div>
        </div>
        <div>
          <div className="daily-done-num">{earRight} / {earTotal}</div>
          <div className="daily-done-label">听音正确</div>
        </div>
      </div>

      {mistakes.length > 0 && (
        <div className="daily-mistakes">
          <div className="daily-mistakes-title">📌 听音错题回顾</div>
          <p className="daily-mistakes-hint">点正确答案再听一次，加深印象。</p>
          <div className="daily-mistakes-list">
            {mistakes.map((m, i) => {
              if (m.kind === 'note') {
                return (
                  <div key={i} className="daily-mistake-item">
                    <button
                      type="button"
                      className="chip daily-mistake-correct"
                      onClick={() => replayMistake(m)}
                      aria-label={`重听正确答案 ${pcToName(m.target)}`}
                    >
                      ▶ {pcToName(m.target)}
                    </button>
                    <span className="daily-mistake-arrow">你选了</span>
                    <span className="chip daily-mistake-wrong">{pcToName(m.chosen)}</span>
                  </div>
                );
              }
              // quality
              const correctLabel = `${pcToName(m.rootPc)} ${m.correct === 'major' ? '大三' : '小三'}`;
              const chosenLabel = `${m.chosen === 'major' ? '大三' : '小三'}`;
              return (
                <div key={i} className="daily-mistake-item">
                  <button
                    type="button"
                    className="chip daily-mistake-correct"
                    onClick={() => replayMistake(m)}
                    aria-label={`重听正确答案 ${correctLabel}`}
                  >
                    ▶ {correctLabel}
                  </button>
                  <span className="daily-mistake-arrow">你选了</span>
                  <span className="chip daily-mistake-wrong">{chosenLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {mistakes.length === 0 && earTotal > 0 && (
        <p className="daily-mistakes-empty">🌟 听音全对，今天耳朵在线！</p>
      )}

      <p style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', marginTop: 12 }}>
        练习数据已记录。坚持每天来一次，连续天数会更长 🔥
      </p>
      <div className="daily-actions">
        <button className="btn btn-primary daily-btn-primary" onClick={onAgain}>再来一次</button>
        <button className="btn btn-ghost" onClick={onHome}>回首页</button>
      </div>
    </section>
  );
}
