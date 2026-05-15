import { useCallback, useEffect, useRef, useState } from 'react';
import { chordDetector, type ChordDetectEvent, type DetectorSensitivity, type DetectorState } from '../audio/chord-detector';
import type { ChordDef } from '../theory/chords';
import { SHARP_NAMES } from '../theory/notes';
import { vibrate } from '../utils/haptic';
import { recordSession } from '../utils/progress';
import { addSavedProgression, loadSavedProgressions } from '../utils/saved-progressions';
import MicPermissionState, { type MicPermState } from '../components/MicPermissionState';

type Tab = 'chords' | 'key';

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
    historyRef.current = [];
    startRef.current = Date.now();

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
      }
    });
    setListening(true);
  }, [sensitivity]);

  const stop = useCallback(() => {
    chordDetector.stop();
    setListening(false);
    setState('idle');
    setProgress(0);
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
              <span>{activeChord.fullName} · {Math.round(activeConf * 100)}%</span>
              <span className={barClass} aria-label="稳定度">
                <span className="fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 12 }}>
                hold {Math.round(activeHeldMs)}ms
              </span>
            </div>
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
function KeyDetector() {
  const [listening, setListening] = useState(false);
  const [pcCounts, setPcCounts] = useState<number[]>(new Array(12).fill(0));
  const [elapsed, setElapsed] = useState(0);
  const [micState, setMicState] = useState<MicPermState>('idle');
  const timerRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const lastSampleTsRef = useRef(0);
  const bestKeyRef = useRef<{ root: number; mode: 'major' | 'minor'; score: number; name: string } | null>(null);

  const start = useCallback(async () => {
    setMicState('requesting');
    const perm = await probeMic();
    if (perm !== 'granted') {
      setMicState(perm);
      return;
    }
    setMicState('granted');
    setPcCounts(new Array(12).fill(0));
    setElapsed(0);
    startRef.current = Date.now();
    lastSampleTsRef.current = 0;
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);

    chordDetector.setProfile('live');
    await chordDetector.start((event: ChordDetectEvent) => {
      const raw = event.raw;
      if (!raw || raw.detectedPcs.length === 0) return;

      // 节流：200ms 采一次
      const now = performance.now();
      if (now - lastSampleTsRef.current < 200) return;
      lastSampleTsRef.current = now;

      // 只取前 4 强 pc，弱化"很多 pc 同时爆"的瞬态
      const topPcs = raw.detectedPcs.slice(0, 4);
      const weight = 1 / Math.min(raw.peakCount || 4, 6);
      setPcCounts(prev => {
        const next = [...prev];
        for (const pc of topPcs) next[pc] += weight;
        return next;
      });
    });
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    chordDetector.stop();
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
  for (let root = 0; root < 12; root++) {
    let majCorr = 0, minCorr = 0;
    for (let i = 0; i < 12; i++) {
      const rotated = pcCounts[(root + i) % 12];
      majCorr += rotated * majorProfile[i];
      minCorr += rotated * minorProfile[i];
    }
    keyScores.push(
      { root, mode: 'major' as const, score: majCorr, name: `${SHARP_NAMES[root]} 大调` },
      { root, mode: 'minor' as const, score: minCorr, name: `${SHARP_NAMES[root]} 小调` },
    );
  }
  keyScores.sort((a, b) => b.score - a.score);
  const bestKey = totalCounts > 5 ? keyScores[0] : null;
  const top3 = keyScores.slice(0, 3);

  useEffect(() => { bestKeyRef.current = bestKey; }, [bestKey]);

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
            <div className="tuner-note" style={{ color: 'var(--success)' }}>{bestKey.name}</div>
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
