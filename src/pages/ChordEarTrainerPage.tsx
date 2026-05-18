/**
 * 和弦听力训练 - Round 49
 *
 * 与 PitchTrainerPage (单音, mic 检测 cents) 形成对比:
 *   - 单音: 客观频率匹配, 麦克风量化判定
 *   - 和弦: 主观选择题, 4/6/8 选 1
 *
 * 流程:
 *   1. intro: 选难度 (新手 4选1 / 进阶 6选1 / 高阶 8选1) → 开始
 *   2. task:  5 题, 每题随机抽答案 + 干扰项, 用户听后从选项里点
 *      - 重听: 最多 2 次 (扫弦和分解共享配额)
 *      - 答对: 自动 1.2s 下一题
 *      - 答错: 显示正确答案 + 构成音名, 用户手动点"下一题"
 *   3. done: 5 题得分 + 错题列表 + recordSession
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHORDS, chordPlayablePositions, type ChordDef } from '../theory/chords';
import { fretToMidi, pcToName, SHARP_NAMES } from '../theory/notes';
import { synth } from '../audio/synth';
import { recordSession } from '../utils/progress';
import { vibrate, vibratePattern } from '../utils/haptic';

type Step = 'intro' | 'task' | 'done';
type Difficulty = 'newbie' | 'intermediate' | 'advanced';

const TOTAL_QUESTIONS = 5;
const MAX_REPLAY = 2;  // 每题最多重听 2 次（扫弦/分解共享配额）

// 难度对应的和弦池 (id 必须在 CHORDS 词典里)
const POOLS: Record<Difficulty, string[]> = {
  newbie:       ['C', 'G', 'D', 'Am'],
  intermediate: ['C', 'G', 'D', 'Am', 'Em', 'Dm'],
  advanced:     ['C', 'G', 'D', 'Am', 'Em', 'G7', 'Cmaj7', 'Dsus2'],
};

const DIFFICULTY_LABEL: Record<Difficulty, { label: string; desc: string; count: string }> = {
  newbie:       { label: '新手', desc: '4 个最常见开放和弦', count: '4 选 1' },
  intermediate: { label: '进阶', desc: '增加 Em / Dm 小调和弦', count: '6 选 1' },
  advanced:     { label: '高阶', desc: '加入七和弦/挂留和弦', count: '8 选 1' },
};

interface Question {
  answerId: string;     // 正确答案的 ChordDef.id
  optionIds: string[];  // 含答案在内的所有选项 (打乱顺序)
}

interface AnsweredQuestion {
  q: Question;
  userPickedId: string | null;  // null = 跳过（理论上不会发生）
  correct: boolean;
}

/** 从池中抽 N 个不重复 id（保证含 answerId） */
function pickOptions(pool: string[], answerId: string, optionCount: number): string[] {
  const distractors = pool.filter(id => id !== answerId);
  // shuffle distractors
  const shuffled = [...distractors].sort(() => Math.random() - 0.5);
  const chosen = shuffled.slice(0, optionCount - 1);
  const all = [answerId, ...chosen];
  return all.sort(() => Math.random() - 0.5);
}

function buildQuiz(difficulty: Difficulty): Question[] {
  const pool = POOLS[difficulty];
  const optionCount = pool.length;  // 4 / 6 / 8
  const qs: Question[] = [];
  const usedAnswers = new Set<string>();

  while (qs.length < TOTAL_QUESTIONS) {
    const answerId = pool[Math.floor(Math.random() * pool.length)];
    // 5 题答案尽量不重复（池有 4-8 个，5 题至少有 1 个会重复）
    if (qs.length < pool.length && usedAnswers.has(answerId)) continue;
    usedAnswers.add(answerId);
    qs.push({
      answerId,
      optionIds: pickOptions(pool, answerId, optionCount),
    });
  }
  return qs;
}

/**
 * 从 ChordDef 的第一个 shape 提取构成音名（去重 + 保留弹奏顺序）
 * 例: C = [-1,3,2,0,1,0] → 5弦3品=C, 4弦2品=E, 3弦空=G, 2弦1品=C, 1弦空=E
 *     → 去重 → ["C", "E", "G"]
 */
