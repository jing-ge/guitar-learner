import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChordDiagram from '../components/ChordDiagram';
import ChordHowTo from '../components/ChordHowTo';
import ChordLegend from '../components/ChordLegend';
import SubpageHero from '../components/SubpageHero';
import { CHORDS, type ChordDef, chordPlayablePositions, chordsByCategory } from '../theory/chords';
import { synth } from '../audio/synth';
import { vibrate, vibratePattern } from '../utils/haptic';
import { chordDetector, type ChordDetectResult } from '../audio/chord-detector';
import { recordSessionThrottled } from '../utils/progress';
import MicPermissionState, { type MicPermState } from '../components/MicPermissionState';

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

type PageMode = 'browse' | 'switch' | 'detect';

const MODE_META: Record<PageMode, { label: string; title: string; desc: string }> = {
  browse: {
    label: '📖 和弦库',
    title: '和弦库',
    desc: `${CHORDS.length}+ 常用和弦 · 按弦图 + 文字说明`,
  },
  switch: {
    label: '🔄 转换练习',
    title: '和弦转换',
    desc: '跟节拍器练习平滑切换',
  },
  detect: {
    label: '🎤 弹琴检测',
    title: '弹琴检测',
    desc: '对着麦克风弹，AI 听你按对没',
  },
};

export default function ChordsPage() {
  const [pageMode, setPageMode] = useState<PageMode>('browse');
  const modes: PageMode[] = ['browse', 'switch', 'detect'];

  // 切走时停止检测
  useEffect(() => {
    if (pageMode !== 'detect') chordDetector.stop();
  }, [pageMode]);

  return (
    <div>
      <SubpageHero
        eyebrow="LEARN · CHORDS"
        title={MODE_META[pageMode].title}
        desc={MODE_META[pageMode].desc}
      >
        <div className="subpage-segmented" role="tablist">
          {modes.map(m => (
            <button
              key={m}
              role="tab"
              aria-selected={pageMode === m}
              className={pageMode === m ? 'active' : ''}
              onClick={() => setPageMode(m)}
            >
              {MODE_META[m].label}
            </button>
          ))}
        </div>
      </SubpageHero>
      {pageMode === 'browse' && <ChordBrowser />}
      {pageMode === 'switch' && <ChordSwitchDrill />}
      {pageMode === 'detect' && <ChordDetect />}
    </div>
  );
}

/* ====== 和弦转换练习 ====== */
const PRESETS = [
  { name: 'C-G-Am-F', ids: ['C','G','Am','F'] },
  { name: 'G-D-Em-C', ids: ['G','D','Em','C'] },
  { name: 'Am-F-C-G', ids: ['Am','F','C','G'] },
  { name: 'Em-G-D-A', ids: ['Em','G','D','A'] },
  { name: 'D-A-Bm-G', ids: ['D','A','Bm','G'] },
];

// 可用于自定义的和弦（简单和弦优先）
const PICKABLE = CHORDS.filter(c => c.difficulty <= 3).map(c => c.id);

