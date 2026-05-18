import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chordDetector, type ChordDetectEvent, type DetectorSensitivity, type DetectorState } from '../audio/chord-detector';
import type { ChordDef } from '../theory/chords';
import { SHARP_NAMES } from '../theory/notes';
import { vibrate } from '../utils/haptic';
import { recordSession } from '../utils/progress';
import { addSavedProgression, loadSavedProgressions } from '../utils/saved-progressions';
import MicPermissionState, { type MicPermState } from '../components/MicPermissionState';

type Tab = 'chords' | 'key';

const EVIDENCE_DECAY = 0.95;  // 每次 justCommitted 前的衰减因子，半衰期 ~13 chord

/** 探测麦克风权限 */
async function probeMic(): Promise<'granted' | 'denied' | 'error'> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    return 'granted';
  } catch (err: any) {
    const name = err?.name || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
      return 'denied';
    }
    return 'error';
  }
}

export default function ListenPage() {
  const [tab, setTab] = useState<Tab>('chords');

  useEffect(() => () => { chordDetector.stop(); }, []);

  return (
    <div>
      <div className="card">
        <h2>🎧 听歌识别</h2>
        <p>用麦克风听音乐，实时识别和弦走向或判断调性。可以对着音箱/耳机外放使用。</p>
      </div>
      <div className="chip-row" style={{ marginBottom: 12 }}>
        <button className={'chip' + (tab === 'chords' ? ' active' : '')} onClick={() => { setTab('chords'); chordDetector.stop(); }}>🎵 实时识别和弦</button>
        <button className={'chip' + (tab === 'key' ? ' active' : '')} onClick={() => { setTab('key'); chordDetector.stop(); }}>🔑 听曲定调</button>
      </div>
      {tab === 'chords' ? <LiveChordRecognizer /> : <KeyDetector />}
    </div>
  );
}

/* ================ 灵敏度切换器 ================ */
const SENSITIVITY_LABEL: Record<DetectorSensitivity, string> = { strict: '严格', normal: '普通', loose: '宽松' };

function SensitivityControl({ value, onChange }: { value: DetectorSensitivity; onChange: (s: DetectorSensitivity) => void }) {
  const options: DetectorSensitivity[] = ['strict', 'normal', 'loose'];
  return (
    <div className="subpage-segmented" role="tablist" style={{ marginBottom: 10 }}>
      {options.map(o => (
        <button
          key={o}
          role="tab"
          aria-selected={value === o}
          className={value === o ? 'active' : ''}
          onClick={() => onChange(o)}
        >
          {SENSITIVITY_LABEL[o]}
        </button>
      ))}
    </div>
  );
}

/* ================ 实时识别和弦 ================ */
interface ChordEntry {
  name: string;
  chordId: string;
  time: number;            // 触发时刻（秒，相对开始）
  durationMs: number;
  confidence: number;
}

