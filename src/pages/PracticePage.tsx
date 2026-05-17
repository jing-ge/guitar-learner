import { Link } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { synth } from '../audio/synth';
import { ALL_ROOTS, pcToName } from '../theory/notes';
import { CHORDS, chordPlayablePositions } from '../theory/chords';
import Fretboard from '../components/Fretboard';
import { vibrate, vibratePattern } from '../utils/haptic';
import { getTodayStats, getRecentDays, recordSession } from '../utils/progress';

type Tab = 'quiz' | 'fifths' | 'caged' | 'metronome' | 'rhythm' | 'songs' | 'stats';

type MenuItem = {
  key: Tab;
  title: string;
  desc: string;
  tag: string;
};

const TRAINING_MENU: MenuItem[] = [
  { key: 'quiz', title: '听音辨认', desc: '听一个音并快速判断音名，适合每天热身。', tag: '推荐新手' },
  { key: 'fifths', title: '五度圈速答', desc: '强化调性顺序、关系大小调和调号记忆。', tag: '计分' },
  { key: 'caged', title: 'CAGED', desc: '观察和弦在整块指板上的位置连接。', tag: '推荐新手' },
  { key: 'metronome', title: '节拍器', desc: '稳定速度、拍点和基础律动。', tag: '工具' },
  { key: 'rhythm', title: '节奏型', desc: '跟着示范练常用扫弦与分解节奏。', tag: '自由练习' },
  { key: 'songs', title: '歌曲跟弹', desc: '按和弦走向练习切换与跟拍。', tag: '自由练习' },
  { key: 'stats', title: '练习记录', desc: '查看今天与近期练习的累计情况。', tag: '数据' },
];

function renderTrainingContent(tab: Tab) {
  if (tab === 'metronome') return <Metronome />;
  if (tab === 'rhythm') return <RhythmPatterns />;
  if (tab === 'songs') return <SongChords />;
  if (tab === 'caged') return <CAGEDSystem />;
  if (tab === 'fifths') return <FifthsQuiz />;
  if (tab === 'quiz') return <ListeningQuiz />;
  return <StatsView />;
}

