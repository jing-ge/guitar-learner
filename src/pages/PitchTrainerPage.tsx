import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pitchDetector, type PitchResult } from '../audio/pitch-detector';
import { fretToMidi, midiToFreq, midiToNoteName, SHARP_NAMES } from '../theory/notes';
import { synth } from '../audio/synth';
import { recordSession } from '../utils/progress';
import { vibrate, vibratePattern } from '../utils/haptic';
import MicPermissionState, { type MicPermState } from '../components/MicPermissionState';

/**
 * 音准训练 Round 45
 *
 * 两个模式：
 *  - 弹准 (pluck): app 指定目标音 (3 题空弦 + 2 题带品位), 用户弹吉他, mic 检测 cents 偏差
 *  - 唱准 (sing): app 播放参考音, 用户跟唱, mic 检测
 *
 * 命中判定：|cents| ≤ 15 持续 ≥ 500ms = 准
 *           15 < |cents| ≤ 30 持续 1s = 接近 (0.5 分)
 *           5s 未达 = 错
 */

type Step = 'intro' | 'task' | 'done';
type Mode = 'pluck' | 'sing';

interface Question {
  midi: number;          // 目标 MIDI
  label: string;         // 显示用："G4 (3 弦空弦)" 或 "C4"
  category: 'open' | 'fretted' | 'pitch';  // 用于错题回顾分类
}

interface QuestionResult {
  q: Question;
  score: 0 | 0.5 | 1;
  bestCents: number;     // 最接近 0 的瞬时 cents
}

const TOTAL_QUESTIONS = 5;
const HIT_CENT_THRESHOLD = 15;
const NEAR_CENT_THRESHOLD = 30;
const HIT_HOLD_MS = 500;
const NEAR_HOLD_MS = 1000;
const MAX_TASK_MS = 8000;   // 单题最多 8 秒，超时算错
const MIN_RMS = 0.005;      // 静音门槛

// 弹准空弦池: E2(40) A2(45) D3(50) G3(55) B3(59) E4(64)
const OPEN_STRING_MIDIS = [40, 45, 50, 55, 59, 64];
// 弹准带品位池: 1-5 弦, 1-5 品 (string=2~5, fret=1~5, 共 20 个组合)
// 6 弦也排除 (避免太低麦克风识别困难)
function genFrettedOptions(): { string: 1|2|3|4|5|6; fret: number; midi: number }[] {
  const out: { string: 1|2|3|4|5|6; fret: number; midi: number }[] = [];
  for (let s = 2 as 2|3|4|5; s <= 5; s++) {
    for (let f = 1; f <= 5; f++) {
      out.push({ string: s as 2|3|4|5, fret: f, midi: fretToMidi(s as any, f) });
    }
  }
  return out;
}
const FRETTED_POOL = genFrettedOptions();

// 唱准目标音: 中音区 (A3~B4 = midi 57~71), 限于自然音
const SING_MIDIS = [57, 59, 60, 62, 64, 65, 67, 69, 71]; // A3 B3 C4 D4 E4 F4 G4 A4 B4

/** 弹准题库：3 空弦 + 2 带品位，随机不重复 */
function buildPluckQuiz(): Question[] {
  const qs: Question[] = [];
  const usedOpens = new Set<number>();
  while (qs.length < 3) {
    const midi = OPEN_STRING_MIDIS[Math.floor(Math.random() * OPEN_STRING_MIDIS.length)];
    if (usedOpens.has(midi)) continue;
    usedOpens.add(midi);
    // 反推弦号
    const stringIdx = OPEN_STRING_MIDIS.indexOf(midi);
    const stringNum = 6 - stringIdx; // E2 = 6 弦, E4 = 1 弦
    qs.push({
      midi,
      label: `${midiToNoteName(midi)} · ${stringNum} 弦空弦`,
      category: 'open',
    });
  }
  const usedFretted = new Set<string>();
  while (qs.length < TOTAL_QUESTIONS) {
    const f = FRETTED_POOL[Math.floor(Math.random() * FRETTED_POOL.length)];
    const k = `${f.string}-${f.fret}`;
    if (usedFretted.has(k)) continue;
    usedFretted.add(k);
    qs.push({
      midi: f.midi,
      label: `${midiToNoteName(f.midi)} · ${f.string} 弦 ${f.fret} 品`,
      category: 'fretted',
    });
  }
  // shuffle
  for (let i = qs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [qs[i], qs[j]] = [qs[j], qs[i]];
  }
  return qs;
}