function LiveChordRecognizer() {
  const [listening, setListening] = useState(false);
  const [activeChord, setActiveChord] = useState<ChordDef | null>(null);
  const [activeHeldMs, setActiveHeldMs] = useState(0);
  const [activeConf, setActiveConf] = useState(0);
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<DetectorState>('idle');
  const [committedFlash, setCommittedFlash] = useState(false);
  const [history, setHistory] = useState<ChordEntry[]>([]);
  const [micState, setMicState] = useState<MicPermState>('idle');
  const [sensitivity, setSensitivity] = useState<DetectorSensitivity>('normal');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState('');
  // Round 19: top-K 候选展示
  const [candidates, setCandidates] = useState<{ chord: ChordDef; confidence: number }[]>([]);
  // Round 22: 基于和弦根音直方图推断调性，反馈给识别器
  const [inferredKey, setInferredKey] = useState<{ root: number; mode: 'major' | 'minor'; name: string } | null>(null);
  const chordRootHistogramRef = useRef<number[]>(new Array(12).fill(0));
  // Round 39: 同时累积 chroma 直方图（fixes H — root-histogram can't distinguish C major vs A minor）
  const chromaHistogramRef = useRef<number[]>(new Array(12).fill(0));
  // Round 39 v2: 累积 bassChroma 直方图（fixes B-min vs D-maj — bass line tracks 和弦根音，比全频段更稳）
  const bassHistogramRef = useRef<number[]>(new Array(12).fill(0));
  // Round 40: 已 committed 的和弦序列（用于 chord-sequence-based key detection）
  const chordSeqRef = useRef<{ rootPc: number; quality: string }[]>([]);
  const diagLastLogRef = useRef(0); // round39 诊断节流
  const totalChordsRef = useRef(0);
  const lastInferredKeyRef = useRef<string | null>(null);
  const lastPushedHintRef = useRef<string | null>(null);
  const startRef = useRef(0);
  const historyRef = useRef<ChordEntry[]>([]);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => { historyRef.current = history; }, [history]);

  // Round 47: 走向总结 — 把 raw commit 流变成"主要和弦 + 重复走向"卡片
  const liveSummary = useMemo(
    () => summarizeChords(
      history.map(h => ({ name: h.name, chordId: h.chordId })),
      inferredKey ? inferredKey.root : null,
      inferredKey ? inferredKey.mode : null,
    ),
    [history, inferredKey],
  );

  // 切换灵敏度即时生效（即便正在监听）
  useEffect(() => { chordDetector.setSensitivity(sensitivity); }, [sensitivity]);

  const start = useCallback(async () => {
    console.log('[round39-start] 🎤 开始监听');
    // Round 46: 不再 probeMic（stream race 在 Android WebView 上让麦克风静默失效）
    setMicState('requesting');
    setActiveChord(null);
    setActiveHeldMs(0);
    setActiveConf(0);
    setProgress(0);
    setState('idle');
    setHistory([]);
    setCandidates([]);
    historyRef.current = [];
    startRef.current = Date.now();
    chordRootHistogramRef.current = new Array(12).fill(0);
    chromaHistogramRef.current = new Array(12).fill(0); bassHistogramRef.current = new Array(12).fill(0); chordSeqRef.current = [];
    totalChordsRef.current = 0;
    lastInferredKeyRef.current = null;
    lastPushedHintRef.current = null;
    setInferredKey(null);

    chordDetector.setProfile('live');
    chordDetector.setSensitivity(sensitivity);

    try {
      await chordDetector.start((event: ChordDetectEvent) => {
      setState(event.state);
      setProgress(event.progress);
      if (event.active) {
        setActiveChord(event.active.chord);
        setActiveHeldMs(event.active.heldMs);
        setActiveConf(event.active.confidence);
      } else if (event.raw?.chord) {
        // candidate 阶段：把当前帧的候选展示出来
        setActiveChord(event.raw.chord);
        setActiveHeldMs(0);
        setActiveConf(event.raw.confidence);
      } else {
        setActiveChord(null);
        setActiveHeldMs(0);
        setActiveConf(0);
      }

      // Round 19: 同步 top-K 候选（每帧更新）
      if (event.raw?.candidates) {
        setCandidates(event.raw.candidates);
      } else {
        setCandidates([]);
      }

      // Round 39: 每帧累积 chroma（fixes H — Krumhansl 应作用于 chroma 而非根音直方图）
      if (event.raw?.chroma && event.raw.chroma.length === 12) {
        const c = event.raw.chroma;
        const h = chromaHistogramRef.current;
        for (let i = 0; i < 12; i++) h[i] = h[i] * EVIDENCE_DECAY + c[i];

        // Round 39 v3 (fix bass saturation): 每帧只给 bass argmax 的 pc 投 1 票（避免 EMA + max=1 归一化稳态 → 20 饱和）
        if (event.raw.bassChroma && event.raw.bassChroma.length === 12) {
          const bc = event.raw.bassChroma;
          let argmax = -1;
          let argmaxVal = 0;
          for (let i = 0; i < 12; i++) if (bc[i] > argmaxVal) { argmaxVal = bc[i]; argmax = i; }
          if (argmax >= 0 && argmaxVal > 0.5) {
            // 只有 bass 信号比较显著时才投票（< 0.5 视为弱/噪声，弃权）
            const bh = bassHistogramRef.current;
            for (let i = 0; i < 12; i++) bh[i] *= EVIDENCE_DECAY;
            bh[argmax] += 1;
          }
        }

      }

      if (event.justCommitted) {
        const ev = event.justCommitted;
        vibrate(10);
        setCommittedFlash(true);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => setCommittedFlash(false), 220);

        setHistory(h => {
          const next = [...h, {
            name: ev.chord.name,
            chordId: ev.chord.id,
            time: Math.round((Date.now() - startRef.current) / 1000),
            durationMs: ev.durationMs,
            confidence: ev.confidence,
          }];
          if (next.length > 50) return next.slice(next.length - 50);
          return next;
        });

        // Round 22: 累积和弦根音直方图（保留作"一致性二次确认"的旁路证据）
        // Round 39: Krumhansl 输入改为 chroma 直方图（fixes H）+ 加 top1/top2 置信度门槛（mitigates G）
        // Round 40: 主路径切到 chord-sequence-based key detection（diatonic 命中率）
        const rootPc = parseRootPc(ev.chord.id);
        if (rootPc >= 0) {
          for (let i = 0; i < 12; i++) chordRootHistogramRef.current[i] *= EVIDENCE_DECAY;
          chordRootHistogramRef.current[rootPc] += 1;
          totalChordsRef.current++;

          // Round 40: 用和弦序列推断 key
          chordSeqRef.current.push({ rootPc, quality: ev.chord.quality });
          if (chordSeqRef.current.length > 32) chordSeqRef.current.shift();
          const r40 = inferKeyFromChords(chordSeqRef.current);
          if (r40 && r40.runnerUpRatio >= 1.10) {
            const SHARP_NAMES_LOCAL3 = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
            const r40Id = `${r40.root}-${r40.mode}`;
            const r40Name = `${SHARP_NAMES_LOCAL3[r40.root]} ${r40.mode === 'major' ? '大调' : '小调'}`;
            const r40Inferred = { root: r40.root, mode: r40.mode, name: r40Name };
            if (totalChordsRef.current % 3 === 0 || totalChordsRef.current === 4) {
              console.log(`[round40][n=${totalChordsRef.current}] 推断=${r40Name} score=${r40.score} ratio=${r40.runnerUpRatio.toFixed(3)} (seq len=${chordSeqRef.current.length})`);
            }
            // 一致性 + 自信 才下发
            if (lastInferredKeyRef.current === r40Id) {
              if (lastPushedHintRef.current !== r40Id) {
                chordDetector.setKeyHint(r40.root, r40.mode);
                lastPushedHintRef.current = r40Id;
                setInferredKey(r40Inferred);
              }
            } else {
              lastInferredKeyRef.current = r40Id;
            }
            // round40 已下发，跳过下面的 Krumhansl 旧路径
            return;
          } else if (totalChordsRef.current % 3 === 0 && r40) {
            const SHARP_R = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
            console.log(`[round40][n=${totalChordsRef.current}] 不自信 推断=${SHARP_R[r40.root]} ${r40.mode} score=${r40.score} ratio=${r40.runnerUpRatio.toFixed(3)}`);
          }

          if (totalChordsRef.current >= 5) {
            // Round 39 v2: 优先用 bass 直方图（低频段=根音线），如果太弱则 fallback 到 chroma
            const bh = bassHistogramRef.current;
            const bassTotal = bh.reduce((a, b) => a + b, 0);
            const histogram = bassTotal > 2.0 ? bh : chromaHistogramRef.current;
            const histSource = bassTotal > 2.0 ? 'bass' : 'chroma';
            const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
            const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
            let bestScore = -Infinity;
            let secondScore = -Infinity;
            let bestRoot = 0;
            let bestMode: 'major' | 'minor' = 'major';
            // Round 39 diag: 收集所有 24 个 key 评分用于诊断
            const allScores: { key: string; score: number }[] = [];
            const SHARP_DIAG = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
            for (let root = 0; root < 12; root++) {
              let majCorr = 0, minCorr = 0;
              for (let i = 0; i < 12; i++) {
                const v = histogram[(root + i) % 12];
                majCorr += v * majorProfile[i];
                minCorr += v * minorProfile[i];
              }
              allScores.push({ key: SHARP_DIAG[root] + ' maj', score: majCorr });
              allScores.push({ key: SHARP_DIAG[root] + ' min', score: minCorr });
              if (majCorr > bestScore) { secondScore = bestScore; bestScore = majCorr; bestRoot = root; bestMode = 'major'; }
              else if (majCorr > secondScore) { secondScore = majCorr; }
              if (minCorr > bestScore) { secondScore = bestScore; bestScore = minCorr; bestRoot = root; bestMode = 'minor'; }
              else if (minCorr > secondScore) { secondScore = minCorr; }
            }

            // Round 39 (mitigates G): top1/top2 比值 < 1.08 视为不自信，不下发 hint，避免错 key 自我强化
            const ratio = secondScore > 0 ? bestScore / secondScore : Infinity;
            const confident = ratio >= 1.08;

            const SHARP_NAMES_LOCAL2 = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
            const inferredId = `${bestRoot}-${bestMode}`;
            const name = `${SHARP_NAMES_LOCAL2[bestRoot]} ${bestMode === 'major' ? '大调' : '小调'}`;
            const newInferred = { root: bestRoot, mode: bestMode, name };

            // 一致性二次确认：本次推断与上次一致 + 自信度足够才真正推给识别器
            if (lastInferredKeyRef.current === inferredId && confident) {
              if (lastPushedHintRef.current !== inferredId) {
                chordDetector.setKeyHint(bestRoot, bestMode);
                lastPushedHintRef.current = inferredId;
                setInferredKey(newInferred);
              }
            } else {
              lastInferredKeyRef.current = inferredId;
              // 不立即推，等下次确认；不自信也不推
            }
          }
        }
      }
    });
      setMicState('granted');
      setListening(true);
    } catch (err: any) {
      const name = err?.name || '';
      setMicState(name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError' ? 'denied' : 'error');
    }
  }, [sensitivity]);

  const stop = useCallback(() => {
    chordDetector.stop();
    chordDetector.setKeyHint(null, null);
    chordRootHistogramRef.current = new Array(12).fill(0);
    chromaHistogramRef.current = new Array(12).fill(0); bassHistogramRef.current = new Array(12).fill(0); chordSeqRef.current = [];
    totalChordsRef.current = 0;
    lastInferredKeyRef.current = null;
    lastPushedHintRef.current = null;
    setInferredKey(null);
    setListening(false);
    setState('idle');
    setProgress(0);
    setCandidates([]);
    if (startRef.current > 0) {
      const elapsedSec = Math.round((Date.now() - startRef.current) / 1000);
      const items = historyRef.current;
      if (elapsedSec >= 10) {
        recordSession('listen-chord', items.length, items.length, elapsedSec);
        window.dispatchEvent(new CustomEvent('progress-recorded', {
          detail: { text: `已记录 · 识别 ${items.length} 个和弦` }
        }));
      }
    }
    startRef.current = 0;
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => () => { chordDetector.stop(); if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  const barClass = 'stability-bar' + (committedFlash ? ' committed' : state === 'confirmed' || state === 'committed' ? ' confirmed' : '');
  const nameClass = 'live-chord-name ' + (committedFlash ? 'committed' : state === 'confirmed' || state === 'committed' ? 'confirmed' : 'candidate');

  // 识别质量评级
  const rating = (() => {
    if (state === 'committed' && activeConf >= 0.75) return 'A';
    if (state === 'committed') return 'B';
    if (state === 'confirmed' && activeConf >= 0.7) return 'B';
    return 'C';
  })();
  const ratingColor = rating === 'A' ? 'var(--success)' : rating === 'B' ? 'var(--brand)' : 'var(--text-muted)';

  return (
    <>
      <MicPermissionState state={micState} onRetry={start} />

      <SensitivityControl value={sensitivity} onChange={setSensitivity} />

      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <button className={'btn ' + (listening ? '' : 'btn-primary')} style={{ width: 200 }} onClick={toggle}>
          {listening ? '■ 停止监听' : '🎤 开始监听'}
        </button>
      </div>

      {/* 当前识别结果 */}
      <div className="tuner-result" style={{ minHeight: 110 }}>
        {listening && activeChord ? (
          <>
            <div className={nameClass}>{activeChord.name}</div>
            <div className="tuner-freq" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{
                display: 'inline-block', padding: '1px 8px', borderRadius: 10,
                background: ratingColor, color: '#fff', fontSize: 11, fontWeight: 700,
              }}>识别{rating}</span>
              <span>{activeChord.fullName} · {Math.round(activeConf * 100)}%</span>
              <span className={barClass} aria-label="稳定度">
                <span className="fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 12 }}>
                hold {Math.round(activeHeldMs)}ms
              </span>
            </div>
            {(state === 'committed' || state === 'confirmed') && candidates.length > 1 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                次选: {candidates
                  .filter(c => c.chord.id !== activeChord.id)
                  .slice(0, 2)
                  .map(c => `${c.chord.name} (${Math.round(c.confidence * 100)}%)`)
                  .join(' · ')}
              </div>
            )}
          </>
        ) : listening ? (
          <div className="tuner-note" style={{ fontSize: 16, lineHeight: '24px', color: 'var(--text-muted)', textAlign: 'center' }}>正在听… 弹一下吧</div>
        ) : (
          <div className="tuner-note" style={{ fontSize: 16, color: 'var(--text-muted)' }}>点击「开始监听」</div>
        )}
      </div>

      {/* 和弦走向历史 */}
      {history.length > 0 && (
        <>
          <div className="section-title">识别到的和弦走向</div>
          <div className="card">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {history.map((h, i) => {
                const sec = h.durationMs / 1000;
                const durClass = sec >= 2 ? 'long' : sec >= 1 ? 'mid' : 'short';
                return (
                  <div key={i} className="history-item" style={{
                    display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
                    minWidth: 56, padding: '6px 8px', borderRadius: 8,
                    background: 'var(--bg-soft)', border: '1px solid var(--line-soft)',
                  }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--brand)', fontVariantNumeric: 'tabular-nums' }}>{h.name}</span>
                    <span className={'duration ' + durClass}>{sec.toFixed(1)}s</span>
                  </div>
                );
              })}
            </div>
            {/* 走向文本摘要 */}
            <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, letterSpacing: 1, color: 'var(--text-strong)' }}>
              {history.map(h => h.name).join(' → ')}
            </div>
            {inferredKey && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                推断调性: {inferredKey.name}
                <span style={{ opacity: 0.7 }}> / {getRelativeKeyName(inferredKey.root, inferredKey.mode)}</span>
                （关系大小调顺阶等价，二者皆有可能；已反馈识别器）
              </div>
            )}
            <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => {
              const text = history.map(h => h.name).join(' → ');
              try { navigator.clipboard?.writeText(text); } catch {}
            }}>📋 复制走向</button>
            {history.length >= 3 && !showSaveForm && (
              <button
                className="btn btn-primary btn-sm"
                style={{ marginTop: 8, marginLeft: 8 }}
                onClick={() => {
                  const count = loadSavedProgressions().length;
                  setSaveName(`进行 ${count + 1}`);
                  setShowSaveForm(true);
                }}
              >💾 保存这段走向</button>
            )}
            {showSaveForm && (
              <div className="card" style={{ marginTop: 10 }}>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label className="field-label">名称</label>
                  <input
                    className="input"
                    type="text"
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    style={{ width: '100%' }}
                    autoFocus
                  />
                </div>
                <div className="btn-row">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      const name = saveName.trim() || `进行 ${loadSavedProgressions().length + 1}`;
                      const ids = history.map(h => h.chordId);
                      addSavedProgression({ name, ids });
                      window.dispatchEvent(new CustomEvent('progress-recorded', {
                        detail: { text: `💾 已保存：${name}（${ids.length} 个和弦）` }
                      }));
                      setShowSaveForm(false);
                      setSaveName('');
                      setHistory([]);
                      historyRef.current = [];
                    }}
                  >保存</button>
                  <button
                    className="btn btn-sm"
                    onClick={() => { setShowSaveForm(false); setSaveName(''); }}
                  >取消</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Round 47: 走向总结卡片（commit 数 ≥ 4 才显示） */}
      {history.length >= 4 && <ChordSummaryCard summary={liveSummary} />}

      <div className="card">
        <p style={{ fontSize: 13 }}>💡 <b>使用方法</b>：对着手机播放歌曲（音箱/另一台手机外放），app 会实时识别和弦变化并记录走向。也可以弹吉他自己录制和弦走向。</p>
        <p style={{ fontSize: 13 }}>⚠️ 识别效果受环境噪音影响。尽量安静环境 + 音源清晰。<br/>
        切换严格/普通/宽松可调整稳定阈值；live 模式速率上限 2 个和弦/秒。</p>
      </div>
    </>
  );
}