export default function PracticePage() {
  const [activeTab, setActiveTab] = useState<Tab | null>(null);

  return (
    <div>
      {activeTab === null ? (
        <div className="practice-menu-shell page-enter">
          <div className="card">
            <h2>🎯 综合训练</h2>
            <p>从一个训练开始，不再堆叠多个入口。先选项目，再进入内容。</p>
          </div>
          <div className="practice-entry-list">
            {TRAINING_MENU.map((item) => (
              <button key={item.key} className="module-menu-card" onClick={() => setActiveTab(item.key)}>
                <div>
                  <div className="menu-card-title">{item.title}</div>
                  <p>{item.desc}</p>
                </div>
                <span className="menu-card-tag">{item.tag}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="page-enter">
          <div className="subpage-header practice-inner-header">
            <button className="btn btn-ghost subpage-back" onClick={() => setActiveTab(null)}>
              ← 返回训练菜单
            </button>
            <div className="subpage-title">{TRAINING_MENU.find((item) => item.key === activeTab)?.title}</div>
            <div className="subpage-meta">{TRAINING_MENU.find((item) => item.key === activeTab)?.tag}</div>
          </div>
          {renderTrainingContent(activeTab)}
        </div>
      )}
    </div>
  );
}

/* ================ 节拍器 ================ */
function Metronome() {
  const [bpm, setBpm] = useState(80);
  const [beats, setBeats] = useState(4);
  const [running, setRunning] = useState(false);
  const [current, setCurrent] = useState(-1);
  
  const nextNoteTimeRef = useRef(0);
  const currentBeatRef = useRef(0);
  const timerRef = useRef<number|null>(null);
  const uiQueueRef = useRef<{ beat: number; time: number }[]>([]);
  const uiTimerRef = useRef<number|null>(null);

  useEffect(() => {
    if (!running) {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (uiTimerRef.current) cancelAnimationFrame(uiTimerRef.current);
      setCurrent(-1);
      return;
    }

    const start = async () => {
      await synth.unlock();
      nextNoteTimeRef.current = synth.getCurrentTime() + 0.1;
      currentBeatRef.current = 0;
      uiQueueRef.current = [];

      const scheduleAheadTime = 0.15;
      const lookahead = 25.0;

      const scheduler = () => {
        while (nextNoteTimeRef.current < synth.getCurrentTime() + scheduleAheadTime) {
          const isAcc = currentBeatRef.current === 0;
          synth.click(isAcc, nextNoteTimeRef.current);
          uiQueueRef.current.push({ beat: currentBeatRef.current, time: nextNoteTimeRef.current });
          nextNoteTimeRef.current += 60.0 / bpm;
          currentBeatRef.current = (currentBeatRef.current + 1) % beats;
        }
        timerRef.current = window.setTimeout(scheduler, lookahead);
      };

      const drawUI = () => {
        const now = synth.getCurrentTime();
        let lastBeat = -1;
        while (uiQueueRef.current.length > 0 && uiQueueRef.current[0].time <= now) {
          lastBeat = uiQueueRef.current[0].beat;
          uiQueueRef.current.shift();
        }
        if (lastBeat !== -1) {
          setCurrent(lastBeat);
          if (lastBeat === 0) vibrate(20);
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
  }, [running, bpm, beats]);

  return (
    <div className="metronome">
      <div className="bpm-display">{bpm}</div>
      <div style={{fontSize:12,color:'var(--text-dim)'}}>BPM</div>
      <input type="range" min={40} max={220} value={bpm} onChange={e=>setBpm(+e.target.value)} style={{width:'100%',maxWidth:320}} />
      <div className="bpm-row">
        <button className="btn btn-sm" onClick={()=>setBpm(b=>Math.max(40,b-5))}>−5</button>
        <button className="btn btn-sm" onClick={()=>setBpm(b=>Math.max(40,b-1))}>−1</button>
        <button className="btn btn-sm" onClick={()=>setBpm(b=>Math.min(220,b+1))}>+1</button>
        <button className="btn btn-sm" onClick={()=>setBpm(b=>Math.min(220,b+5))}>+5</button>
      </div>
      <div className="bpm-row">
        <span style={{fontSize:13,color:'var(--text-dim)'}}>拍号：</span>
        {[3,4,6,8].map(n=>(<button key={n} className={'chip'+(beats===n?' active':'')} onClick={()=>setBeats(n)}>{n}/4</button>))}
      </div>
      <div className="beat-dots">{Array.from({length:beats},(_,i)=>(<div key={i} className={'beat-dot'+(i===current?' on':'')} />))}</div>
      <button className={'btn '+(running?'':'btn-primary')} style={{width:160}} onClick={async()=>{await synth.unlock();setRunning(r=>!r);}}>{running?'■ 停止':'▶ 开始'}</button>
    </div>
  );
}

/* ================ 节奏型库 ================ */
interface RhythmDef {
  name: string;
  pattern: string;
  desc: string;
  beats: string[];
  /** 示范指令：down/up/thumb/mute/s1~s6(弹单弦) */
  strumDirs: string[];
}

const RHYTHM_PATTERNS: RhythmDef[] = [
  { name: '民谣万能 4/4', pattern: '⬇ ⬇ ⬆ ⬆ ⬇ ⬆', desc: '下下上上下上（D D U U D U），几乎所有民谣歌曲通用。',
    beats: ['D','D','U','U','D','U'], strumDirs: ['down','down','up','up','down','up'] },
  { name: '慢摇 4/4', pattern: '⬇ · ⬇ ⬆ · ⬆ ⬇ ⬆', desc: '在第2、5拍留空，更放松的感觉。',
    beats: ['D','·','D','U','·','U','D','U'], strumDirs: ['down','mute','down','up','mute','up','down','up'] },
  { name: '指弹分解 4/4', pattern: 'T 3 2 1 2 3', desc: '拇指弹 5 弦低音，然后依次弹 3→2→1→2→3 弦。',
    beats: ['T','3','2','1','2','3'], strumDirs: ['thumb','s3','s2','s1','s2','s3'] },
  { name: '指弹分解 变体', pattern: 'T 3 2 3 1 3 2 3', desc: '更密集的分解指法，T-3-2-3-1-3-2-3，乡村/流行常用。',
    beats: ['T','3','2','3','1','3','2','3'], strumDirs: ['thumb','s3','s2','s3','s1','s3','s2','s3'] },
  { name: '三拍华尔兹 3/4', pattern: '⬇ ⬆ ⬆', desc: '强-弱-弱，每小节三拍。',
    beats: ['D','U','U'], strumDirs: ['down','up','up'] },
  { name: '切分节奏', pattern: '⬇ · ⬆ ⬇ ⬆ · ⬆ ⬇', desc: '切分重音，Reggae/Ska 风格。',
    beats: ['D','·','U','D','U','·','U','D'], strumDirs: ['down','mute','up','down','up','mute','up','down'] },
];

// C 和弦的各弦位置（用于示范）
const DEMO_CHORD = chordPlayablePositions(CHORDS.find(c => c.id === 'C')!.shapes[0]);
const DEMO_LOW = DEMO_CHORD.filter(p => p.stringNum >= 4); // 低音弦（拇指）
const DEMO_HIGH = DEMO_CHORD.filter(p => p.stringNum <= 3); // 高音弦（上扫）

function RhythmPatterns() {
  const [selected, setSelected] = useState(0);
  const [bpm, setBpm] = useState(80);
  const [playing, setPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(-1);
  
  const timerRef = useRef<number | null>(null);
  const nextNoteTimeRef = useRef(0);
  const currentBeatRef = useRef(0);
  const uiQueueRef = useRef<{ beat: number; time: number }[]>([]);
  const uiTimerRef = useRef<number | null>(null);

  const p = RHYTHM_PATTERNS[selected];

  // 播放示范
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
      if (uiTimerRef.current) cancelAnimationFrame(uiTimerRef.current);
      setCurrentBeat(-1);
      return;
    }

    const start = async () => {
      await synth.unlock();
      nextNoteTimeRef.current = synth.getCurrentTime() + 0.1;
      currentBeatRef.current = 0;
      uiQueueRef.current = [];

      const isSubdivided = p.beats.length > 4;
      const intervalSecs = (isSubdivided ? (60.0 / bpm / 2) : (60.0 / bpm));
      const scheduleAheadTime = 0.15;
      const lookahead = 25.0;

      const scheduler = () => {
        while (nextNoteTimeRef.current < synth.getCurrentTime() + scheduleAheadTime) {
          const idx = currentBeatRef.current;
          playBeat(p.strumDirs[idx], nextNoteTimeRef.current);
          uiQueueRef.current.push({ beat: idx, time: nextNoteTimeRef.current });
          
          nextNoteTimeRef.current += intervalSecs;
          currentBeatRef.current = (currentBeatRef.current + 1) % p.beats.length;
        }
        timerRef.current = window.setTimeout(scheduler, lookahead);
      };

      const drawUI = () => {
        const now = synth.getCurrentTime();
        let lastBeat = -1;
        while (uiQueueRef.current.length > 0 && uiQueueRef.current[0].time <= now) {
          lastBeat = uiQueueRef.current[0].beat;
          uiQueueRef.current.shift();
        }
        if (lastBeat !== -1) {
          setCurrentBeat(lastBeat);
          if (lastBeat === 0) vibrate(15);
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
  }, [playing, bpm, selected]);

  // 切换节奏型时停止
  useEffect(() => { setPlaying(false); }, [selected]);

  return (
    <>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        {RHYTHM_PATTERNS.map((r, i) => (
          <button key={i} className={'chip' + (i === selected ? ' active' : '')} onClick={() => setSelected(i)}>{r.name}</button>
        ))}
      </div>
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 8, color: 'var(--primary)', margin: '10px 0' }}>{p.pattern}</div>
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>{p.desc}</div>

        {/* 节拍色块 + 高亮动画 */}
        <div className="chip-row" style={{ justifyContent: 'center', marginTop: 14, gap: 4 }}>
          {p.beats.map((b, i) => {
            const isActive = playing && i === currentBeat;
            return (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: 8, fontSize: 14, fontWeight: 600,
                background: isActive
                  ? '#fff'
                  : b === 'D' ? 'var(--primary)' : b === 'U' ? 'var(--accent)' : b === 'T' ? 'var(--green)' : /^[1-6]$/.test(b) ? '#6366f1' : 'var(--bg-soft)',
                color: isActive
                  ? '#1f2937'
                  : b === '·' ? 'var(--text-dim)' : '#fff',
                border: isActive ? '2px solid var(--primary)' : '1px solid var(--border)',
                transform: isActive ? 'scale(1.25)' : 'scale(1)',
                transition: 'all .08s',
              }}>{b}</span>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>D=下扫 U=上扫 T=拇指低音 数字=弦号 ·=空拍</div>

        {/* 播放控制 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 14 }}>
          <button className={'btn ' + (playing ? '' : 'btn-primary')} style={{ width: 140 }}
            onClick={async () => { await synth.unlock(); setPlaying(r => !r); }}>
            {playing ? '■ 停止' : '▶ 播放示范'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>BPM</span>
          <button className="btn btn-sm" onClick={() => setBpm(b => Math.max(40, b - 10))}>−10</button>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--primary)', minWidth: 40, textAlign: 'center' }}>{bpm}</span>
          <button className="btn btn-sm" onClick={() => setBpm(b => Math.min(180, b + 10))}>+10</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>用 C 和弦示范 · 先慢后快</div>
      </div>
      <div className="card"><p style={{ fontSize: 13 }}>💡 听示范掌握节奏感觉，然后关掉示范，跟着节拍器自己练。右手保持上下摆动（空拍时手不停），逐步加速。</p></div>
    </>
  );
}

/** 根据指令用 C 和弦发声 */
function playBeat(dir: string, when: number = 0) {
  // 单弦弹奏：s1 ~ s6
  const singleMatch = dir.match(/^s([1-6])$/);
  if (singleMatch) {
    const strNum = +singleMatch[1] as 1|2|3|4|5|6;
    const pos = DEMO_CHORD.find(p => p.stringNum === strNum);
    if (pos) synth.playFret(pos.stringNum, pos.fret, 1.8, when);
    return;
  }
  switch (dir) {
    case 'down':
      synth.strum(DEMO_CHORD, { direction: 'down', duration: 1.2, spread: 0.018, when });
      break;
    case 'up':
      synth.strum(DEMO_HIGH, { direction: 'up', duration: 1.0, spread: 0.015, when });
      break;
    case 'thumb':
      // 拇指弹最低的发声弦（C 和弦是 5 弦）
      const bass = DEMO_CHORD.reduce((a, b) => a.stringNum > b.stringNum ? a : b);
      synth.playFret(bass.stringNum, bass.fret, 1.8, when);
      break;
    case 'pluck':
      // 手指同时拨高音弦（3, 2, 1 弦）
      DEMO_HIGH.forEach(p => synth.playFret(p.stringNum, p.fret, 1.4, when));
      break;
    case 'slap':
      // 拍弦（切音）：发出闷音
      synth.strum(DEMO_CHORD, { direction: 'down', duration: 0.15, spread: 0.005, when });
      break;
    case 'mute':
      break;
  }
}

/* ================ 歌曲和弦谱 ================ */
const SONGS = [
  { title: '🌟 小星星', bpm: 80, beatsPerChord: 4, chords: ['C','C','G','G','Am','Am','G','G','F','F','C','C','G','G','C','C'] },
  { title: '🌿 童年', bpm: 90, beatsPerChord: 4, chords: ['C','Am','F','G','C','Am','Dm','G'] },
  { title: '🌈 彩虹', bpm: 76, beatsPerChord: 4, chords: ['C','G','Am','Em','F','C','F','G'] },
  { title: '🎸 真的爱你', bpm: 120, beatsPerChord: 2, chords: ['C','Am','F','G','C','Am','Dm','G'] },
  { title: '🍃 晴天', bpm: 88, beatsPerChord: 4, chords: ['F','G','Em','Am','F','G','C','C'] },
];

function SongChords() {
  const [songIdx, setSongIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [beat, setBeat] = useState(0);
  const [bigMode, setBigMode] = useState(false);
  const timerRef = useRef<number|null>(null);
  const song = SONGS[songIdx];

  useEffect(() => {
    if (!playing) { if (timerRef.current) clearInterval(timerRef.current); return; }
    let b = 0;
    setCurrentIdx(0); setBeat(0);
    const interval = 60000 / song.bpm;
    const c = CHORDS.find(x => x.id === song.chords[0]);
    if (c) synth.strum(chordPlayablePositions(c.shapes[0]));
    vibrate(20);
    b = 1;
    timerRef.current = window.setInterval(() => {
      const posInChord = b % song.beatsPerChord;
      const chordIdx = Math.floor(b / song.beatsPerChord) % song.chords.length;
      setBeat(posInChord);
      if (posInChord === 0) {
        setCurrentIdx(chordIdx);
        const ch = CHORDS.find(x => x.id === song.chords[chordIdx]);
        if (ch) synth.strum(chordPlayablePositions(ch.shapes[0]));
        vibrate(20);
      } else {
        synth.click(false);
      }
      b++;
    }, interval);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [playing, songIdx]);

  const nextChordName = song.chords[(currentIdx + 1) % song.chords.length];

  return (
    <>
      <div className="field" style={{marginBottom:10}}>
        <label className="field-label">选择歌曲</label>
        <select className="select" value={songIdx} onChange={e => {setSongIdx(+e.target.value);setPlaying(false);setCurrentIdx(0);}}>
          {SONGS.map((s,i) => <option key={i} value={i}>{s.title} (BPM {s.bpm})</option>)}
        </select>
      </div>

      {/* 大字演出模式 */}
      {bigMode ? (
        <div className="card" style={{ textAlign: 'center', padding: '24px 10px', minHeight: 180 }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>{song.title} · BPM {song.bpm}</div>
          <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1, color: playing ? 'var(--primary)' : 'var(--text)', transition: 'color .15s' }}>
            {song.chords[currentIdx]}
          </div>
          <div style={{ fontSize: 24, color: 'var(--text-dim)', marginTop: 8 }}>
            下一个 → {nextChordName}
          </div>
          <div className="beat-dots" style={{ justifyContent: 'center', marginTop: 12 }}>
            {Array.from({ length: song.beatsPerChord }, (_, i) => (
              <div key={i} className={'beat-dot' + (playing && i === beat ? ' on' : '')} />
            ))}
          </div>
        </div>
      ) : (
        <div className="card" style={{textAlign:'center'}}>
          <div style={{fontSize:16,fontWeight:600,marginBottom:8}}>{song.title}</div>
          <div style={{display:'flex',flexWrap:'wrap',gap:6,justifyContent:'center'}}>
            {song.chords.map((id, i) => {
              const isCurrent = i === currentIdx && playing;
              return (
                <span key={i} style={{
                  display:'inline-flex',alignItems:'center',justifyContent:'center',
                  minWidth:44,height:36,borderRadius:8,fontSize:15,fontWeight:700,padding:'0 8px',
                  background: isCurrent ? 'var(--brand)' : 'var(--bg-soft)',
                  color: isCurrent ? '#1f1500' : 'var(--text-strong)',
                  border: '1px solid var(--line-soft)', transition:'all .12s'
                }}>{id}</span>
              );
            })}
          </div>
          <div style={{fontSize:12,color:'var(--text-dim)',marginTop:6}}>BPM {song.bpm} · 每和弦 {song.beatsPerChord} 拍</div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 10 }}>
        <button className={'btn '+(playing?'':'btn-primary')} onClick={async()=>{await synth.unlock();setPlaying(p=>!p);}}>
          {playing?'■ 停止':'▶ 播放跟弹'}
        </button>
        <button className="btn" onClick={() => setBigMode(b => !b)}>
          {bigMode ? '📋 列表模式' : '🔤 大字模式'}
        </button>
      </div>
      <div className="card" style={{ marginTop: 10 }}><p style={{fontSize:13}}>💡 大字模式适合手机放远处弹唱；列表模式适合预览整首歌的和弦走向。</p></div>
    </>
  );
}

/* ================ CAGED 体系 ================ */
const CAGED_SHAPES: { name: string; label: string; offsets: number[][]; desc: string }[] = [
  { name: 'C', label: 'C 形', offsets: [[-1,0,1,0,2,3]], desc: '以 C 开放和弦为原型，根音在 5 弦。' },
  { name: 'A', label: 'A 形', offsets: [[-1,0,2,2,2,0]], desc: '以 A 开放和弦为原型，根音在 5 弦。横按后上移。' },
  { name: 'G', label: 'G 形', offsets: [[0,2,3,2,0,0]], desc: '以 G 开放和弦为原型，根音在 6 弦。指型较大。' },
  { name: 'E', label: 'E 形', offsets: [[0,2,2,1,0,0]], desc: '以 E 开放和弦为原型，根音在 6 弦。F 横按就是 E 形。' },
  { name: 'D', label: 'D 形', offsets: [[-1,-1,0,2,3,2]], desc: '以 D 开放和弦为原型，根音在 4 弦。高把位常用。' },
];

function CAGEDSystem() {
  const [rootPc, setRootPc] = useState(0);
  const [shapeIdx, setShapeIdx] = useState(0);
  const shape = CAGED_SHAPES[shapeIdx];

  // 高亮属于该和弦的音（根音+大三度+纯五度）
  const chordPcs = useMemo(() => {
    return [rootPc, (rootPc+4)%12, (rootPc+7)%12];
  }, [rootPc]);

  const highlight = useMemo(() => {
    const colors: Record<number,string> = {};
    chordPcs.forEach((pc,i) => { colors[pc] = i===0?'#ef4444':i===1?'#f59e0b':'#06b6d4'; });
    return { pcColors: colors, rootPc, onlyPcs: chordPcs };
  }, [chordPcs, rootPc]);

  return (
    <>
      <div className="row" style={{marginBottom:10}}>
        <div className="field">
          <label className="field-label">根音</label>
          <select className="select" value={rootPc} onChange={e=>setRootPc(+e.target.value)}>
            {ALL_ROOTS.map(r=>(<option key={r.pc} value={r.pc}>{r.sharp}</option>))}
          </select>
        </div>
      </div>
      <div className="chip-row" style={{marginBottom:10}}>
        {CAGED_SHAPES.map((s,i) => (
          <button key={s.name} className={'chip'+(i===shapeIdx?' active':'')} onClick={()=>setShapeIdx(i)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="card">
        <h2>{pcToName(rootPc)} 大三和弦 — {shape.label}</h2>
        <p>{shape.desc}</p>
        <p style={{fontSize:13,color:'var(--text-dim)'}}>🔴 根音({pcToName(rootPc)}) 🟡 三度({pcToName((rootPc+4)%12)}) 🔵 五度({pcToName((rootPc+7)%12)})</p>
      </div>
      <div className="fretboard-wrap">
        <Fretboard fromFret={0} toFret={15} highlight={highlight} labelMode="degree" />
      </div>
      <div className="card" style={{marginTop:10}}>
        <p style={{fontSize:13}}><b>CAGED 体系</b>：C-A-G-E-D 五种开放和弦形状，通过移动到不同品位可以覆盖整个指板上的同一个和弦。掌握后你能在任意把位找到任何和弦。</p>
        <p style={{fontSize:13}}>切换不同形状观察：同一个根音的和弦音（1-3-5）在指板上的不同位置。</p>
      </div>
    </>
  );
}

/* ================ 听音测验 ================ */
function ListeningQuiz() {
  const [target, setTarget] = useState(() => Math.floor(Math.random() * 12));
  const [answered, setAnswered] = useState<{ pc: number; correct: boolean } | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const startRef = useRef(Date.now());

  const playTarget = async () => { await synth.unlock(); synth.playFret(4, ((target-2)%12+12)%12, 2.0); };
  const choose = (pc: number) => {
    const correct = pc === target;
    setAnswered({ pc, correct });
    setScore(s => ({ right: s.right + (correct ? 1 : 0), total: s.total + 1 }));
    if (correct) vibrate(15); else vibratePattern([30,50,30]);
  };
  const next = () => { setAnswered(null); let n = target; while (n === target) n = Math.floor(Math.random() * 12); setTarget(n); };

  // 记录成绩
  useEffect(() => {
    return () => {
      if (score.total > 0) {
        recordSession('ear-quiz', score.right, score.total, Math.round((Date.now() - startRef.current) / 1000));
      }
    };
  }, []);

  return (
    <div className="card">
      <h2>👂 听音辨认</h2>
      <p>点击“播放”听一个音，选出它的音名。</p>
      <div className="btn-row" style={{ justifyContent: 'center', marginTop: 6 }}>
        <button className="btn btn-primary" onClick={playTarget}>▶ 播放</button>
        <button className="btn" onClick={next}>↻ 换一题</button>
      </div>
      <div className="chip-row" style={{ marginTop: 12, justifyContent: 'center' }}>
        {ALL_ROOTS.map(r => {
          const isChosen = answered?.pc === r.pc;
          const isRight = answered?.correct && isChosen;
          const isWrong = answered && !answered.correct && isChosen;
          const mod = isRight ? ' active' : isWrong ? ' wrong' : '';
          return (
            <button key={r.pc} className={'chip' + mod}
              onClick={() => !answered && choose(r.pc)} disabled={!!answered}>{r.sharp}</button>
          );
        })}
      </div>
      {answered && (
        <div className={'quiz-feedback ' + (answered.correct ? 'right' : 'wrong')}>
          {answered.correct ? `正确！${pcToName(target)}` : `正确答案：${pcToName(target)}`}
          <div style={{ marginTop: 8 }}><button className="btn btn-primary btn-sm" onClick={next}>下一题 →</button></div>
        </div>
      )}
      <div style={{ marginTop: 8, textAlign: 'center', fontSize: 13, color: 'var(--text-dim)' }}>得分：<b>{score.right}</b> / {score.total}</div>
    </div>
  );
}

/* ================ 练习记录 ================ */
function StatsView() {
  const today = getTodayStats();
  const recent = getRecentDays(14);
  return (
    <>
      <div className="card">
        <h2>📊 今日练习</h2>
        <div style={{display:'flex',gap:20,justifyContent:'center',margin:'10px 0'}}>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:28,fontWeight:700,color:'var(--primary)'}}>{Math.floor(today.totalSeconds/60)}</div>
            <div style={{fontSize:12,color:'var(--text-dim)'}}>分钟</div>
          </div>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:28,fontWeight:700,color:'var(--green)'}}>{today.totalRight}</div>
            <div style={{fontSize:12,color:'var(--text-dim)'}}>答对</div>
          </div>
          <div style={{textAlign:'center'}}>
            <div style={{fontSize:28,fontWeight:700,color:'var(--accent)'}}>{today.totalQuestions}</div>
            <div style={{fontSize:12,color:'var(--text-dim)'}}>总题数</div>
          </div>
        </div>
      </div>
      <div className="section-title">最近 14 天</div>
      <div className="card">
        {recent.length === 0 ? <p style={{textAlign:'center',color:'var(--text-dim)'}}>暂无记录，去练习吧！</p> : (
          <div style={{display:'flex',alignItems:'flex-end',gap:4,height:80}}>
            {recent.map(r => {
              const mins = Math.round(r.totalSeconds / 60);
              const h = Math.max(4, Math.min(72, mins * 3));
              return (
                <div key={r.date} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:2}}>
                  <div style={{width:'100%',height:h,borderRadius:3,background:'var(--primary)',minWidth:8}} title={`${r.date}: ${mins}分钟`} />
                  <span style={{fontSize:8,color:'var(--text-dim)'}}>{r.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

/* ================ 五度圈练习 ================ */
const FIFTHS_MAJOR = ['C','G','D','A','E','B','F#/Gb','Db','Ab','Eb','Bb','F'];
const FIFTHS_MINOR = ['Am','Em','Bm','F#m','C#m','G#m','D#m/Ebm','Bbm','Fm','Cm','Gm','Dm'];
const FIFTHS_KEYSIGS = [0,1,2,3,4,5,6,-5,-4,-3,-2,-1];

type FifthsMode = 'next5th' | 'prev4th' | 'relative' | 'keysig' | 'speed';

function FifthsQuiz() {
  const [mode, setMode] = useState<FifthsMode>('next5th');
  const [target, setTarget] = useState(() => Math.floor(Math.random() * 12));
  const [answered, setAnswered] = useState<{ answer: string; correct: boolean } | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });

  // 速答挑战
  const [speedRunning, setSpeedRunning] = useState(false);
  const [speedStep, setSpeedStep] = useState(0);
  const [speedTimer, setSpeedTimer] = useState(0);
  const speedRef = useRef<number | null>(null);
  const startRef = useRef(0);

  const question = useMemo(() => {
    switch (mode) {
      case 'next5th': return { prompt: `${FIFTHS_MAJOR[target]} 的上方纯五度？`, answer: FIFTHS_MAJOR[(target + 1) % 12] };
      case 'prev4th': return { prompt: `${FIFTHS_MAJOR[target]} 的下方纯四度（=上方五度）？`, answer: FIFTHS_MAJOR[(target + 1) % 12] };
      case 'relative': return { prompt: `${FIFTHS_MAJOR[target]} 大调的关系小调？`, answer: FIFTHS_MINOR[target] };
      case 'keysig': {
        const n = FIFTHS_KEYSIGS[target];
        const sig = n === 0 ? '无升降号' : n > 0 ? `${n} 个升号` : `${Math.abs(n)} 个降号`;
        return { prompt: `${sig} 对应什么大调？`, answer: FIFTHS_MAJOR[target] };
      }
      default: return { prompt: '', answer: '' };
    }
  }, [mode, target]);

  const options = useMemo(() => {
    const set = new Set<number>([target]);
    while (set.size < 6) set.add(Math.floor(Math.random() * 12));
    return [...set].sort(() => Math.random() - 0.5).map(idx => {
      switch (mode) {
        case 'next5th': case 'prev4th': return FIFTHS_MAJOR[(idx + 1) % 12];
        case 'relative': return FIFTHS_MINOR[idx];
        case 'keysig': return FIFTHS_MAJOR[idx];
        default: return '';
      }
    });
  }, [mode, target]);

  const next = () => {
    setAnswered(null);
    let n = target; while (n === target) n = Math.floor(Math.random() * 12);
    setTarget(n);
  };

  const choose = (ans: string) => {
    if (answered) return;
    const correct = ans === question.answer;
    setAnswered({ answer: ans, correct });
    setScore(s => ({ right: s.right + (correct ? 1 : 0), total: s.total + 1 }));
    if (correct) vibrate(15); else vibratePattern([30, 50, 30]);
  };

  // === 速答挑战：沿五度圈顺序报出 12 个调名 ===
  const startSpeed = () => {
    setSpeedRunning(true);
    setSpeedStep(0);
    startRef.current = Date.now();
    setSpeedTimer(0);
    speedRef.current = window.setInterval(() => {
      setSpeedTimer(Math.floor((Date.now() - startRef.current) / 100) / 10);
    }, 100);
  };

  const speedAnswer = (idx: number) => {
    if (idx === speedStep) {
      vibrate(10);
      if (speedStep >= 11) {
        // 完成！
        if (speedRef.current) clearInterval(speedRef.current);
        setSpeedRunning(false);
        const secs = Math.round((Date.now() - startRef.current) / 1000);
        recordSession('fifths-speed', 12, 12, secs);
      } else {
        setSpeedStep(s => s + 1);
      }
    } else {
      vibratePattern([30, 50, 30]);
    }
  };

  useEffect(() => () => { if (speedRef.current) clearInterval(speedRef.current); }, []);

  return (
    <>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        {([
          ['next5th', '上方五度'], ['prev4th', '下方四度'],
          ['relative', '关系小调'], ['keysig', '调号辨认'], ['speed', '速答挑战'],
        ] as [FifthsMode, string][]).map(([k, l]) => (
          <button key={k} className={'chip' + (mode === k ? ' active' : '')}
            onClick={() => { setMode(k); setAnswered(null); setScore({ right: 0, total: 0 }); setSpeedRunning(false); if (speedRef.current) clearInterval(speedRef.current); }}>
            {l}
          </button>
        ))}
      </div>
      
      <div className="card" style={{ marginBottom: 16, background: 'rgba(245, 158, 11, 0.1)', borderColor: 'var(--primary)' }}>
        <p style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>💡 想要看可视化的五度圈图表学习乐理？</span>
          <Link to="/circle" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>去看看 →</Link>
        </p>
      </div>

      {mode !== 'speed' ? (
        <>
          <div className="quiz-prompt">{question.prompt}</div>
          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>得分：<b>{score.right}</b> / {score.total}</div>
            <button className="btn btn-sm" onClick={next}>换一题 →</button>
          </div>
          <div className="chip-row" style={{ marginTop: 10, justifyContent: 'center' }}>
            {options.map((opt, i) => {
              const isChosen = answered?.answer === opt;
              const isCorrect = answered && opt === question.answer;
              const isWrong = answered && isChosen && !answered.correct;
              const mod = isCorrect ? ' correct' : isWrong ? ' wrong' : '';
              return (
                <button key={`${opt}-${i}`} className={'chip' + mod} style={{ minWidth: 56 }}
                  onClick={() => choose(opt)} disabled={!!answered}>{opt}</button>
              );
            })}
          </div>
          {answered && (
            <div className={'quiz-feedback ' + (answered.correct ? 'right' : 'wrong')}>
              {answered.correct ? `正确！` : `正确答案：${question.answer}`}
              <div style={{ marginTop: 8 }}><button className="btn btn-primary btn-sm" onClick={next}>下一题 →</button></div>
            </div>
          )}
        </>
      ) : (
        /* 速答挑战 */
        <>
          <div className="card" style={{ textAlign: 'center' }}>
            <h2>⭕ 五度圈速答</h2>
            <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
              按顺序点出五度圈上的 12 个大调：C → G → D → … → F → 回到 C
            </p>
            {!speedRunning && speedStep === 0 && (
              <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={startSpeed}>▶ 开始计时</button>
            )}
            {!speedRunning && speedStep > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--green)' }}>{speedTimer}s</div>
                <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>完成！你的用时</div>
                <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={startSpeed}>再来一轮</button>
              </div>
            )}
            {speedRunning && (
              <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--primary)', marginTop: 4 }}>{speedTimer}s</div>
            )}
          </div>

          {speedRunning && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 10 }}>
              {FIFTHS_MAJOR.map((name, idx) => {
                const done = idx < speedStep;
                const current = idx === speedStep;
                return (
                  <button key={name}
                    className="chip"
                    style={{
                      minWidth: 56, fontSize: 15, fontWeight: 700,
                      background: done ? 'var(--green)' : current ? 'var(--bg-soft)' : 'var(--bg-soft)',
                      color: done ? '#fff' : 'var(--text)',
                      borderColor: done ? 'var(--green)' : current ? 'var(--primary)' : 'var(--border)',
                      borderWidth: current ? 2 : 1,
                      opacity: done ? 0.7 : 1,
                    }}
                    disabled={done}
                    onClick={() => speedAnswer(idx)}>
                    {done ? '✓' : name}
                  </button>
                );
              })}
            </div>
          )}

          <div className="card" style={{ marginTop: 12 }}>
            <p style={{ fontSize: 13 }}>💡 目标：<b>10 秒内</b>完成 = 已经内化！20 秒内 = 不错。30 秒以上还需要多练习。</p>
            <p style={{ fontSize: 13 }}>记住口诀：<b>C G D A E B → Gb/F# Db Ab Eb Bb F → 回到 C</b></p>
          </div>
        </>
      )}
    </>
  );
}