function chordNotes(chord: ChordDef): string[] {
  const shape = chord.shapes[0];
  if (!shape) return [];
  const positions = chordPlayablePositions(shape);
  const seenPc = new Set<number>();
  const result: string[] = [];
  // 从低音到高音（stringNum 大 → 小）
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

/** 描述构成音（带根音/三度/五度功能说明） */
function describeChordNotes(chord: ChordDef): string {
  const notes = chordNotes(chord);
  if (notes.length === 0) return chord.fullName;
  const rootName = notes[0];
  const isMinor = chord.quality === 'minor' || chord.quality === 'min7';
  const intervals = isMinor ? '根音 - 小三度 - 五度' : '根音 - 大三度 - 五度';
  // 七和弦/挂留时不简化描述
  const isExtended = chord.quality !== 'major' && chord.quality !== 'minor';
  return isExtended
    ? `${notes.join(' - ')}（${chord.fullName}）`
    : `${notes.join(' - ')}（${intervals}）`;
}

/** 播放和弦：扫弦模式（默认） */
function playStrum(chord: ChordDef) {
  synth.unlock();
  const positions = chordPlayablePositions(chord.shapes[0]);
  synth.strum(positions, { direction: 'down', duration: 2.4, spread: 0.028 });
}

/** 播放和弦：分解模式（从低到高一个一个弹，便于初学者听清每个音） */
function playArpeggio(chord: ChordDef) {
  synth.unlock();
  const positions = chordPlayablePositions(chord.shapes[0]);
  // 从低音弦到高音弦排序
  const ascending = [...positions].sort((a, b) => b.stringNum - a.stringNum);
  const noteGap = 0.28;  // 280ms 一个音
  const noteDur = 1.4;   // 每音衰减时长
  ascending.forEach((p, i) => {
    synth.playFret(p.stringNum, p.fret, noteDur, i * noteGap);
  });
}

export default function ChordEarTrainerPage() {
  const [step, setStep] = useState<Step>('intro');
  const [difficulty, setDifficulty] = useState<Difficulty>('newbie');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<AnsweredQuestion[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [replayCount, setReplayCount] = useState(0);
  const [revealed, setRevealed] = useState<{ correct: boolean; userPickedId: string } | null>(null);

  const startTimeRef = useRef<number>(0);
  const autoNextTimerRef = useRef<number | null>(null);

  const currentQuestion = questions[currentIdx];
  const currentChord = useMemo(
    () => currentQuestion ? CHORDS.find(c => c.id === currentQuestion.answerId) ?? null : null,
    [currentQuestion],
  );

  // 进入新题时自动播放一次（不计入重听配额）
  useEffect(() => {
    if (step !== 'task' || !currentChord) return;
    const t = window.setTimeout(() => playStrum(currentChord), 300);
    return () => window.clearTimeout(t);
  }, [step, currentIdx, currentChord]);

  // 清理定时器
  useEffect(() => () => {
    if (autoNextTimerRef.current) {
      window.clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
  }, []);

  const startQuiz = useCallback((d: Difficulty) => {
    setDifficulty(d);
    setQuestions(buildQuiz(d));
    setAnswers([]);
    setCurrentIdx(0);
    setReplayCount(0);
    setRevealed(null);
    startTimeRef.current = performance.now();
    setStep('task');
  }, []);

  const handleReplay = useCallback((mode: 'strum' | 'arpeggio') => {
    if (!currentChord) return;
    if (replayCount >= MAX_REPLAY) return;
    if (revealed) {
      // 已答完后再听不计入配额
      mode === 'strum' ? playStrum(currentChord) : playArpeggio(currentChord);
      return;
    }
    mode === 'strum' ? playStrum(currentChord) : playArpeggio(currentChord);
    setReplayCount(c => c + 1);
  }, [currentChord, replayCount, revealed]);

  const handlePick = useCallback((pickedId: string) => {
    if (!currentQuestion || revealed) return;  // 已揭晓则忽略
    const correct = pickedId === currentQuestion.answerId;
    setRevealed({ correct, userPickedId: pickedId });
    if (correct) {
      vibrate(20);
      // 答对：1.2s 后自动下一题
      autoNextTimerRef.current = window.setTimeout(() => {
        goNext({ q: currentQuestion, userPickedId: pickedId, correct: true });
      }, 1200);
    } else {
      vibratePattern([30, 50, 30]);
      // 答错：等用户手动点"下一题"
    }
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
      // 结束
      const elapsedSec = Math.round((performance.now() - startTimeRef.current) / 1000);
      const score = [...answers, entry].filter(a => a.correct).length;
      try {
        recordSession('chord-ear', score, TOTAL_QUESTIONS, Math.max(1, elapsedSec));
      } catch {}
      setStep('done');
    } else {
      setCurrentIdx(i => i + 1);
    }
  }, [currentIdx, questions.length, answers]);

  const handleManualNext = useCallback(() => {
    if (!currentQuestion || !revealed) return;
    goNext({
      q: currentQuestion,
      userPickedId: revealed.userPickedId,
      correct: false,  // manual next 只在答错时调用
    });
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
          <h2>🎵 和弦听力训练</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
            听一个和弦音色，从选项里选出正确名称。<br/>
            和 <b>音准训练</b>（单音 + 麦克风）形成对比：<b>这里是多音的耳朵训练</b>。<br/>
            每组 5 题，最多重听 {MAX_REPLAY} 次。
          </p>
        </div>

        <div className="card">
          <h2>选择难度</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
            {(['newbie', 'intermediate', 'advanced'] as Difficulty[]).map(d => {
              const info = DIFFICULTY_LABEL[d];
              const pool = POOLS[d];
              return (
                <button
                  key={d}
                  className="module-menu-card"
                  onClick={() => startQuiz(d)}
                  style={{ textAlign: 'left' }}
                >
                  <div>
                    <div className="menu-card-title">{info.label} · {info.count}</div>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {info.desc}<br/>
                      <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {pool.join(' · ')}
                      </span>
                    </p>
                  </div>
                  <span className="menu-card-tag">开始</span>
                </button>
              );
            })}
          </div>
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
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            {DIFFICULTY_LABEL[difficulty].label} · {DIFFICULTY_LABEL[difficulty].count}
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => startQuiz(difficulty)}>↻ 再来一组（同难度）</button>
            <button className="btn btn-ghost" onClick={handleRestart}>选其他难度</button>
          </div>
        </div>

        {wrongList.length > 0 && (
          <div className="card">
            <h2>错题回顾</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {wrongList.map((a, i) => {
                const ans = CHORDS.find(c => c.id === a.q.answerId);
                const userChord = CHORDS.find(c => c.id === a.userPickedId);
                if (!ans) return null;
                return (
                  <div key={i} style={{
                    padding: 10, borderRadius: 8,
                    background: 'rgba(239, 68, 68, 0.06)',
                    border: '1px solid rgba(239, 68, 68, 0.18)',
                  }}>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      你选 <b style={{ color: 'var(--danger, #ef4444)' }}>{userChord?.name ?? a.userPickedId}</b>
                      ，正确答案
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--brand)' }}>{ans.name}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ans.fullName}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-body)', marginTop: 4, fontFamily: 'monospace' }}>
                      构成音：{describeChordNotes(ans)}
                    </div>
                    <button
                      className="btn btn-sm btn-ghost"
                      style={{ marginTop: 6 }}
                      onClick={() => playStrum(ans)}
                    >▶ 再听一次</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {wrongList.length === 0 && (
          <div className="card" style={{ background: 'rgba(16,185,129,0.06)' }}>
            <div style={{ fontSize: 14, color: 'var(--success, #10b981)', fontWeight: 600 }}>🎉 全对！</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              试试更高难度，或者换一组继续练习。
            </div>
          </div>
        )}
      </div>
    );
  }

  // ============ task ============
  const remainingReplay = MAX_REPLAY - replayCount;
  const canReplay = remainingReplay > 0 && !revealed;
  const answerChord = currentChord;

  return (
    <div>
      {/* 进度条 */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>
            第 {currentIdx + 1} / {TOTAL_QUESTIONS} 题
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            {DIFFICULTY_LABEL[difficulty].label} · {DIFFICULTY_LABEL[difficulty].count}
          </span>
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

      {/* 主区：播放按钮 + 提示 */}
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
          🎧 听这个和弦是什么？
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn"
            onClick={() => handleReplay('strum')}
            disabled={!canReplay && !revealed}
            style={{ minWidth: 120 }}
          >
            ▶ {revealed ? '再听扫弦' : '重听（扫弦）'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => handleReplay('arpeggio')}
            disabled={!canReplay && !revealed}
            style={{ minWidth: 120 }}
          >
            🎼 {revealed ? '再听分解' : '听分解'}
          </button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          {revealed
            ? '已揭晓答案，重听不消耗配额'
            : `剩余重听 ${remainingReplay} 次 · 扫弦/分解共享配额`}
        </div>
      </div>

      {/* 选项 2×2 / 2×3 / 2×4 网格 */}
      <div className="card">
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 10,
        }}>
          {currentQuestion?.optionIds.map(id => {
            const chord = CHORDS.find(c => c.id === id);
            if (!chord) return null;
            const isAnswer = id === currentQuestion.answerId;
            const isUserPick = revealed?.userPickedId === id;
            let bg = 'var(--bg-soft)';
            let borderColor = 'var(--line-soft)';
            let textColor = 'var(--text-strong)';
            if (revealed) {
              if (isAnswer) {
                bg = 'rgba(16,185,129,0.16)';
                borderColor = 'var(--success, #10b981)';
                textColor = 'var(--success, #10b981)';
              } else if (isUserPick) {
                bg = 'rgba(239,68,68,0.12)';
                borderColor = 'var(--danger, #ef4444)';
                textColor = 'var(--danger, #ef4444)';
              }
            }
            return (
              <button
                key={id}
                onClick={() => handlePick(id)}
                disabled={!!revealed}
                style={{
                  padding: '18px 10px', borderRadius: 10,
                  background: bg, border: `2px solid ${borderColor}`,
                  color: textColor, fontSize: 22, fontWeight: 700,
                  cursor: revealed ? 'default' : 'pointer',
                  transition: 'all 0.2s',
                  minHeight: 64,
                }}
              >
                {chord.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* 反馈区（仅 revealed 后显示） */}
      {revealed && answerChord && (
        <div className="card" style={{
          borderColor: revealed.correct ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
          background: revealed.correct ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)',
        }}>
          <div style={{
            fontSize: 16, fontWeight: 700,
            color: revealed.correct ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
          }}>
            {revealed.correct ? '✅ 答对了！' : '❌ 答错了'}
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: 'var(--brand)' }}>{answerChord.name}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{answerChord.fullName}</span>
            </div>

            <div style={{
              marginTop: 8, padding: 8, borderRadius: 6,
              background: 'var(--bg-soft)', fontFamily: 'monospace', fontSize: 13,
            }}>
              <span style={{ color: 'var(--text-muted)' }}>构成音：</span>
              <span style={{ color: 'var(--text-strong)', fontWeight: 600 }}>
                {chordNotes(answerChord).join(' - ')}
              </span>
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                {answerChord.quality === 'major' && '根音 - 大三度 - 五度（大三和弦）'}
                {answerChord.quality === 'minor' && '根音 - 小三度 - 五度（小三和弦）'}
                {answerChord.quality === 'dom7' && '根音 - 大三度 - 五度 - 小七度（属七和弦）'}
                {answerChord.quality === 'maj7' && '根音 - 大三度 - 五度 - 大七度（大七和弦）'}
                {answerChord.quality === 'min7' && '根音 - 小三度 - 五度 - 小七度（小七和弦）'}
                {answerChord.quality === 'sus' && '根音 - 二度/四度 - 五度（挂留和弦：三度被挂起，色彩"悬而未决"）'}
                {answerChord.quality === 'dim' && '根音 - 小三度 - 减五度（减三和弦）'}
                {answerChord.quality === 'aug' && '根音 - 大三度 - 增五度（增三和弦）'}
              </div>
            </div>

            {answerChord.tips && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
                💡 {answerChord.tips}
              </p>
            )}
          </div>

          {!revealed.correct && (
            <button
              className="btn"
              onClick={handleManualNext}
              style={{ marginTop: 12, width: '100%' }}
            >
              下一题 →
            </button>
          )}
        </div>
      )}

      {/* 退出 */}
      <div style={{ marginTop: 8, textAlign: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={handleRestart}>
          放弃本组，重选难度
        </button>
      </div>
    </div>
  );
}

// 用一下 pcToName 让 lint 不抱怨（保留 import 便于 future 扩展，例如显示根音 pc 名）
void pcToName;