/* ================ 听曲定调 ================ */
const SHARP_NAMES_LOCAL = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

/** Round 43: 返回关系大小调的另一面名字 — D major ↔ B minor 等。
 * 关系小调：(major_root + 9) % 12
 * 关系大调：(minor_root + 3) % 12
 * 用于在 UI 上同时标注两种调性，承认算法在 vi-IV-V 走向下两调结构性等价的事实。
 */
function getRelativeKeyName(root: number, mode: 'major' | 'minor'): string {
  if (mode === 'major') {
    const relMinorRoot = (root + 9) % 12;
    return `${SHARP_NAMES_LOCAL[relMinorRoot]} 小调`;
  } else {
    const relMajorRoot = (root + 3) % 12;
    return `${SHARP_NAMES_LOCAL[relMajorRoot]} 大调`;
  }
}
const FLAT_TO_SHARP_LOCAL: Record<string,string> = { Bb:'A#', Db:'C#', Eb:'D#', Gb:'F#', Ab:'G#' };

function parseRootPc(id: string): number {
  if (!id) return -1;
  let token = id[0];
  if (id[1] === '#' || id[1] === 'b') token = id.slice(0, 2);
  if (token.length === 2 && token[1] === 'b') {
    const mapped = FLAT_TO_SHARP_LOCAL[token];
    if (!mapped) return -1;
    token = mapped;
  }
  return SHARP_NAMES_LOCAL.indexOf(token);
}

