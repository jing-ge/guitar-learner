import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChordDiagram from '../components/ChordDiagram';
import ChordHowTo from '../components/ChordHowTo';
import ChordLegend from '../components/ChordLegend';
import SubpageHero from '../components/SubpageHero';
import { CHORDS, type ChordDef, chordPlayablePositions, chordsByCategory } from '../theory/chords';
import { synth } from '../audio/synth';
import { vibrate, vibratePattern } from '../utils/haptic';
import { chordDetector, type ChordDetectEvent, type DetectorSensitivity, type DetectorState } from '../audio/chord-detector';
import { recordSessionThrottled, recordChordMistake } from '../utils/progress';
import { loadSavedProgressions, markPracticed, removeSavedProgression, type SavedProgression } from '../utils/saved-progressions';
import { chordDisplayName } from '../audio/chord-progressions';
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
  const [pageMode, setPageMode] = useState<PageMode>(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('gl_practice_pending')) return 'switch';
    return 'browse';
  });
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
  const [source, setSource] = useState<'preset' | 'custom' | 'saved'>('preset');
  const [customIds, setCustomIds] = useState<string[]>(['C','G','Am','F']);
  const [savedList, setSavedList] = useState<SavedProgression[]>(() => loadSavedProgressions());
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [beatInChord, setBeatInChord] = useState(0);
  const [playChordSound, setPlayChordSound] = useState(true);
  const timerRef = useRef<number | null>(null);

  const refreshSaved = useCallback(() => setSavedList(loadSavedProgressions()), []);

  // 启动时消费 pending 练习
  useEffect(() => {
    const pending = localStorage.getItem('gl_practice_pending');
    if (!pending) return;
    localStorage.removeItem('gl_practice_pending');
    const list = loadSavedProgressions();
    const found = list.find(p => p.id === pending);
    if (found) {
      setSavedList(list);
      setSource('saved');
      setActiveSavedId(found.id);
      setRunning(false);
      setCurrentIdx(0);
    }
  }, []);

  const activeSaved = source === 'saved' && activeSavedId
    ? savedList.find(p => p.id === activeSavedId) || null
    : null;

  const activeIds: string[] =
    source === 'preset' ? PRESETS[presetIdx].ids :
    source === 'custom' ? customIds :
    (activeSaved ? activeSaved.ids : []);

  const chordList = activeIds.map(id => CHORDS.find(c => c.id === id)!).filter(Boolean);
  const currentChord = chordList[currentIdx % Math.max(chordList.length, 1)];

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

  const handlePracticeSaved = (p: SavedProgression) => {
    setSource('saved');
    setActiveSavedId(p.id);
    setRunning(false);
    setCurrentIdx(0);
    markPracticed(p.id);
    refreshSaved();
  };

  const handleDeleteSaved = (id: string) => {
    removeSavedProgression(id);
    if (activeSavedId === id) setActiveSavedId(null);
    refreshSaved();
  };

  useEffect(() => {
    if (!running) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    if (chordList.length === 0) { setRunning(false); return; }
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
        <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }}>当前和弦</div>
        {currentChord && (
          <>
            <ChordDiagram shape={currentChord.shapes[0]} size={200} title={currentChord.name} colorMode="dark" />
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>{currentChord.fullName}</div>
          </>
        )}
        <div className="beat-dots" style={{ justifyContent: 'center', marginTop: 10 }}>
          {Array.from({ length: beatsPerChord }, (_, i) => (
            <div key={i} className={'beat-dot' + (running && i === beatInChord ? ' on' : '')} />
          ))}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          {chordList.map((c, i) => (
            <span key={`${c.id}-${i}`} style={{ fontWeight: i === currentIdx % chordList.length ? 700 : 400, color: i === currentIdx % chordList.length ? 'var(--brand)' : 'inherit' }}>
              {c.name}{i < chordList.length - 1 ? ' → ' : ''}
            </span>
          ))}
        </div>
      </div>

      {/* 走向来源：预设 / 自定义 / 我的 */}
      <div className="subpage-segmented" role="tablist" style={{ marginBottom: 10 }}>
        <button role="tab" aria-selected={source === 'preset'} className={source === 'preset' ? 'active' : ''}
          onClick={() => { setSource('preset'); setRunning(false); setCurrentIdx(0); }}>预设</button>
        <button role="tab" aria-selected={source === 'custom'} className={source === 'custom' ? 'active' : ''}
          onClick={() => { setSource('custom'); setRunning(false); setCurrentIdx(0); }}>自定义</button>
        <button role="tab" aria-selected={source === 'saved'} className={source === 'saved' ? 'active' : ''}
          onClick={() => { setSource('saved'); setRunning(false); setCurrentIdx(0); refreshSaved(); }}>我的（{savedList.length}）</button>
      </div>

      {source === 'preset' && (
        <div className="field" style={{ marginBottom: 10 }}>
          <label className="field-label">选择预设</label>
          <select className="select" value={presetIdx} onChange={e => { setPresetIdx(+e.target.value); setRunning(false); setCurrentIdx(0); }}>
            {PRESETS.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
          </select>
        </div>
      )}

      {source === 'custom' && (
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

      {source === 'saved' && (
        <div style={{ marginBottom: 10 }}>
          {savedList.length === 0 ? (
            <div className="empty-state">还没有保存的进行。去「听歌识别」录一段并保存吧。</div>
          ) : (
            <div className="saved-prog-list">
              {savedList.map(p => (
                <div key={p.id} className={'saved-prog-item' + (activeSavedId === p.id ? ' active' : '')}>
                  <div className="sp-head">
                    <div className="sp-name">{p.name}</div>
                    <div className="sp-meta">{p.ids.length} 个 · 练习 {p.practiceCount} 次</div>
                  </div>
                  <div className="sp-ids">{p.ids.map(id => chordDisplayName(id)).join(' → ')}</div>
                  <div className="sp-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => handlePracticeSaved(p)}>▶ 练习</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteSaved(p.id)}>🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        <div className="field">
          <label className="field-label">BPM</label>
          <input type="range" min={40} max={160} value={bpm} onChange={e => setBpm(+e.target.value)} style={{ width: '100%' }} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{bpm} BPM</span>
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

  // 消费 pending：从首页"需要补练"跳进来选中目标和弦
  useEffect(() => {
    const pending = localStorage.getItem('gl_chords_pending_id');
    if (!pending) return;
    localStorage.removeItem('gl_chords_pending_id');
    const chord = CHORDS.find(c => c.id === pending);
    if (!chord) return;
    setSelected(chord);
    for (const cat of categories) {
      if ((grouped[cat] || []).some(c => c.id === chord.id)) {
        setActiveCat(cat);
        break;
      }
    }
  }, [categories, grouped]);

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
          <div
            key={c.id}
            className="chord-card"
            role="button"
            tabIndex={0}
            aria-label={`${c.name} 和弦，难度 ${c.difficulty} 星`}
            aria-pressed={selected?.id === c.id}
            onClick={() => setSelected(c)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSelected(c);
              }
            }}
          >
            <div className="chord-difficulty-dots" aria-hidden="true">
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

function ChordDetect() {
  const [listening, setListening] = useState(false);
  const [activeChord, setActiveChord] = useState<ChordDef | null>(null);
  const [activeHeldMs, setActiveHeldMs] = useState(0);
  const [activeConf, setActiveConf] = useState(0);
  const [progress, setProgress] = useState(0);
  const [detState, setDetState] = useState<DetectorState>('idle');
  const [committedFlash, setCommittedFlash] = useState(false);
  const [targetChord, setTargetChord] = useState<ChordDef | null>(null);
  const [feedback, setFeedback] = useState<'right' | 'wrong' | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const [micState, setMicState] = useState<MicPermState>('idle');
  const [sensitivity, setSensitivity] = useState<DetectorSensitivity>('normal');

  // 会话级累计 & flush 状态
  const startRef = useRef<number>(Date.now());
  const sessionRightRef = useRef(0);
  const sessionTotalRef = useRef(0);
  const pendingFeedbackRef = useRef<'right' | 'wrong' | null>(null);
  const targetRef = useRef<ChordDef | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => { targetRef.current = targetChord; }, [targetChord]);
  useEffect(() => { chordDetector.setSensitivity(sensitivity); }, [sensitivity]);

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

  const newTarget = useCallback(() => {
    flushFeedback();
    const easy = CHORDS.filter(c => c.difficulty <= 2);
    setTargetChord(easy[Math.floor(Math.random() * easy.length)]);
    setFeedback(null);
    setActiveChord(null);
    setActiveHeldMs(0);
    setActiveConf(0);
    setProgress(0);
    setDetState('idle');
  }, [flushFeedback]);

  useEffect(() => {
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
    setActiveChord(null);
    setActiveHeldMs(0);
    setActiveConf(0);
    setProgress(0);
    setDetState('idle');
    startRef.current = Date.now();

    chordDetector.setProfile('practice');
    chordDetector.setSensitivity(sensitivity);

    await chordDetector.start((event: ChordDetectEvent) => {
      setDetState(event.state);
      setProgress(event.progress);

      if (event.active) {
        setActiveChord(event.active.chord);
        setActiveHeldMs(event.active.heldMs);
        setActiveConf(event.active.confidence);
      } else if (event.raw?.chord) {
        setActiveChord(event.raw.chord);
        setActiveHeldMs(0);
        setActiveConf(event.raw.confidence);
      } else {
        setActiveChord(null);
        setActiveHeldMs(0);
        setActiveConf(0);
      }

      if (event.justCommitted) {
        setCommittedFlash(true);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => setCommittedFlash(false), 220);

        // 复合判定：目标和弦 id 匹配 + 置信度 ≥ 0.65 + 持续 ≥ 400ms
        const tgt = targetRef.current;
        const c = event.justCommitted;
        if (tgt && c.chord.id === tgt.id && c.confidence >= 0.65 && c.durationMs >= 400) {
          vibrate(15);
          setFeedback('right');
          pendingFeedbackRef.current = 'right';
          setScore(s => ({ right: s.right + 1, total: s.total + 1 }));
          chordDetector.stop();
          setListening(false);
        }
      }
    });
    setListening(true);
  }, [sensitivity]);

  const stopListening = useCallback(() => {
    chordDetector.stop();
    setListening(false);
    setDetState('idle');
    setProgress(0);
    flushFeedback();
    fireToast();
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

  useEffect(() => () => {
    chordDetector.stop();
    flushFeedback();
    fireToast();
    sessionRightRef.current = 0;
    sessionTotalRef.current = 0;
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, [flushFeedback, fireToast]);

  const skipAndNext = () => {
    chordDetector.stop();
    setListening(false);
    setScore(s => ({ ...s, total: s.total + 1 }));
    setFeedback('wrong');
    pendingFeedbackRef.current = 'wrong';
    if (targetChord) recordChordMistake(targetChord.id);
  };

  const isMatching = activeChord && targetChord && activeChord.id === targetChord.id;
  const barClass = 'stability-bar' + (committedFlash ? ' committed' : detState === 'confirmed' || detState === 'committed' ? ' confirmed' : '');
  const nameClass = 'live-chord-name ' + (committedFlash ? 'committed' : detState === 'confirmed' || detState === 'committed' ? 'confirmed' : 'candidate');

  return (
    <>
      <MicPermissionState state={micState} onRetry={startListening} />

      <SensitivityControl value={sensitivity} onChange={setSensitivity} />

      {/* 出题模式 */}
      {targetChord && (
        <div className="quiz-prompt">
          请弹出和弦：<span style={{ color: 'var(--brand-strong)', fontSize: 28 }}>{targetChord.name}</span>
          <div style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)', marginTop: 4 }}>{targetChord.fullName}</div>
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
        <div className="tuner-result" style={{ minHeight: 110 }}>
          {activeChord ? (
            <>
              <div className={nameClass} style={{ color: isMatching ? 'var(--success)' : undefined }}>
                {activeChord.name}
              </div>
              <div className="tuner-freq" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{Math.round(activeConf * 100)}%</span>
                <span className={barClass} aria-label="稳定度">
                  <span className="fill" style={{ width: `${Math.round(progress * 100)}%` }} />
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: 12 }}>
                  hold {Math.round(activeHeldMs)}ms
                </span>
              </div>
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
            <button className="btn btn-primary btn-sm" onClick={() => { newTarget(); }}>下一题 →</button>
          </div>
        </div>
      )}

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <div>得分：<b>{score.right}</b> / {score.total}</div>
        <button className="btn btn-sm" onClick={() => { newTarget(); chordDetector.stop(); setListening(false); }}>换一题 →</button>
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <p style={{ fontSize: 13 }}>💡 <b>使用技巧</b>：扫弦后保持手型不动 ~0.5 秒，让识别引擎"稳定确认"。复合判定 = 置信度 ≥ 65% + 持续 ≥ 400ms。</p>
        <p style={{ fontSize: 13 }}>⚠️ 环境安静效果更好。如果一直识别不到，可切换到「宽松」灵敏度。</p>
      </div>
    </>
  );
}