/** 唱准题库：5 道纯音名（中音区） */
function buildSingQuiz(): Question[] {
  const qs: Question[] = [];
  const used = new Set<number>();
  while (qs.length < TOTAL_QUESTIONS) {
    const m = SING_MIDIS[Math.floor(Math.random() * SING_MIDIS.length)];
    if (used.has(m)) continue;
    used.add(m);
    qs.push({ midi: m, label: midiToNoteName(m), category: 'pitch' });
  }
  return qs;
}

export default function PitchTrainerPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('intro');
  const [mode, setMode] = useState<Mode>('pluck');
  const [micState, setMicState] = useState<MicPermState>('idle');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [results, setResults] = useState<QuestionResult[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [currentCents, setCurrentCents] = useState<number | null>(null);
  const [currentNote, setCurrentNote] = useState<string>('-');
  const [currentMidi, setCurrentMidi] = useState<number | null>(null);
  const [hitProgress, setHitProgress] = useState(0); // 0-1, 当前命中状态保持的比例
  const [taskFeedback, setTaskFeedback] = useState<'idle' | 'hit' | 'near' | 'miss'>('idle');

  const startTimeRef = useRef<number>(0);
  const questionStartRef = useRef<number>(0);
  const hitStartRef = useRef<number>(0);
  const nearStartRef = useRef<number>(0);
  const bestCentsRef = useRef<number>(999);
  const recordedRef = useRef<boolean>(false);

  const currentQuestion = questions[currentIdx];

  const stopDetector = useCallback(() => {
    pitchDetector.stop();
  }, []);

  // 命中处理 — 每帧调用
  const handleResult = useCallback((res: PitchResult | null) => {
    if (!currentQuestion) return;
    if (!res || res.rms < MIN_RMS) {
      setCurrentCents(null);
      setCurrentNote('-');
      setCurrentMidi(null);
      hitStartRef.current = 0;
      nearStartRef.current = 0;
      setHitProgress(0);
      return;
    }

    // 计算 cents 偏差到目标 midi（不仅是最近 midi）
    const exactMidi = 69 + 12 * Math.log2(res.freq / 440);
    const centsToTarget = (exactMidi - currentQuestion.midi) * 100;
    const abs = Math.abs(centsToTarget);

    setCurrentCents(Math.round(centsToTarget));
    setCurrentNote(res.noteName);
    setCurrentMidi(res.midi);

    if (abs < bestCentsRef.current) bestCentsRef.current = abs;

    const now = performance.now();
    if (abs <= HIT_CENT_THRESHOLD) {
      if (hitStartRef.current === 0) hitStartRef.current = now;
      const held = now - hitStartRef.current;
      setHitProgress(Math.min(1, held / HIT_HOLD_MS));
      if (held >= HIT_HOLD_MS) {
        // 命中
        commitResult(1);
      }
    } else {
      hitStartRef.current = 0;
      if (abs <= NEAR_CENT_THRESHOLD) {
        if (nearStartRef.current === 0) nearStartRef.current = now;
        const heldNear = now - nearStartRef.current;
        setHitProgress(Math.min(0.6, heldNear / NEAR_HOLD_MS * 0.6));
        if (heldNear >= NEAR_HOLD_MS) {
          commitResult(0.5);
        }
      } else {
        nearStartRef.current = 0;
        setHitProgress(0);
      }
    }
  }, [currentQuestion]);

  const commitResult = useCallback((score: 0 | 0.5 | 1) => {
    if (!currentQuestion) return;
    if (score === 1) vibrate(20);
    else if (score === 0.5) vibrate(10);
    else vibratePattern([30, 50, 30]);

    setTaskFeedback(score === 1 ? 'hit' : score === 0.5 ? 'near' : 'miss');
    setResults(prev => {
      const next = [...prev, {
        q: currentQuestion,
        score,
        bestCents: bestCentsRef.current,
      }];
      return next;
    });
    // 1.2 秒后下一题
    window.setTimeout(() => {
      if (currentIdx + 1 >= questions.length) {
        stopDetector();
        setStep('done');
      } else {
        // reset
        bestCentsRef.current = 999;
        hitStartRef.current = 0;
        nearStartRef.current = 0;
        questionStartRef.current = performance.now();
        setHitProgress(0);
        setTaskFeedback('idle');
        setCurrentIdx(i => i + 1);
      }
    }, 1200);
  }, [currentIdx, currentQuestion, questions.length, stopDetector]);

  // 单题超时
  useEffect(() => {
    if (step !== 'task' || !currentQuestion || taskFeedback !== 'idle') return;
    const t = window.setTimeout(() => {
      if (bestCentsRef.current > NEAR_CENT_THRESHOLD) commitResult(0);
    }, MAX_TASK_MS);
    return () => window.clearTimeout(t);
  }, [step, currentIdx, currentQuestion, taskFeedback, commitResult]);

  // 启动检测器
  const startTask = useCallback(async (m: Mode) => {
    setMicState('requesting');
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      setMicState('granted');
    } catch {
      setMicState('denied');
      return;
    }
    void Ctor; // suppress unused warning, real ctor used inside pitchDetector

    const qs = m === 'pluck' ? buildPluckQuiz() : buildSingQuiz();
    setQuestions(qs);
    setResults([]);
    setCurrentIdx(0);
    setCurrentCents(null);
    setCurrentNote('-');
    setCurrentMidi(null);
    setHitProgress(0);
    setTaskFeedback('idle');
    bestCentsRef.current = 999;
    hitStartRef.current = 0;
    nearStartRef.current = 0;
    questionStartRef.current = performance.now();
    startTimeRef.current = performance.now();
    recordedRef.current = false;
    setStep('task');
  }, []);

  // 开 detector（step 进 task 后）
  useEffect(() => {
    if (step !== 'task') return;
    pitchDetector.start(handleResult);
    return () => pitchDetector.stop();
  }, [step, handleResult]);

  // 卸载时确保关 detector
  useEffect(() => () => { pitchDetector.stop(); }, []);

  // 完成时入账
  useEffect(() => {
    if (step !== 'done' || recordedRef.current) return;
    recordedRef.current = true;
    const totalScore = results.reduce((a, r) => a + r.score, 0);
    const secs = Math.round((performance.now() - startTimeRef.current) / 1000);
    // 用 score × 10 让 score 始终整数 (max 50)
    recordSession('pitch-train', Math.round(totalScore * 10), TOTAL_QUESTIONS * 10, secs);
  }, [step, results]);

  // 播放目标音示范
  const playTarget = useCallback(async () => {
    if (!currentQuestion) return;
    await synth.unlock();
    synth.playMidi(currentQuestion.midi, 1.6);
  }, [currentQuestion]);

  // 自动播放目标音（每题开始时）
  useEffect(() => {
    if (step !== 'task' || !currentQuestion || taskFeedback !== 'idle') return;
    if (mode === 'sing') {
      // 唱准模式：自动播一次让用户听
      const t = window.setTimeout(() => playTarget(), 400);
      return () => window.clearTimeout(t);
    }
  }, [step, currentIdx, mode, currentQuestion, taskFeedback, playTarget]);

  // === 渲染 ===

  if (step === 'intro') {
    return (
      <div className="daily-set page-enter">
        <section className="card daily-intro">
          <div className="card-kicker">音准训练</div>
          <h2>🎯 练你的耳朵和手</h2>
          <p style={{ color: 'var(--text-body)', fontSize: 14, lineHeight: 1.6 }}>
            选一个模式，App 会给你目标音，你来发声 / 弹奏。麦克风会实时检测音准偏差 (cents)，
            <b> ±15 cents 内保持 0.5 秒即算"准"</b>。共 5 题。
          </p>
          <div className="subpage-segmented" style={{ marginTop: 14, marginBottom: 14, alignSelf: 'stretch', display: 'flex' }}>
            <button
              className={'segmented-item' + (mode === 'pluck' ? ' active' : '')}
              onClick={() => setMode('pluck')}
              style={{ flex: 1 }}
            >🎸 弹准 (吉他)</button>
            <button
              className={'segmented-item' + (mode === 'sing' ? ' active' : '')}
              onClick={() => setMode('sing')}
              style={{ flex: 1 }}
            >🎤 唱准 (跟唱)</button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
            {mode === 'pluck'
              ? '提示：先调好音再来。题目有 3 个空弦 + 2 个带品位音。'
              : '提示：App 先播参考音，你跟着唱。题目都是中音区自然音 (A3~B4)。'}
          </p>
          <div className="daily-actions">
            <button className="btn btn-primary daily-btn-primary" onClick={() => startTask(mode)}>
              ▶ 开始训练
            </button>
            <button className="btn btn-ghost" onClick={() => navigate(-1)}>返回</button>
          </div>
        </section>
      </div>
    );
  }

  if (step === 'task') {
    const remaining = TOTAL_QUESTIONS - currentIdx;
    const fbColor = taskFeedback === 'hit' ? 'var(--success)' : taskFeedback === 'near' ? 'var(--brand-strong)' : taskFeedback === 'miss' ? 'var(--danger-2)' : 'var(--text-muted)';
    const fbText = taskFeedback === 'hit' ? '✓ 准！' : taskFeedback === 'near' ? '🔶 接近 (0.5 分)' : taskFeedback === 'miss' ? `× 未达，目标 ${midiToNoteName(currentQuestion?.midi ?? 0)}` : '';

    return (
      <div className="daily-set page-enter">
        <MicPermissionState state={micState} onRetry={() => startTask(mode)} />

        <section className="card daily-step-card">
          <div className="card-kicker">
            音准训练 · {mode === 'pluck' ? '弹准' : '唱准'} · 剩 {remaining} / {TOTAL_QUESTIONS}
          </div>
          <h2 style={{ textAlign: 'center', margin: '8px 0 4px', fontSize: 26 }}>
            {currentQuestion?.label ?? '-'}
          </h2>
          {mode === 'sing' && (
            <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>
              频率 ≈ {currentQuestion ? midiToFreq(currentQuestion.midi).toFixed(1) : '-'} Hz
            </p>
          )}

          <div className="btn-row" style={{ justifyContent: 'center', marginTop: 6 }}>
            <button className="btn btn-sm" onClick={playTarget}>▶ {mode === 'sing' ? '再听一次' : '听示范'}</button>
          </div>

          {/* cents 表盘 */}
          <CentsGauge cents={currentCents} hitProgress={hitProgress} feedback={taskFeedback} />

          <div style={{ textAlign: 'center', marginTop: 8 }}>
            <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--text-strong)', lineHeight: 1 }}>
              {currentNote}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              {currentCents !== null
                ? `${currentCents > 0 ? '+' : ''}${currentCents} cents`
                : '等待发声…'}
            </div>
          </div>

          {fbText && (
            <div className="quiz-feedback" style={{
              background: taskFeedback === 'hit' ? 'rgba(52,211,153,0.18)' : taskFeedback === 'near' ? 'rgba(245,158,11,0.18)' : 'rgba(251,113,133,0.16)',
              color: fbColor,
              textAlign: 'center', marginTop: 12, padding: 10, borderRadius: 8, fontWeight: 700,
            }}>
              {fbText}
            </div>
          )}

          <div className="daily-actions" style={{ marginTop: 14 }}>
            <button className="btn btn-ghost" onClick={() => commitResult(0)}>跳过本题</button>
            <button className="btn btn-ghost" onClick={() => {
              stopDetector();
              setStep('done');
            }}>提前结束</button>
          </div>
        </section>
      </div>
    );
  }

  // done
  const totalScore = results.reduce((a, r) => a + r.score, 0);
  const secs = Math.round((performance.now() - startTimeRef.current) / 1000);
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  const wrongs = results.filter(r => r.score < 1);

  return (
    <div className="daily-set page-enter">
      <section className="card daily-done">
        <div className="card-kicker">完成 ✓</div>
        <h2>🎉 音准训练完成</h2>
        <div className="daily-done-stats">
          <div>
            <div className="daily-done-num">{minutes}:{String(seconds).padStart(2, '0')}</div>
            <div className="daily-done-label">用时</div>
          </div>
          <div>
            <div className="daily-done-num">{totalScore.toFixed(1)} / {TOTAL_QUESTIONS}</div>
            <div className="daily-done-label">得分</div>
          </div>
        </div>

        {wrongs.length > 0 && (
          <div className="daily-mistakes">
            <div className="daily-mistakes-title">📌 偏差较大的题</div>
            <p className="daily-mistakes-hint">点目标音再听一次，注意偏的方向。</p>
            <div className="daily-mistakes-list">
              {wrongs.map((r, i) => {
                const dir = r.bestCents > 999 - 1
                  ? '未发声'
                  : r.bestCents <= NEAR_CENT_THRESHOLD
                    ? `差 ${Math.round(r.bestCents)} cents`
                    : `差 > ${NEAR_CENT_THRESHOLD} cents`;
                return (
                  <div key={i} className="daily-mistake-item">
                    <button
                      type="button"
                      className="chip daily-mistake-correct"
                      onClick={() => { void synth.unlock().then(() => synth.playMidi(r.q.midi, 1.6)); }}
                      aria-label={`重听 ${r.q.label}`}
                    >▶ {r.q.label}</button>
                    <span className="daily-mistake-arrow">最佳</span>
                    <span className="chip daily-mistake-wrong">{dir}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {wrongs.length === 0 && results.length > 0 && (
          <p className="daily-mistakes-empty">🌟 全部命中，音准在线！</p>
        )}

        <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', marginTop: 12 }}>
          练习数据已记录。
        </p>
        <div className="daily-actions">
          <button className="btn btn-primary daily-btn-primary" onClick={() => {
            setStep('intro');
            setResults([]);
          }}>再来一组</button>
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>返回</button>
        </div>
      </section>
    </div>
  );
}

/** cents 表盘 — SVG 横向刻度 + 指针 */
function CentsGauge({ cents, hitProgress, feedback }: {
  cents: number | null;
  hitProgress: number;
  feedback: 'idle' | 'hit' | 'near' | 'miss';
}) {
  const W = 280;
  const H = 90;
  const CX = W / 2;
  const SCALE = W / 2 - 20; // -50 到 +50 cents 占满
  // cents -50 → x = 20, cents 0 → x = CX, cents +50 → x = W-20
  const pointerX = cents === null ? null : CX + Math.max(-50, Math.min(50, cents)) * (SCALE / 50);
  const inHit = cents !== null && Math.abs(cents) <= HIT_CENT_THRESHOLD;
  const inNear = cents !== null && Math.abs(cents) <= NEAR_CENT_THRESHOLD;
  const pointerColor = feedback === 'hit' ? 'var(--success)' : feedback === 'miss' ? 'var(--danger-2)' : inHit ? 'var(--success)' : inNear ? 'var(--brand-strong)' : 'var(--brand)';

  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* 中线（0 cent） */}
        <line x1={CX} y1={20} x2={CX} y2={H - 10} stroke="var(--success)" strokeWidth={2} opacity={0.6} />
        {/* ±15 区间高亮 */}
        <rect
          x={CX - HIT_CENT_THRESHOLD * (SCALE / 50)}
          y={28}
          width={2 * HIT_CENT_THRESHOLD * (SCALE / 50)}
          height={H - 38}
          fill="rgba(52,211,153,0.10)"
        />
        {/* ±30 区间淡色 */}
        <rect
          x={CX - NEAR_CENT_THRESHOLD * (SCALE / 50)}
          y={28}
          width={2 * NEAR_CENT_THRESHOLD * (SCALE / 50)}
          height={H - 38}
          fill="rgba(245,158,11,0.06)"
        />
        {/* 刻度 */}
        {[-50, -25, 0, 25, 50].map(v => {
          const x = CX + v * (SCALE / 50);
          return (
            <g key={v}>
              <line x1={x} y1={H - 14} x2={x} y2={H - 8} stroke="var(--text-muted)" strokeWidth={1} />
              <text x={x} y={H - 1} fontSize={9} fill="var(--text-muted)" textAnchor="middle">
                {v > 0 ? '+' + v : v}
              </text>
            </g>
          );
        })}
        {/* hit progress bar (在底部) */}
        {hitProgress > 0 && (
          <rect
            x={CX - hitProgress * SCALE}
            y={H - 22}
            width={2 * hitProgress * SCALE}
            height={3}
            fill={pointerColor}
            opacity={0.7}
          />
        )}
        {/* 指针 */}
        {pointerX !== null && (
          <g>
            <line x1={pointerX} y1={16} x2={pointerX} y2={H - 18} stroke={pointerColor} strokeWidth={3} />
            <circle cx={pointerX} cy={16} r={5} fill={pointerColor} />
          </g>
        )}
      </svg>
    </div>
  );
}