// ============ Round 40: chord-sequence-based key detection ============
// 顺阶和弦集合：[root_offset_from_key_pc, simplified_quality]
// 简化 quality：所有大类(maj/maj7/maj9/sus2/sus4/6/add9)归 'M'；小类(min/m7/min7/m6)归 'm'；dim 归 'd'
const DIATONIC_MAJOR_R40: Array<[number, 'M' | 'm' | 'd']> = [
  [0, 'M'], [2, 'm'], [4, 'm'], [5, 'M'], [7, 'M'], [9, 'm'], [11, 'd'],
];
const DIATONIC_MINOR_R40: Array<[number, 'M' | 'm' | 'd']> = [
  // natural minor + 提升 7 的 harmonic minor 也认（dom V 也 OK）
  [0, 'm'], [2, 'd'], [3, 'M'], [5, 'm'], [7, 'm'], [7, 'M'], [8, 'M'], [10, 'M'],
];

function simplifyQuality(q: string): 'M' | 'm' | 'd' | 'aug' | 'other' {
  if (q === 'major' || q === 'maj7' || q === 'dom7' || q === 'sus') return 'M';
  if (q === 'minor' || q === 'min7') return 'm';
  if (q === 'dim') return 'd';
  if (q === 'aug') return 'aug';
  return 'other';
}

