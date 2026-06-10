/**
 * Round 57: 和弦走向听力训练
 *
 * 用户旅程: 听 2 个和弦 → 4 选 1 走向罗马数字 → 5 题/组 → 答错反馈
 *
 * 设计参考 R49 ChordEarTrainerPage 骨架, 但**不复用代码** (oracle 规则三, 不动 R49):
 *   - 5 题/组 + 最多重听 2 次的交互节奏与 R49 一致 (用户已习得)
 *   - 4 选 1 而非 R49 的 4/6/8 选 1 (本轮 MVP 单档难度, 6 个走向选 4)
 *   - 反馈区显示走向罗马数字 + nickname + description + 两个和弦构成音
 *
 * 砍掉:
 *   - 4-chord 进行 / 难度分级 / 多调支持 / 小调走向 (Round 58+ 单独立项)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { synth } from '../audio/synth';
import { CHORDS, chordPlayablePositions, type ChordDef } from '../theory/chords';
import { recordSession } from '../utils/progress';
import { vibrate, vibratePattern } from '../utils/haptic';
import { fretToMidi, SHARP_NAMES } from '../theory/notes';
import {
  generateProgressionQuestion,
  type ProgressionQuestion,
} from '../data/chordProgressions';

type Step = 'intro' | 'task' | 'done';

const TOTAL_QUESTIONS = 5;
const MAX_REPLAY = 2;
const CHORD_INTERVAL_MS = 1200;  // 两个和弦间隔

interface AnsweredQuestion {
  q: ProgressionQuestion;
  pickedId: string | null;
  correct: boolean;
}

/** 算和弦构成音 (复用 R49 思路, 不复用 R49 代码) */
function chordNotes(chord: ChordDef): string[] {
  const shape = chord.shapes[0];
  if (!shape) return [];
  const positions = chordPlayablePositions(shape);
  const seenPc = new Set<number>();
  const result: string[] = [];
  const sortedAsc = [...positions].sort((a, b) => b.stringNum - a.stringNum);
  for (const p of sortedAsc) {
    const midi = fretToMidi(p.stringNum, p.fret);
    const pc = ((midi % 12) + 12) % 12;
    if (seenPc.has(pc)) continue;
    seenPc.add(pc);
    result.push(SHARP_NAMES[pc]);
  }
  return result;
}

/** 播放 2 个和弦的进行 (中间间隔 1.2s) */
function playProgression(chord1: ChordDef, chord2: ChordDef): number {
  synth.unlock();
  const pos1 = chordPlayablePositions(chord1.shapes[0]);
  synth.strum(pos1, { direction: 'down', duration: 2.0, spread: 0.028 });

  const pos2 = chordPlayablePositions(chord2.shapes[0]);
  return window.setTimeout(() => {
    synth.strum(pos2, { direction: 'down', duration: 2.0, spread: 0.028 });
  }, CHORD_INTERVAL_MS);
}

