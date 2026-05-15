import { useCallback, useEffect, useRef, useState } from 'react';
import { chordDetector, type ChordDetectResult } from '../audio/chord-detector';
import { SHARP_NAMES } from '../theory/notes';
import { vibrate } from '../utils/haptic';
import { recordSession } from '../utils/progress';
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

/* ================ 实时识别和弦 ================ */
interface ChordEntry {
  name: string;
  time: number; // 相对于开始的秒数
  confidence: number;
}

function LiveChordRecognizer() {
  const [listening, setListening] = useState(false);
  const [current, setCurrent] = useState<ChordDetectResult | null>(null);
  const [history, setHistory] = useState<ChordEntry[]>([]);
  const [micState, setMicState] = useState<MicPermState>('idle');
  const startRef = useRef(0);
  const lastPushedChordRef = useRef('');
  const candidateChordRef = useRef('');
  const stableCountRef = useRef(0);
  const historyRef = useRef<ChordEntry[]>([]);

  useEffect(() => { historyRef.current = history; }, [history]);

  const start = useCallback(async () => {
    setMicState('requesting');
    const perm = await probeMic();
    if (perm !== 'granted') {
      setMicState(perm);
      return;
    }
    setMicState('granted');
    setCurrent(null);
    setHistory([]);
    historyRef.current = [];
    lastPushedChordRef.current = '';
    candidateChordRef.current = '';
    stableCountRef.current = 0;
    startRef.current = Date.now();
    await chordDetector.start((r) => {
      setCurrent(r);
      // 如果置信度较高，尝试进行稳定性判断
      if (r?.chord && r.confidence >= 0.55) {
        if (r.chord.name === candidateChordRef.current) {
          stableCountRef.current++;
        } else {
          candidateChordRef.current = r.chord.name;
          stableCountRef.current = 1;
        }

        // 只有当同一个和弦连续出现 6 次以上（约 100ms），才认为是稳定的，可以记录到历史中
        if (stableCountRef.current >= 6 && candidateChordRef.current !== lastPushedChordRef.current) {
          lastPushedChordRef.current = candidateChordRef.current;
          vibrate(10);
          setHistory(h => {
            const next = [...h, {
              name: candidateChordRef.current,
              time: Math.round((Date.now() - startRef.current) / 1000),
              confidence: r.confidence,
            }];
            // 限制历史记录数量，防止长时间运行导致内存和渲染压力过大
            if (next.length > 50) return next.slice(next.length - 50);
            return next;
          });
        }
      } else {
        // 置信度不够时，如果没检测到稳定和弦，重置计数器防止误判
        candidateChordRef.current = '';
        stableCountRef.current = 0;
      }
    });
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    chordDetector.stop();
    setListening(false);
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

  useEffect(() => () => { chordDetector.stop(); }, []);

  return (
    <>
      <MicPermissionState state={micState} onRetry={start} />

      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <button className={'btn ' + (listening ? '' : 'btn-primary')} style={{ width: 200 }} onClick={toggle}>
          {listening ? '■ 停止监听' : '🎤 开始监听'}
        </button>
      </div>

      {/* 当前识别结果 */}
      <div className="tuner-result" style={{ minHeight: 90 }}>
        {listening && current?.chord ? (
          <>
            <div className="tuner-note" style={{ color: 'var(--primary)' }}>{current.chord.name}</div>
            <div className="tuner-freq">{current.chord.fullName} · 置信度 {Math.round(current.confidence * 100)}%</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>检测到 {current.noteNames.join(' ')}</div>
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
              {history.map((h, i) => (
                <div key={i} style={{
                  display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
                  minWidth: 48, padding: '6px 8px', borderRadius: 8,
                  background: 'var(--bg-soft)', border: '1px solid var(--border)',
                }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)' }}>{h.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{h.time}s</span>
                </div>
              ))}
            </div>
            {/* 走向文本摘要 */}
            <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, letterSpacing: 1, color: 'var(--text)' }}>
              {history.map(h => h.name).join(' → ')}
            </div>
            <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => {
              const text = history.map(h => h.name).join(' → ');
              try { navigator.clipboard?.writeText(text); } catch {}
            }}>📋 复制走向</button>
          </div>
        </>
      )}

      <div className="card">
        <p style={{ fontSize: 13 }}>💡 <b>使用方法</b>：对着手机播放歌曲（音箱/另一台手机外放），app 会实时识别和弦变化并记录走向。也可以弹吉他自己录制和弦走向。</p>
        <p style={{ fontSize: 13 }}>⚠️ 识别效果受环境噪音影响。尽量安静环境 + 音源清晰。</p>
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
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    await chordDetector.start((r) => {
      if (r && r.detectedPcs.length > 0) {
        setPcCounts(prev => {
          const next = [...prev];
          for (const pc of r.detectedPcs) next[pc]++;
          return next;
        });
      }
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
  // 大调音阶模板（各音级权重）和小调音阶模板
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  const totalCounts = pcCounts.reduce((a, b) => a + b, 0);
  const maxCount = Math.max(...pcCounts, 1);

  // 计算每个调的相关性得分
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
  const bestKey = totalCounts > 20 ? keyScores[0] : null;
  const top3 = keyScores.slice(0, 3);

  // 同步给 stop 回调
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
            <div className="tuner-note" style={{ color: 'var(--green)' }}>{bestKey.name}</div>
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
      {totalCounts > 20 && (
        <div className="card">
          <h2>候选调性</h2>
          {top3.map((k, i) => (
            <div key={`${k.root}-${k.mode}`} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 14, fontWeight: i === 0 ? 700 : 400, color: i === 0 ? 'var(--green)' : 'var(--text)', minWidth: 90 }}>{k.name}</span>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-soft)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(k.score / keyScores[0].score) * 100}%`, borderRadius: 4, background: i === 0 ? 'var(--green)' : 'var(--border)' }} />
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
                  <div style={{ width: '100%', height: h, borderRadius: 3, background: isBestRoot ? 'var(--green)' : 'var(--primary)', minWidth: 6, transition: 'height .3s' }} />
                  <span style={{ fontSize: 9, color: isBestRoot ? 'var(--green)' : 'var(--text-dim)', fontWeight: isBestRoot ? 700 : 400 }}>{name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <p style={{ fontSize: 13 }}>💡 <b>听曲定调</b>：对着手机播放一段音乐（10-30 秒），app 会统计出现频率最高的音并通过 Krumhansl-Schmuckler 算法推断调性。</p>
        <p style={{ fontSize: 13 }}>适合：扒谱前先确定歌曲的调，然后去「音阶」页查看对应音阶在指板上的位置。</p>
      </div>
    </>
  );
}
