import { useCallback, useEffect, useRef, useState } from 'react';
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
  const totalChordsRef = useRef(0);
  const lastInferredKeyRef = useRef<string | null>(null);
  const lastPushedHintRef = useRef<string | null>(null);
  const startRef = useRef(0);
  const historyRef = useRef<ChordEntry[]>([]);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => { historyRef.current = history; }, [history]);

  // 切换灵敏度即时生效（即便正在监听）
  useEffect(() => { chordDetector.setSensitivity(sensitivity); }, [sensitivity]);

  const start = useCallback(async () => {
    setMicState('requesting');
    const perm = await probeMic();
    if (perm !== 'granted') {
      setMicState(perm);
      return;
    }
    setMicState('granted');
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
    totalChordsRef.current = 0;
    lastInferredKeyRef.current = null;
    lastPushedHintRef.current = null;
    setInferredKey(null);

    chordDetector.setProfile('live');
    chordDetector.setSensitivity(sensitivity);

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

        // Round 22: 累积和弦根音直方图 → K-S 推断调性 → 反馈给识别器
        const rootPc = parseRootPc(ev.chord.id);
        if (rootPc >= 0) {
          for (let i = 0; i < 12; i++) chordRootHistogramRef.current[i] *= EVIDENCE_DECAY;
          chordRootHistogramRef.current[rootPc] += 1;
          totalChordsRef.current++;

          if (totalChordsRef.current >= 5) {
            const histogram = chordRootHistogramRef.current;
            const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
            const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
            let bestScore = -Infinity;
            let bestRoot = 0;
            let bestMode: 'major' | 'minor' = 'major';
            for (let root = 0; root < 12; root++) {
              let majCorr = 0, minCorr = 0;
              for (let i = 0; i < 12; i++) {
                const v = histogram[(root + i) % 12];
                majCorr += v * majorProfile[i];
                minCorr += v * minorProfile[i];
              }
              if (majCorr > bestScore) { bestScore = majCorr; bestRoot = root; bestMode = 'major'; }
              if (minCorr > bestScore) { bestScore = minCorr; bestRoot = root; bestMode = 'minor'; }
            }
            const SHARP_NAMES_LOCAL2 = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
            const inferredId = `${bestRoot}-${bestMode}`;
            const name = `${SHARP_NAMES_LOCAL2[bestRoot]} ${bestMode === 'major' ? '大调' : '小调'}`;
            const newInferred = { root: bestRoot, mode: bestMode, name };

            // 一致性二次确认：本次推断与上次一致才真正推给识别器
            if (lastInferredKeyRef.current === inferredId) {
              if (lastPushedHintRef.current !== inferredId) {
                chordDetector.setKeyHint(bestRoot, bestMode);
                lastPushedHintRef.current = inferredId;
                setInferredKey(newInferred);
              }
            } else {
              lastInferredKeyRef.current = inferredId;
              // 不立即推，等下次确认
            }
          }
        }
      }
    });
    setListening(true);
  }, [sensitivity]);

  const stop = useCallback(() => {
    chordDetector.stop();
    chordDetector.setKeyHint(null, null);
    chordRootHistogramRef.current = new Array(12).fill(0);
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
  const ratingColor = rating === 'A' ? 'var(--success)' : rating === 'B' ? 'var(--brand)' : 'var(--text-dim)';

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
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
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
          <div className="tuner-note" style={{ fontSize: 16, color: 'var(--text-dim)' }}>点击「开始监听」</div>
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
                    background: 'var(--bg-soft)', border: '1px solid var(--border)',
                  }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--brand)', fontVariantNumeric: 'tabular-nums' }}>{h.name}</span>
                    <span className={'duration ' + durClass}>{sec.toFixed(1)}s</span>
                  </div>
                );
              })}
            </div>
            {/* 走向文本摘要 */}
            <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, letterSpacing: 1, color: 'var(--text)' }}>
              {history.map(h => h.name).join(' → ')}
            </div>
            {inferredKey && (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
                推断调性: {inferredKey.name}（已反馈给识别器，提升后续调内和弦准确度）
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

  const start = useCallback(async () => {
    setMicState('requesting');
    const perm = await probeMic();
    if (perm !== 'granted') {
      setMicState(perm);
      return;
    }
    setMicState('granted');
    setPcCounts(new Array(12).fill(0));
    setChordEvidence(new Array(24).fill(0));
    setChordEvidenceCount(0);
    setDominantChordCounts({});
    setElapsed(0);
    startRef.current = Date.now();
    lastSampleTsRef.current = 0;
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);

    chordDetector.setProfile('live');
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
    setListening(true);
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
  const bestKey = totalCounts > 5 ? keyScores[0] : null;
  const top3 = keyScores.slice(0, 3);

  // 置信度评级：top1/top2 比值越大越自信
  const top1Score = keyScores[0]?.score || 0;
  const top2Score = keyScores[1]?.score || 0;
  const ratio = top2Score > 0 ? top1Score / top2Score : Infinity;
  const keyConfidenceRating = bestKey ? (ratio > 1.20 ? 'A' : ratio > 1.08 ? 'B' : 'C') : 'C';
  const keyRatingColor = keyConfidenceRating === 'A' ? 'var(--success)' : keyConfidenceRating === 'B' ? 'var(--brand)' : 'var(--text-dim)';

  useEffect(() => { bestKeyRef.current = bestKey; }, [bestKey]);

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
        {listening && <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6 }}>已分析 {elapsed} 秒 · 建议听 10-30 秒</div>}
      </div>

      {/* 调性判定结果 */}
      <div className="tuner-result" style={{ minHeight: 80 }}>
        {bestKey ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <div className="tuner-note" style={{ color: 'var(--success)' }}>{bestKey.name}</div>
              <span style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                background: keyRatingColor, color: '#fff', fontSize: 11, fontWeight: 700,
              }}>{keyConfidenceRating}</span>
            </div>
            <div className="tuner-freq">最可能的调性</div>
          </>
        ) : totalCounts > 0 ? (
          <div className="tuner-note" style={{ fontSize: 16, lineHeight: '24px', color: 'var(--text-muted)', textAlign: 'center' }}>正在听… 弹一下吧</div>
        ) : listening ? (
          <div className="tuner-note" style={{ fontSize: 16, lineHeight: '24px', color: 'var(--text-muted)', textAlign: 'center' }}>正在听… 弹一下吧</div>
        ) : (
          <div className="tuner-note" style={{ fontSize: 16, color: 'var(--text-dim)' }}>播放音乐开始分析</div>
        )}
      </div>

      {/* Top 3 候选 */}
      {totalCounts > 5 && (
        <div className="card">
          <h2>候选调性</h2>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4, marginBottom: 8 }}>
            证据：chroma · 已识别 {chordEvidenceCount} 个和弦
          </div>
          {hintPushed && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, marginBottom: 8 }}>
              已将该调反馈给和弦识别器（提升调内和弦识别度）
            </div>
          )}
          {top3.map((k, i) => (
            <div key={`${k.root}-${k.mode}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: i === 0 ? 700 : 400, color: i === 0 ? 'var(--success)' : 'var(--text)', minWidth: 90 }}>{k.name}</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-soft)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(k.score / keyScores[0].score) * 100}%`, borderRadius: 4, background: i === 0 ? 'var(--success)' : 'var(--border)' }} />
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
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
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
                  <span style={{ fontSize: 9, color: isBestRoot ? 'var(--success)' : 'var(--text-dim)', fontWeight: isBestRoot ? 700 : 400 }}>{name}</span>
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