export default function ProgressionEarTrainer() {
  const [step, setStep] = useState<Step>('intro');
  const [questions, setQuestions] = useState<ProgressionQuestion[]>([]);
  const [answers, setAnswers] = useState<AnsweredQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [replayCount, setReplayCount] = useState(0);
  const [revealed, setRevealed] = useState<{ correct: boolean; pickedId: string } | null>(null);

  const startTimeRef = useRef<number>(0);
  const autoNextTimerRef = useRef<number | null>(null);
  const playTimerRef = useRef<number | null>(null);

  const currentQuestion = questions[currentIdx];
  const currentChords = useMemo(() => {
    if (!currentQuestion) return null;
    const c1 = CHORDS.find(c => c.id === currentQuestion.answer.chordsInC[0]);
    const c2 = CHORDS.find(c => c.id === currentQuestion.answer.chordsInC[1]);
    if (!c1 || !c2) return null;
    return [c1, c2] as const;
  }, [currentQuestion]);

  // 进入新题时自动播放一次 (不计重听配额)
  useEffect(() => {
    if (step !== 'task' || !currentChords) return;
    const t = window.setTimeout(() => {
      playTimerRef.current = playProgression(currentChords[0], currentChords[1]);
    }, 300);
    return () => {
      window.clearTimeout(t);
      if (playTimerRef.current) window.clearTimeout(playTimerRef.current);
    };
  }, [step, currentIdx, currentChords]);

  // 清理定时器
  useEffect(() => () => {
    if (autoNextTimerRef.current) window.clearTimeout(autoNextTimerRef.current);
    if (playTimerRef.current) window.clearTimeout(playTimerRef.current);
  }, []);

  const startQuiz = useCallback(() => {
    const qs: ProgressionQuestion[] = [];
    for (let i = 0; i < TOTAL_QUESTIONS; i++) qs.push(generateProgressionQuestion());
    setQuestions(qs);
    setAnswers([]);
    setCurrentIdx(0);
    setReplayCount(0);
    setRevealed(null);
    startTimeRef.current = performance.now();
    setStep('task');
  }, []);

  const handleReplay = useCallback(() => {
    if (!currentChords) return;
    if (replayCount >= MAX_REPLAY && !revealed) return;
    if (playTimerRef.current) window.clearTimeout(playTimerRef.current);
    playTimerRef.current = playProgression(currentChords[0], currentChords[1]);
    if (!revealed) setReplayCount(c => c + 1);
  }, [currentChords, replayCount, revealed]);

  const handlePick = useCallback((pickedId: string) => {
    if (!currentQuestion || revealed) return;
    const correct = pickedId === currentQuestion.answer.id;
    setRevealed({ correct, pickedId });
    if (correct) {
      vibrate(20);
      autoNextTimerRef.current = window.setTimeout(() => {
        goNext({ q: currentQuestion, pickedId, correct: true });
      }, 1200);
    } else {
      vibratePattern([30, 50, 30]);
    }
    // goNext 是同组件内稳定函数，加入依赖会造成 handlePick 每帧重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion, revealed]);

  const goNext = useCallback((entry: AnsweredQuestion) => {
    if (autoNextTimerRef.current) {
      window.clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setAnswers(prev => [...prev, entry]);
    setRevealed(null);
    setReplayCount(0);
    if (currentIdx + 1 >= questions.length) {
      const elapsedSec = Math.round((performance.now() - startTimeRef.current) / 1000);
      const score = [...answers, entry].filter(a => a.correct).length;
      try {
        recordSession('progression-ear', score, TOTAL_QUESTIONS, Math.max(1, elapsedSec));
      } catch {}
      setStep('done');
    } else {
      setCurrentIdx(i => i + 1);
    }
  }, [currentIdx, questions.length, answers]);

  const handleManualNext = useCallback(() => {
    if (!currentQuestion || !revealed) return;
    goNext({ q: currentQuestion, pickedId: revealed.pickedId, correct: false });
  }, [currentQuestion, revealed, goNext]);

  const handleRestart = useCallback(() => {
    setStep('intro');
    setQuestions([]);
    setAnswers([]);
    setCurrentIdx(0);
    setReplayCount(0);
    setRevealed(null);
  }, []);

  // ============ 渲染 ============

  if (step === 'intro') {
    return (
      <div>
        <div className="card">
          <h2>🎼 和弦走向训练</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            听两个和弦, 判断这是什么<b>走向 (功能关系)</b>。<br/>
            和「和弦听力」(单和弦辨认) 形成升级: <b>这里是关系的耳朵训练</b>。<br/>
            题目固定在 C 大调中, 6 个经典走向 4 选 1, 共 {TOTAL_QUESTIONS} 题。
          </p>
        </div>
        <div className="card">
          <button
            className="module-menu-card"
            onClick={startQuiz}
            style={{ textAlign: 'left', cursor: 'pointer' }}
          >
            <div>
              <div className="menu-card-title">开始训练</div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                V→I, IV→I, I→V, V→vi, I→IV, vi→V 六种走向<br/>
                <span style={{ fontSize: 11 }}>每题最多重听 {MAX_REPLAY} 次</span>
              </p>
            </div>
            <span className="menu-card-tag">开始</span>
          </button>
        </div>
      </div>
    );
  }

  if (step === 'done') {
    const score = answers.filter(a => a.correct).length;
    const wrongList = answers.filter(a => !a.correct);
    const scoreColor = score >= 4 ? 'var(--success, #10b981)' :
                       score >= 3 ? 'var(--brand)' : 'var(--text-muted)';

    return (
      <div>
        <div className="card" style={{ textAlign: 'center' }}>
          <h2>本组结果</h2>
          <div style={{ fontSize: 56, fontWeight: 700, color: scoreColor, lineHeight: 1.1, marginTop: 8 }}>
            {score}<span style={{ fontSize: 24, color: 'var(--text-muted)' }}> / {TOTAL_QUESTIONS}</span>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={startQuiz}>↻ 再来一组</button>
            <button className="btn btn-ghost" onClick={handleRestart}>返回介绍</button>
          </div>
        </div>

        {wrongList.length > 0 && (
          <div className="card">
            <h2>错题回顾</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {wrongList.map((a, i) => {
                const ans = a.q.answer;
                const userPicked = a.q.options.find(o => o.id === a.pickedId);
                return (
                  <div key={i} style={{
                    padding: 10, borderRadius: 8,
                    background: 'rgba(239, 68, 68, 0.06)',
                    border: '1px solid rgba(239, 68, 68, 0.18)',
                  }}>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      你选 <b style={{ color: 'var(--danger, #ef4444)' }}>{userPicked?.roman ?? a.pickedId}</b>，正确
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand)' }}>{ans.roman}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ans.nickname}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-body)', marginTop: 4 }}>
                      C 大调中: {ans.chordsInC[0]} → {ans.chordsInC[1]}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      💡 {ans.description}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============ task ============
  const remainingReplay = MAX_REPLAY - replayCount;
  const canReplay = remainingReplay > 0 && !revealed;

  return (
    <div>
      {/* 进度条 */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>第 {currentIdx + 1} / {TOTAL_QUESTIONS} 题</span>
          <span style={{ color: 'var(--text-muted)' }}>C 大调 · 4 选 1</span>
        </div>
        <div style={{
          marginTop: 8, height: 4, borderRadius: 2,
          background: 'var(--bg-soft)', overflow: 'hidden',
        }}>
          <div style={{
            width: `${(currentIdx / TOTAL_QUESTIONS) * 100}%`,
            height: '100%', background: 'var(--brand)',
            transition: 'width 0.3s',
          }} />
        </div>
      </div>

      {/* 题目主区 */}
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          🎧 听这两个和弦, 在 C 大调中是哪种走向?
        </div>
        <button
          className="btn"
          onClick={handleReplay}
          disabled={!canReplay && !revealed}
          style={{ minWidth: 140 }}
        >
          ▶ {revealed ? '再听一次' : `重听 (剩 ${remainingReplay})`}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          {revealed ? '已揭晓答案, 重听不消耗配额' : `两个和弦间隔 ${CHORD_INTERVAL_MS}ms`}
        </div>
      </div>

      {/* 4 选 1 */}
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          {currentQuestion?.options.map(opt => {
            const isAnswer = opt.id === currentQuestion.answer.id;
            const isPicked = revealed?.pickedId === opt.id;
            let bg = 'var(--bg-soft)';
            let borderColor = 'var(--line-soft)';
            let textColor = 'var(--text-strong)';
            if (revealed) {
              if (isAnswer) {
                bg = 'rgba(16,185,129,0.16)';
                borderColor = 'var(--success, #10b981)';
                textColor = 'var(--success, #10b981)';
              } else if (isPicked) {
                bg = 'rgba(239,68,68,0.12)';
                borderColor = 'var(--danger, #ef4444)';
                textColor = 'var(--danger, #ef4444)';
              }
            }
            return (
              <button
                key={opt.id}
                onClick={() => handlePick(opt.id)}
                disabled={!!revealed}
                style={{
                  padding: '14px 8px', borderRadius: 10,
                  background: bg, border: `2px solid ${borderColor}`,
                  color: textColor, fontSize: 16, fontWeight: 700,
                  cursor: revealed ? 'default' : 'pointer',
                  transition: 'all 0.2s',
                  minHeight: 60,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                }}
              >
                <span>{opt.roman}</span>
                <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.8 }}>{opt.nickname}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 反馈区 */}
      {revealed && currentChords && currentQuestion && (
        <div className="card" style={{
          borderColor: revealed.correct ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
          background: revealed.correct ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
        }}>
          <div style={{
            fontSize: 16, fontWeight: 700,
            color: revealed.correct ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
          }}>
            {revealed.correct ? '✅ 答对了!' : '❌ 答错了'}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--brand)' }}>{currentQuestion.answer.roman}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{currentQuestion.answer.nickname}</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-body)', marginTop: 6 }}>
              C 大调中: <b>{currentQuestion.answer.chordsInC[0]}</b> → <b>{currentQuestion.answer.chordsInC[1]}</b>
            </div>
            <div style={{
              marginTop: 8, padding: 8, borderRadius: 6,
              background: 'var(--bg-soft)', fontFamily: 'monospace', fontSize: 12,
            }}>
              <div>{currentChords[0].name} 构成音: <b>{chordNotes(currentChords[0]).join(' - ')}</b></div>
              <div>{currentChords[1].name} 构成音: <b>{chordNotes(currentChords[1]).join(' - ')}</b></div>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
              💡 {currentQuestion.answer.description}
            </p>
          </div>
          {!revealed.correct && (
            <button className="btn" onClick={handleManualNext} style={{ marginTop: 12, width: '100%' }}>
              下一题 →
            </button>
          )}
        </div>
      )}

      <div style={{ marginTop: 8, textAlign: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={handleRestart}>
          放弃本组, 返回介绍
        </button>
      </div>
    </div>
  );
}