/**
 * 用已 committed 的和弦序列推断调性
 *
 * 思想：对 24 个候选 key，统计有多少个和弦属于该 key 的顺阶。
 * 选 diatonic 命中率最高的；若并列，主调和弦（I / vi）更近的胜出（解关系大小调歧义）。
 *
 * @param chordHistory 按时间顺序的和弦序列，每项 { rootPc, quality }
 * @returns { root, mode, score, runnerUpRatio } 或 null（历史 < 3 个）
 */
function inferKeyFromChords(
  chordHistory: { rootPc: number; quality: string }[],
): { root: number; mode: 'major' | 'minor'; score: number; runnerUpRatio: number } | null {
  if (chordHistory.length < 3) return null;
  // 只看最近 16 个，避免久远历史污染
  const recent = chordHistory.slice(-16);

  const keyScores: { root: number; mode: 'major' | 'minor'; score: number }[] = [];
  for (let root = 0; root < 12; root++) {
    for (const mode of ['major', 'minor'] as const) {
      const diatonic = mode === 'major' ? DIATONIC_MAJOR_R40 : DIATONIC_MINOR_R40;
      const diatonicSet = new Set(diatonic.map(([off, q]) => `${(root + off) % 12}-${q}`));
      const tonicPc = root;
      const dominantPc = (root + 7) % 12;
      let score = 0;
      for (let i = 0; i < recent.length; i++) {
        const ch = recent[i];
        const sq = simplifyQuality(ch.quality);
        if (sq === 'other' || sq === 'aug') continue;
        const key = `${ch.rootPc}-${sq}`;
        if (diatonicSet.has(key)) {
          // 主和弦 (I/i) 双倍权重，强化 tonic
          if (ch.rootPc === root && (
            (mode === 'major' && sq === 'M') ||
            (mode === 'minor' && sq === 'm')
          )) {
            score += 2;
          } else {
            score += 1;
          }
        }
        // Round 42-a: dom7 在 V 度位置 → 强烈暗示本调
        if (ch.quality === 'dom7' && ch.rootPc === dominantPc) score += 1;
        // Round 42-b: V → I cadence 加 +3
        if (i > 0) {
          const prev = recent[i - 1];
          const prevSq = simplifyQuality(prev.quality);
          const curIsTonic = ch.rootPc === tonicPc && (
            (mode === 'major' && sq === 'M') ||
            (mode === 'minor' && sq === 'm')
          );
          const prevIsDominant = prev.rootPc === dominantPc && prevSq === 'M';
          if (prevIsDominant && curIsTonic) score += 3;
        }
      }
      // Round 42-c: 首尾若是 tonic 各加 +2
      if (recent.length >= 4) {
        const first = recent[0];
        const last = recent[recent.length - 1];
        const isTonic = (c: { rootPc: number; quality: string }) =>
          c.rootPc === root && (
            (mode === 'major' && simplifyQuality(c.quality) === 'M') ||
            (mode === 'minor' && simplifyQuality(c.quality) === 'm')
          );
        if (isTonic(first)) score += 2;
        if (isTonic(last)) score += 2;
      }
      keyScores.push({ root, mode, score });
    }
  }

  keyScores.sort((a, b) => b.score - a.score);
  const top = keyScores[0];
  const second = keyScores[1];
  const runnerUpRatio = second.score > 0 ? top.score / second.score : Infinity;
  return { root: top.root, mode: top.mode, score: top.score, runnerUpRatio };
}
// ============ /Round 40-42 ============

// ============ Round 47: 和弦走向总结 ============
//   解决问题: 用户外放 30 秒得到一连串 50 个 commit (D→A→Bm→Bm→F#m→G→A→...) 难以理解。
//   方案: 折叠相邻同根 → 频次统计 top 6 → 罗马数字 → 提取重复 4-chord 走向

const ROMAN_MAJOR_R47 = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
const ROMAN_MINOR_R47 = ['i', 'bii', 'ii', 'III', 'iii', 'iv', '#iv', 'v', 'VI', 'vi', 'VII', 'vii'];

function toRoman(rootPc: number, quality: string, keyRoot: number, keyMode: 'major' | 'minor'): string {
  const interval = ((rootPc - keyRoot) % 12 + 12) % 12;
  const sq = simplifyQuality(quality);
  const baseTable = keyMode === 'major' ? ROMAN_MAJOR_R47 : ROMAN_MINOR_R47;
  const symbol = baseTable[interval] ?? '?';
  if (sq === 'm') return symbol.toLowerCase();
  if (sq === 'd') return symbol.toLowerCase() + '°';
  return symbol;
}

interface ChordSummary {
  uniqueChords: { name: string; count: number; roman: string }[];
  progressions: { chords: string[]; romans: string[]; count: number }[];
  totalFolded: number;
}