function ChordSwitchDrill() {
  const [bpm, setBpm] = useState(60);
  const [beatsPerChord, setBeatsPerChord] = useState(4);
  const [presetIdx, setPresetIdx] = useState(0);
  const [customMode, setCustomMode] = useState(false);
  const [customIds, setCustomIds] = useState<string[]>(['C','G','Am','F']);
  const [running, setRunning] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [beatInChord, setBeatInChord] = useState(0);
  const [playChordSound, setPlayChordSound] = useState(true);
  const timerRef = useRef<number | null>(null);

  const activeIds = customMode ? customIds : PRESETS[presetIdx].ids;
  const chordList = activeIds.map(id => CHORDS.find(c => c.id === id)!).filter(Boolean);
  const currentChord = chordList[currentIdx % chordList.length];

  // 自定义走向：增删和弦
  const addChord = (id: string) => {
    if (customIds.length < 8) setCustomIds([...customIds, id]);
  };
  const removeChord = (i: number) => {
    if (customIds.length > 2) setCustomIds(customIds.filter((_, j) => j !== i));
  };
  const swapChord = (i: number, id: string) => {
    const next = [...customIds]; next[i] = id; setCustomIds(next);
  };

  useEffect(() => {
    if (!running) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    let beat = 0;
    synth.click(true);
    vibrate(30);
    // 第一拍扫弦
    if (playChordSound && chordList[0]) {
      synth.strum(chordPlayablePositions(chordList[0].shapes[0]), { duration: 1.5 });
    }
    setBeatInChord(0);
    setCurrentIdx(0);
    beat = 1;
    const interval = 60000 / bpm;
    timerRef.current = window.setInterval(() => {
      const posInChord = beat % beatsPerChord;
      const isAccent = posInChord === 0;
      synth.click(isAccent);
      if (isAccent) {
        vibrate(30);
        const idx = Math.floor(beat / beatsPerChord) % chordList.length;
        setCurrentIdx(idx);
        if (playChordSound && chordList[idx]) {
          synth.strum(chordPlayablePositions(chordList[idx].shapes[0]), { duration: 1.5 });
        }
      }
      setBeatInChord(posInChord);
      beat++;
    }, interval);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [running, bpm, beatsPerChord, chordList.length]);

  return (
    <>
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 4 }}>当前和弦</div>
        {currentChord && (
          <>
            <ChordDiagram shape={currentChord.shapes[0]} size={200} title={currentChord.name} colorMode="dark" />
            <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4 }}>{currentChord.fullName}</div>
          </>
        )}
        <div className="beat-dots" style={{ justifyContent: 'center', marginTop: 10 }}>
          {Array.from({ length: beatsPerChord }, (_, i) => (
            <div key={i} className={'beat-dot' + (running && i === beatInChord ? ' on' : '')} />
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
          {chordList.map((c, i) => (
            <span key={`${c.id}-${i}`} style={{ fontWeight: i === currentIdx % chordList.length ? 700 : 400, color: i === currentIdx % chordList.length ? 'var(--primary)' : 'inherit' }}>
              {c.name}{i < chordList.length - 1 ? ' → ' : ''}
            </span>
          ))}
        </div>
      </div>

      {/* 走向选择：预设 / 自定义 */}
      <div className="chip-row" style={{ marginBottom: 8 }}>
        <button className={'chip' + (!customMode ? ' active' : '')} onClick={() => { setCustomMode(false); setRunning(false); }}>预设走向</button>
        <button className={'chip' + (customMode ? ' active' : '')} onClick={() => { setCustomMode(true); setRunning(false); }}>自定义</button>
      </div>

      {!customMode ? (
        <div className="field" style={{ marginBottom: 10 }}>
          <label className="field-label">选择预设</label>
          <select className="select" value={presetIdx} onChange={e => { setPresetIdx(+e.target.value); setRunning(false); setCurrentIdx(0); }}>
            {PRESETS.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
          </select>
        </div>
      ) : (
        <div className="card" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>自定义走向（2-8 个和弦）</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {customIds.map((id, i) => (
              <div key={`${id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <select className="select" style={{ height: 32, fontSize: 13, minWidth: 60, padding: '0 6px' }}
                  value={id} onChange={e => swapChord(i, e.target.value)}>
                  {PICKABLE.map(cid => <option key={cid} value={cid}>{cid}</option>)}
                </select>
                {customIds.length > 2 && (
                  <button className="btn btn-sm" style={{ minHeight: 28, padding: '0 6px', fontSize: 12 }}
                    onClick={() => removeChord(i)}>✕</button>
                )}
              </div>
            ))}
            {customIds.length < 8 && (
              <button className="btn btn-sm" onClick={() => addChord('C')} style={{ minHeight: 32 }}>+ 加和弦</button>
            )}
          </div>
        </div>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        <div className="field">
          <label className="field-label">BPM</label>
          <input type="range" min={40} max={160} value={bpm} onChange={e => setBpm(+e.target.value)} style={{ width: '100%' }} />
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{bpm} BPM</span>
        </div>
        <div className="field">
          <label className="field-label">每和弦拍数</label>
          <select className="select" value={beatsPerChord} onChange={e => setBeatsPerChord(+e.target.value)}>
            {[2,4,8].map(n => <option key={n} value={n}>{n} 拍</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
        <button className={'btn ' + (running ? '' : 'btn-primary')} style={{ width: 160 }}
          onClick={async () => { await synth.unlock(); setRunning(r => !r); }}>
          {running ? '■ 停止' : '▶ 开始练习'}
        </button>
        <button className={'chip' + (playChordSound ? ' active' : '')} onClick={() => setPlayChordSound(v => !v)} style={{ height: 36 }}>
          {playChordSound ? '🔊 示范音 开' : '🔇 示范音 关'}
        </button>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p style={{ fontSize: 13 }}>💡 跟着节拍器练习和弦转换。先用 BPM=40 慢速把每个和弦按稳，再逐步提速。自定义模式可以练你正在学的歌的和弦走向。</p>
      </div>
    </>
  );
}

/* ====== 和弦浏览 ====== */
function ChordBrowser() {
  const grouped = useMemo(() => chordsByCategory(), []);
  const categories = Object.keys(grouped);
  const [activeCat, setActiveCat] = useState<string>(categories[0]);
  const [selected, setSelected] = useState<ChordDef | null>(CHORDS[0]);

  const playStrum = async (chord: ChordDef, direction: 'down' | 'up' = 'down') => {
    await synth.unlock();
    const positions = chordPlayablePositions(chord.shapes[0]);
    synth.strum(positions, { direction });
  };

  const playArpeggio = async (chord: ChordDef) => {
    await synth.unlock();
    const positions = chordPlayablePositions(chord.shapes[0])
      .sort((a, b) => b.stringNum - a.stringNum); // 6 弦 → 1 弦
    positions.forEach((p, i) => synth.playFret(p.stringNum, p.fret, 2.5, i * 0.18));
  };

  return (
    <div>
      {/* 分类切换：subpage-tabs 风格 */}
      <div className="subpage-tabs" role="tablist">
        {categories.map(c => (
          <button
            key={c}
            role="tab"
            aria-selected={c === activeCat}
            className={c === activeCat ? 'active' : ''}
            onClick={() => setActiveCat(c)}
          >
            {c}
            <span className="subpage-tabs-count">{grouped[c]?.length || 0}</span>
          </button>
        ))}
      </div>

      {/* 当前选中和弦详情 */}
      {selected && (
        <div className="chord-detail">
          <ChordDiagram shape={selected.shapes[0]} size={220} title={selected.name} colorMode="dark" />
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
            {selected.fullName} · 难度 {'★'.repeat(selected.difficulty)}{'☆'.repeat(5 - selected.difficulty)}
          </div>
          {selected.tips && <div className="tips">💡 {selected.tips}</div>}
          <ChordHowTo shape={selected.shapes[0]} />
          <ChordLegend />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn btn-primary btn-sm" onClick={() => playStrum(selected, 'down')}>
              ⬇ 下扫
            </button>
            <button className="btn btn-sm" onClick={() => playStrum(selected, 'up')}>
              ⬆ 上扫
            </button>
            <button className="btn btn-sm" onClick={() => playArpeggio(selected)}>
              🎼 分解
            </button>
          </div>
        </div>
      )}

      {/* 和弦库 */}
      <div className="section-title">{activeCat}（{grouped[activeCat]?.length || 0}）</div>
      <div className="chord-grid">
        {(grouped[activeCat] || []).map(c => (
          <div key={c.id} className="chord-card" onClick={() => setSelected(c)}>
            <div className="chord-difficulty-dots" aria-label={`难度 ${c.difficulty}/5`}>
              {Array.from({ length: 5 }, (_, i) => (
                <span key={i} className={'dot ' + (i < c.difficulty ? 'on' : 'off')} />
              ))}
            </div>
            <ChordDiagram shape={c.shapes[0]} size={120} title={c.name} colorMode="dark" />
            <div className="chord-name">{c.fullName}</div>
          </div>
        ))}
      </div>

      {/* 和弦走向小练习 */}
      <div className="section-title">常用走向</div>
      <div className="card">
        <p style={{ marginBottom: 10 }}>
          点击下方走向可以按顺序试听（每个和弦约 1.5 秒）：
        </p>
        <div className="btn-row">
          {[
            { name: '🎶 C–G–Am–F（神级 4 和弦）', seq: ['C','G','Am','F'] },
            { name: '🎶 G–D–Em–C', seq: ['G','D','Em','C'] },
            { name: '🎶 Am–F–C–G', seq: ['Am','F','C','G'] },
            { name: '🎶 Em–C–G–D', seq: ['Em','C','G','D'] },
          ].map(p => (
            <button key={p.name} className="btn btn-sm" onClick={async () => {
              await synth.unlock();
              p.seq.forEach((id, i) => {
                const c = CHORDS.find(x => x.id === id);
                if (c) {
                  const positions = chordPlayablePositions(c.shapes[0]);
                  setTimeout(() => {
                    setSelected(c);
                    synth.strum(positions);
                  }, i * 1500);
                }
              });
            }}>{p.name}</button>
          ))}
        </div>
      </div>

      {/* 学习建议 */}
      <div className="section-title">练习建议</div>
      <div className="card">
        <p><b>第 1 周</b>：先把 C、Am、Em、G 四个和弦练熟，每个保持响亮干净再换。</p>
        <p><b>第 2 周</b>：加入 D 和 F（横按可暂时用 Fmaj7 替代）；练习「C → G → Am → F」走向。</p>
        <p><b>横按技巧</b>：食指略偏向外侧（用骨头按而不是肉），手腕下放接近琴颈背面正中。</p>
      </div>
    </div>
  );
}

/* ====== 弹琴检测 ====== */
function ChordDetect() {
  const [listening, setListening] = useState(false);
  const [result, setResult] = useState<ChordDetectResult | null>(null);
  const [targetChord, setTargetChord] = useState<ChordDef | null>(null);
  const [feedback, setFeedback] = useState<'right' | 'wrong' | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const [micState, setMicState] = useState<MicPermState>('idle');

  // 会话级累计 & flush 状态
  const startRef = useRef<number>(Date.now());
  const sessionRightRef = useRef(0);
  const sessionTotalRef = useRef(0);
  const pendingFeedbackRef = useRef<'right' | 'wrong' | null>(null);

  // 把 pendingFeedback 累加进 throttled 记录
  const flushFeedback = useCallback(() => {
    const pending = pendingFeedbackRef.current;
    if (!pending) return;
    const elapsed = Math.max(1, Math.round((Date.now() - startRef.current) / 1000));
    recordSessionThrottled('chord-detect', pending === 'right' ? 1 : 0, 1, elapsed, 30);
    sessionRightRef.current += pending === 'right' ? 1 : 0;
    sessionTotalRef.current += 1;
    pendingFeedbackRef.current = null;
    startRef.current = Date.now();
  }, []);

  const fireToast = useCallback(() => {
    if (sessionTotalRef.current <= 0) return;
    window.dispatchEvent(new CustomEvent('progress-recorded', {
      detail: { text: `已记录 · 和弦识别 ${sessionRightRef.current}/${sessionTotalRef.current}` }
    }));
  }, []);

  // 随机出题模式
  const newTarget = useCallback(() => {
    // 进入新一题前 flush 上一题
    flushFeedback();
    const easy = CHORDS.filter(c => c.difficulty <= 2);
    setTargetChord(easy[Math.floor(Math.random() * easy.length)]);
    setFeedback(null);
  }, [flushFeedback]);

  useEffect(() => {
    // 首次出题（不需要 flush）
    const easy = CHORDS.filter(c => c.difficulty <= 2);
    setTargetChord(easy[Math.floor(Math.random() * easy.length)]);
    setFeedback(null);
    startRef.current = Date.now();
  }, []);

  const startListening = useCallback(async () => {
    setMicState('requesting');
    const perm = await probeMic();
    if (perm !== 'granted') {
      setMicState(perm);
      return;
    }
    setMicState('granted');
    setFeedback(null);
    startRef.current = Date.now();
    await chordDetector.start((r) => {
      setResult(r);
      // 自动判定：如果有目标且匹配
      if (r?.chord && targetChord && r.chord.id === targetChord.id && r.confidence >= 0.5) {
        vibrate(15);
        setFeedback('right');
        pendingFeedbackRef.current = 'right';
        setScore(s => ({ right: s.right + 1, total: s.total + 1 }));
        chordDetector.stop();
        setListening(false);
      }
    });
    setListening(true);
  }, [targetChord]);

  const stopListening = useCallback(() => {
    chordDetector.stop();
    setListening(false);
    flushFeedback();
    fireToast();
    // 重置会话累计，下次开麦重新计
    sessionRightRef.current = 0;
    sessionTotalRef.current = 0;
  }, [flushFeedback, fireToast]);

  const toggle = useCallback(async () => {
    if (listening) {
      stopListening();
      return;
    }
    await startListening();
  }, [listening, stopListening, startListening]);

  // 卸载 / 离开 detect 子模式时 flush + toast
  useEffect(() => () => {
    chordDetector.stop();
    flushFeedback();
    fireToast();
    sessionRightRef.current = 0;
    sessionTotalRef.current = 0;
  }, [flushFeedback, fireToast]);

  const skipAndNext = () => {
    chordDetector.stop();
    setListening(false);
    setScore(s => ({ ...s, total: s.total + 1 }));
    setFeedback('wrong');
    pendingFeedbackRef.current = 'wrong';
  };

  return (
    <>
      <MicPermissionState state={micState} onRetry={startListening} />

      {/* 出题模式 */}
      {targetChord && (
        <div className="quiz-prompt">
          请弹出和弦：<span style={{ color: 'var(--primary)', fontSize: 28 }}>{targetChord.name}</span>
          <div style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-dim)', marginTop: 4 }}>{targetChord.fullName}</div>
        </div>
      )}

      {/* 参考指法图 */}
      {targetChord && (
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <ChordDiagram shape={targetChord.shapes[0]} size={160} title={targetChord.name} colorMode="dark" />
        </div>
      )}

      {/* 控制按钮 */}
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        {!listening && !feedback && (
          <button className="btn btn-primary" onClick={toggle}>🎤 开始听我弹</button>
        )}
        {listening && (
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={stopListening}>■ 停止</button>
            <button className="btn btn-sm" onClick={skipAndNext}>跳过 →</button>
          </div>
        )}
      </div>

      {/* 实时检测反馈 */}
      {listening && (
        <div className="tuner-result">
          {result?.chord ? (
            <>
              <div className="tuner-note" style={{ color: result.chord.id === targetChord?.id ? 'var(--green)' : 'var(--text)' }}>
                {result.chord.name}
              </div>
              <div className="tuner-freq">
                置信度 {Math.round(result.confidence * 100)}% · 检测到 {result.noteNames.join(' ')}
              </div>
            </>
          ) : result ? (
            <>
              <div className="tuner-note" style={{ fontSize: 18, color: 'var(--text-dim)' }}>识别中…</div>
              <div className="tuner-freq">检测到 {result.noteNames.join(' ')}</div>
            </>
          ) : (
            <div className="tuner-note" style={{ fontSize: 16, lineHeight: '24px', color: 'var(--text-muted)', textAlign: 'center' }}>正在听… 弹一下吧</div>
          )}
        </div>
      )}

      {/* 判定结果 */}
      {feedback && (
        <div className={'quiz-feedback ' + feedback} style={{ fontSize: 16 }}>
          {feedback === 'right'
            ? `正确！识别到 ${targetChord?.name}`
            : `跳过了，正确答案是 ${targetChord?.name}`}
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={() => { newTarget(); setResult(null); }}>下一题 →</button>
          </div>
        </div>
      )}

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <div>得分：<b>{score.right}</b> / {score.total}</div>
        <button className="btn btn-sm" onClick={() => { newTarget(); setResult(null); chordDetector.stop(); setListening(false); }}>换一题 →</button>
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <p style={{ fontSize: 13 }}>💡 <b>使用技巧</b>：扫弦时尽量让每根弦都清晰响亮。手机尽量靠近吉他音孔。检测基于频谱分析匹配和弦库中的组成音。</p>
        <p style={{ fontSize: 13 }}>⚠️ 环境安静效果更好。如果识别率不佳，先用「调音器」把琴调准。</p>
      </div>
    </>
  );
}