function summarizeChords(
  history: { name: string; chordId: string }[],
  keyRoot: number | null,
  keyMode: 'major' | 'minor' | null,
): ChordSummary {
  if (history.length === 0) return { uniqueChords: [], progressions: [], totalFolded: 0 };

  // Step 1: 折叠相邻同根（依据 chordId 的 root pc）
  const folded: { name: string; rootPc: number; quality: string }[] = [];
  for (const h of history) {
    const rootPc = parseRootPc(h.chordId);
    if (rootPc < 0) continue;
    // 从 id 推 quality (round46 简化版 — 只剩 maj/min)
    const id = h.chordId;
    const quality = (id.length >= 2 && (id.endsWith('m') || id === id.slice(0,1) + 'bm') && !id.endsWith('aj'))
      ? 'minor' : 'major';
    const last = folded[folded.length - 1];
    if (last && last.rootPc === rootPc) continue;
    folded.push({ name: h.name, rootPc, quality });
  }

  // Step 2: 频次 top 6
  const countMap = new Map<string, { rootPc: number; quality: string; count: number }>();
  for (const f of folded) {
    const e = countMap.get(f.name);
    if (e) e.count++;
    else countMap.set(f.name, { rootPc: f.rootPc, quality: f.quality, count: 1 });
  }
  const uniqueChords = [...countMap.entries()]
    .map(([name, { rootPc, quality, count }]) => ({
      name,
      count,
      roman: keyRoot !== null && keyMode ? toRoman(rootPc, quality, keyRoot, keyMode) : '',
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Step 3: 4-chord 重复走向
  const progMap = new Map<string, { chords: string[]; rootPcs: number[]; qualities: string[]; count: number }>();
  if (folded.length >= 4) {
    for (let i = 0; i <= folded.length - 4; i++) {
      const window = folded.slice(i, i + 4);
      const key = window.map(w => w.name).join('→');
      const e = progMap.get(key);
      if (e) e.count++;
      else progMap.set(key, {
        chords: window.map(w => w.name),
        rootPcs: window.map(w => w.rootPc),
        qualities: window.map(w => w.quality),
        count: 1,
      });
    }
  }
  const progressions = [...progMap.values()]
    .filter(p => p.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(p => ({
      chords: p.chords,
      romans: keyRoot !== null && keyMode
        ? p.rootPcs.map((r, i) => toRoman(r, p.qualities[i], keyRoot, keyMode))
        : [],
      count: p.count,
    }));

  return { uniqueChords, progressions, totalFolded: folded.length };
}

function ChordSummaryCard({ summary }: { summary: ChordSummary }) {
  if (summary.uniqueChords.length === 0) return null;
  return (
    <div className="card">
      <h2>📊 走向总结</h2>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginBottom: 10 }}>
        已合并连续重复 · 折叠后 {summary.totalFolded} 个和弦
      </div>

      {/* 主要和弦（频次） */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 6 }}>主要和弦</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {summary.uniqueChords.map(c => (
            <div key={c.name} style={{
              display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
              padding: '4px 10px', borderRadius: 8,
              background: 'var(--bg-soft)', border: '1px solid var(--line-soft)',
              minWidth: 50,
            }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand)' }}>{c.name}</span>
              {c.roman && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'serif' }}>{c.roman}</span>}
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>×{c.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 重复走向段 */}
      {summary.progressions.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 6 }}>主要走向（重复出现）</div>
          {summary.progressions.map((p, i) => (
            <div key={i} style={{
              padding: '8px 10px', marginBottom: 6, borderRadius: 8,
              background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)', letterSpacing: 1 }}>
                {p.chords.join(' → ')}
              </div>
              {p.romans.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'serif', letterSpacing: 1 }}>
                  {p.romans.join(' → ')}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>出现 {p.count} 次</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// ============ /Round 47 ============


function addChordEvidence(prev: number[], root: number, quality: string): number[] {
  const out = prev.slice();
  const isMajor = quality === 'major' || quality === 'maj7' || quality === 'sus' || quality === 'aug';
  const isMinor = quality === 'minor' || quality === 'min7' || quality === 'dim';
  const isDom7  = quality === 'dom7';

  // 给定和弦 root r：r 充当 major key 的 I/IV/V 的 key root：
  //   I = r,   IV 来自 key root r-5 = r+7 mod 12,   V 来自 key root r-7 = r+5 mod 12
  if (isMajor) {
    out[root] += 1.0;                       // I
    out[(root + 7) % 12] += 1.0;            // IV
    out[(root + 5) % 12] += 1.0;            // V
    // major chord 在自然小调里作 III/VI/VII：
    //   III: key root = r + 9, VI: r + 4, VII: r + 2
    out[12 + ((root + 9) % 12)] += 0.5;
    out[12 + ((root + 4) % 12)] += 0.5;
    out[12 + ((root + 2) % 12)] += 0.5;
  }
  if (isMinor) {
    // minor chord r 在 major key 里作 ii/iii/vi：
    //   ii: r + 10, iii: r + 8, vi: r + 3
    out[(root + 10) % 12] += 0.7;
    out[(root + 8) % 12]  += 0.7;
    out[(root + 3) % 12]  += 0.7;
    // minor chord r 自然小调 i：minor key root = r
    out[12 + root] += 1.0;
  }
  if (isDom7) {
    // V7 强烈指向 major key root = r + 5
    out[(root + 5) % 12] += 1.2;
    // 同时给 minor key root = r + 5（次属和弦也常见）
    out[12 + ((root + 5) % 12)] += 0.6;
    // dom7 本身也含 major triad
    out[root] += 0.4;
    out[(root + 7) % 12] += 0.4;
  }
  return out;
}

function KeyDetector() {
  const [listening, setListening] = useState(false);
  const [pcCounts, setPcCounts] = useState<number[]>(new Array(12).fill(0));
  const [chordEvidence, setChordEvidence] = useState<number[]>(() => new Array(24).fill(0));
  const [chordEvidenceCount, setChordEvidenceCount] = useState(0);
  const [dominantChordCounts, setDominantChordCounts] = useState<Record<string, number>>({});
  const [elapsed, setElapsed] = useState(0);
  const [micState, setMicState] = useState<MicPermState>('idle');
  const timerRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const lastSampleTsRef = useRef(0);
  const bestKeyRef = useRef<{ root: number; mode: 'major' | 'minor'; score: number; name: string } | null>(null);
  // Round 18: 稳定调性 → 反馈给 chordDetector 作为 prior
  const stableKeyRef = useRef<{ key: string; since: number } | null>(null);
  const lastPushedHintRef = useRef<string | null>(null);
  const [hintPushed, setHintPushed] = useState<string | null>(null);
  // Round 46: 累积 committed 和弦序列，复用 LiveChordRecognizer 同款 round40 算法（与"听和弦"输出一致）
  const chordSeqRef = useRef<{ rootPc: number; quality: string; name: string; chordId: string }[]>([]);
  const [r40Key, setR40Key] = useState<{ root: number; mode: 'major' | 'minor'; score: number; ratio: number; name: string } | null>(null);
  // Round 47: chord history for summary
  const [keyHistory, setKeyHistory] = useState<{ name: string; chordId: string }[]>([]);

  const start = useCallback(async () => {
    // Round 46: 不再 probeMic
    setMicState('requesting');
    setPcCounts(new Array(12).fill(0));
    setChordEvidence(new Array(24).fill(0));
    setChordEvidenceCount(0);
    setDominantChordCounts({});
    setElapsed(0);
    chordSeqRef.current = [];
    setR40Key(null);
    setKeyHistory([]);
    startRef.current = Date.now();
    lastSampleTsRef.current = 0;
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);

    chordDetector.setProfile('live');
    try {
      await chordDetector.start((event: ChordDetectEvent) => {
      // justCommitted 不受节流影响，独立累积和弦证据
      if (event.justCommitted) {
        const { chord } = event.justCommitted;
        setDominantChordCounts(prev => {
          const decayed: Record<string, number> = {};
          for (const k in prev) decayed[k] = prev[k] * EVIDENCE_DECAY;
          decayed[chord.name] = (decayed[chord.name] || 0) + 1;
          return decayed;
        });
        const rootPc = parseRootPc(chord.id);
        if (rootPc >= 0) {
          setChordEvidence(prev => {
            const decayed = prev.map(v => v * EVIDENCE_DECAY);
            return addChordEvidence(decayed, rootPc, chord.quality);
          });
          setChordEvidenceCount(c => c + 1);

          // Round 46: 喂入 round40 算法（与 LiveChordRecognizer 一致）
          chordSeqRef.current.push({ rootPc, quality: chord.quality, name: chord.name, chordId: chord.id });
          if (chordSeqRef.current.length > 64) chordSeqRef.current.shift();
          const r40 = inferKeyFromChords(chordSeqRef.current);
          if (r40) {
            const SHARP_N = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
            setR40Key({
              root: r40.root,
              mode: r40.mode,
              score: r40.score,
              ratio: r40.runnerUpRatio,
              name: `${SHARP_N[r40.root]} ${r40.mode === 'major' ? '大调' : '小调'}`,
            });
          }
          // Round 47: 累积历史用于走向总结
          setKeyHistory(h => {
            const next = [...h, { name: chord.name, chordId: chord.id }];
            if (next.length > 80) return next.slice(next.length - 80);
            return next;
          });
        }
      }

      const raw = event.raw;
      if (!raw || raw.detectedPcs.length === 0) return;

      // 节流：200ms 采一次（仅影响 chroma 累计）
      const now = performance.now();
      if (now - lastSampleTsRef.current < 200) return;
      lastSampleTsRef.current = now;

      // 累加归一化 chroma（[0,1]），自带强度，不再除以 peakCount
      if (raw.chroma && raw.chroma.length === 12) {
        setPcCounts(prev => {
          const next = [...prev];
          for (let pc = 0; pc < 12; pc++) next[pc] += raw.chroma[pc];
          return next;
        });
      }
    });
      setMicState('granted');
      setListening(true);
    } catch (err: any) {
      const name = err?.name || '';
      setMicState(name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError' ? 'denied' : 'error');
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }, []);

  const stop = useCallback(() => {
    chordDetector.stop();
    chordDetector.setKeyHint(null, null);
    lastPushedHintRef.current = null;
    stableKeyRef.current = null;
    setHintPushed(null);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setListening(false);
    if (startRef.current > 0) {
      const elapsedSec = Math.round((Date.now() - startRef.current) / 1000);
      if (elapsedSec >= 10) {
        const hasBest = !!bestKeyRef.current;
        recordSession('listen-key', hasBest ? 1 : 0, 1, elapsedSec);
        window.dispatchEvent(new CustomEvent('progress-recorded', {
          detail: { text: '已记录 · 调性分析' }
        }));
      }
    }
    startRef.current = 0;
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  useEffect(() => () => { chordDetector.stop(); if (timerRef.current) clearInterval(timerRef.current); }, []);

  // 分析调性：使用 Krumhansl-Schmuckler 算法简化版
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  const totalCounts = pcCounts.reduce((a, b) => a + b, 0);
  const maxCount = Math.max(...pcCounts, 1);

  const keyScores: { root: number; mode: 'major' | 'minor'; score: number; name: string }[] = [];
  const LAMBDA = 0.15;
  for (let root = 0; root < 12; root++) {
    let majCorr = 0, minCorr = 0;
    for (let i = 0; i < 12; i++) {
      const rotated = pcCounts[(root + i) % 12];
      majCorr += rotated * majorProfile[i];
      minCorr += rotated * minorProfile[i];
    }
    keyScores.push(
      { root, mode: 'major' as const, score: majCorr + LAMBDA * chordEvidence[root], name: `${SHARP_NAMES[root]} 大调` },
      { root, mode: 'minor' as const, score: minCorr + LAMBDA * chordEvidence[12 + root], name: `${SHARP_NAMES[root]} 小调` },
    );
  }
  keyScores.sort((a, b) => b.score - a.score);
  // Round 46: 主路径用 round40 chord-sequence 算法（与 LiveChordRecognizer 一致）
  //   keyScores (Krumhansl chroma 频次) 保留作 top3 候选展示和兜底
  const bestKey = r40Key
    ? { root: r40Key.root, mode: r40Key.mode, score: r40Key.score, name: r40Key.name }
    : totalCounts > 5 ? keyScores[0] : null;
  const top3 = keyScores.slice(0, 3);

  // 置信度评级：top1/top2 比值越大越自信
  const top1Score = keyScores[0]?.score || 0;
  const top2Score = keyScores[1]?.score || 0;
  const krumhanslRatio = top2Score > 0 ? top1Score / top2Score : Infinity;
  const ratio = r40Key ? r40Key.ratio : krumhanslRatio;
  const keyConfidenceRating = bestKey ? (ratio > 1.20 ? 'A' : ratio > 1.08 ? 'B' : 'C') : 'C';
  const keyRatingColor = keyConfidenceRating === 'A' ? 'var(--success)' : keyConfidenceRating === 'B' ? 'var(--brand)' : 'var(--text-muted)';

  useEffect(() => { bestKeyRef.current = bestKey; }, [bestKey]);

  // Round 47: KeyDetector 也提供走向总结
  const keySummary = useMemo(
    () => summarizeChords(keyHistory, bestKey ? bestKey.root : null, bestKey ? bestKey.mode : null),
    [keyHistory, bestKey],
  );

  // Round 18: 检测到的调性稳定 ≥ 3s 后，反馈给 chordDetector 作为 prior
  useEffect(() => {
    if (!bestKey) {
      stableKeyRef.current = null;
      return;
    }
    const keyId = `${bestKey.root}-${bestKey.mode}`;
    const now = Date.now();
    if (!stableKeyRef.current || stableKeyRef.current.key !== keyId) {
      stableKeyRef.current = { key: keyId, since: now };
      return;
    }
    if (now - stableKeyRef.current.since >= 3000 && lastPushedHintRef.current !== keyId) {
      chordDetector.setKeyHint(bestKey.root, bestKey.mode);
      lastPushedHintRef.current = keyId;
      setHintPushed(keyId);
    }
  }, [bestKey]);

  return (
    <>
      <MicPermissionState state={micState} onRetry={start} />

      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <button className={'btn ' + (listening ? '' : 'btn-primary')} style={{ width: 200 }} onClick={toggle}>
          {listening ? '■ 停止分析' : '🎤 开始听曲定调'}
        </button>
        {listening && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>已分析 {elapsed} 秒 · 建议听 10-30 秒</div>}
      </div>

      {/* 调性判定结果 */}
      <div className="tuner-result" style={{ minHeight: 80 }}>
        {bestKey ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div className="tuner-note" style={{ color: 'var(--success)' }}>{bestKey.name}</div>
              <span style={{ opacity: 0.7, fontSize: 14, color: 'var(--text-body)' }}>
                / {getRelativeKeyName(bestKey.root, bestKey.mode)}
              </span>
              <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                background: keyRatingColor, color: '#fff', fontSize: 11, fontWeight: 700,
              }}>{keyConfidenceRating}</span>
            </div>
            <div className="tuner-freq">关系大小调顺阶等价，二者皆有可能</div>
          </>
        ) : totalCounts > 0 ? (
          <div className="tuner-note" style={{ fontSize: 16, lineHeight: '24px', color: 'var(--text-muted)', textAlign: 'center' }}>正在听… 弹一下吧</div>
        ) : listening ? (
          <div className="tuner-note" style={{ fontSize: 16, lineHeight: '24px', color: 'var(--text-muted)', textAlign: 'center' }}>正在听… 弹一下吧</div>
        ) : (
          <div className="tuner-note" style={{ fontSize: 16, color: 'var(--text-muted)' }}>播放音乐开始分析</div>
        )}
      </div>

      {/* Round 47: 走向总结（与"实时识别和弦"标签的展示一致） */}
      {keyHistory.length >= 4 && <ChordSummaryCard summary={keySummary} />}

      {/* Top 3 候选 */}
      {totalCounts > 5 && (
        <div className="card">
          <h2>候选调性</h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginBottom: 8 }}>
            音名频次旁路（Krumhansl）：当结论与主显示不一致时仅供参考 · 已识别 {chordEvidenceCount} 个和弦
          </div>
          {hintPushed && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginBottom: 8 }}>
              已将该调反馈给和弦识别器（提升调内和弦识别度）
            </div>
          )}
          {top3.map((k, i) => (
            <div key={`${k.root}-${k.mode}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: i === 0 ? 700 : 400, color: i === 0 ? 'var(--success)' : 'var(--text-strong)', minWidth: 90 }}>{k.name}</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-soft)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(k.score / keyScores[0].score) * 100}%`, borderRadius: 4, background: i === 0 ? 'var(--success)' : 'var(--line-soft)' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 主导和弦 */}
      {Object.keys(dominantChordCounts).length > 0 && (
        <div className="card">
          <h2>主导和弦</h2>
          <div style={{ fontSize: 14 }}>
            {Object.entries(dominantChordCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([name, count]) => `${name} ×${Math.round(count)}`)
              .join(', ')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            已识别 {Math.round(Object.values(dominantChordCounts).reduce((a, b) => a + b, 0))} 个和弦
          </div>
        </div>
      )}

      {/* 音名分布柱状图 */}
      {totalCounts > 0 && (
        <div className="card">
          <h2>音名频率分布</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
            {SHARP_NAMES.map((name, pc) => {
              const h = Math.max(2, (pcCounts[pc] / maxCount) * 72);
              const isBestRoot = bestKey?.root === pc;
              return (
                <div key={name} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: '100%', height: h, borderRadius: 3, background: isBestRoot ? 'var(--success)' : 'var(--brand)', minWidth: 6, transition: 'height .3s' }} />
                  <span style={{ fontSize: 9, color: isBestRoot ? 'var(--success)' : 'var(--text-muted)', fontWeight: isBestRoot ? 700 : 400 }}>{name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <p style={{ fontSize: 13 }}>💡 <b>听曲定调</b>：对着手机播放一段音乐（10-30 秒），app 会以 200ms 节流采样统计音高分布并通过 Krumhansl-Schmuckler 算法推断调性。</p>
        <p style={{ fontSize: 13 }}>适合：扒谱前先确定歌曲的调，然后去「音阶」页查看对应音阶在指板上的位置。</p>
      </div>
    </>
  );
}
