import { useEffect, useMemo, useRef, useState } from 'react';
import { drum, type DrumVoice } from '../audio/drum-machine';
import { synth } from '../audio/synth';
import { bass } from '../audio/bass-synth';
import { recordSession, recordSessionThrottled } from '../utils/progress';
import {
  DRUM_PATTERNS, FILL_IN, SECTION_DEFAULTS, applySection,
  type DrumPattern, type SectionKind,
} from '../audio/drum-patterns';
import { vibrate } from '../utils/haptic';
import {
  loadCustomPatterns, saveCustomPatterns, createEmptyPattern, clonePattern,
  type CustomDrumPattern,
} from '../utils/custom-drums';
import {
  CHORD_PROGRESSIONS, loadCustomProgressions, saveCustomProgressions,
  createEmptyProgression, cloneProgression, chordDisplayName,
  type ChordProgression, type CustomChordProgression,
} from '../audio/chord-progressions';
import {
  CHORD_STRUM_PATTERNS, loadCustomStrumPatterns, saveCustomStrumPatterns,
  createEmptyStrumPattern, cloneStrumPattern,
  type ChordStrumPattern, type CustomChordStrumPattern, type StrumDir,
} from '../audio/chord-strum-patterns';
import {
  BASS_PATTERNS, loadCustomBassPatterns, saveCustomBassPatterns,
  createEmptyBassPattern, cloneBassPattern, bassNoteToMidi,
  type BassPattern, type CustomBassPattern, type BassNote,
} from '../audio/bass-patterns';
import { CHORDS, chordPlayablePositions } from '../theory/chords';

type Mode = 'play-song' | 'lib-drum' | 'lib-chord' | 'lib-strum' | 'lib-bass';

interface SongSection {
  kind: SectionKind;
  bars: number;
  patternId: string;
  fillLast: boolean;
  progressionId?: string;
  strumPatternId?: string;
  bassPatternId?: string;
  playDrum?: boolean;
  playChord?: boolean;
  playBass?: boolean;
}

const DEFAULT_SONG: SongSection[] = [
  { kind: 'intro', bars: 2, patternId: 'rock-basic', fillLast: false, progressionId: 'pop-1564', strumPatternId: 'whole', bassPatternId: 'root-only', playDrum: true, playChord: true, playBass: true },
  { kind: 'verse', bars: 4, patternId: 'rock-basic', fillLast: true, progressionId: 'pop-1564', strumPatternId: 'pop-8', bassPatternId: 'pop-r5', playDrum: true, playChord: true, playBass: true },
  { kind: 'chorus', bars: 4, patternId: 'rock-power', fillLast: true, progressionId: 'pop-6415', strumPatternId: 'ddu-du', bassPatternId: 'rock-eighth', playDrum: true, playChord: true, playBass: true },
  { kind: 'verse', bars: 4, patternId: 'rock-basic', fillLast: true, progressionId: 'pop-1564', strumPatternId: 'pop-8', bassPatternId: 'pop-r5', playDrum: true, playChord: true, playBass: true },
  { kind: 'chorus', bars: 4, patternId: 'rock-power', fillLast: true, progressionId: 'pop-6415', strumPatternId: 'ddu-du', bassPatternId: 'rock-eighth', playDrum: true, playChord: true, playBass: true },
  { kind: 'bridge', bars: 2, patternId: 'funk-basic', fillLast: true, progressionId: 'pop-4536', strumPatternId: 'funk-cut', bassPatternId: 'funk-syncopated', playDrum: true, playChord: true, playBass: true },
  { kind: 'chorus', bars: 4, patternId: 'rock-power', fillLast: true, progressionId: 'pop-6415', strumPatternId: 'ddu-du', bassPatternId: 'rock-eighth', playDrum: true, playChord: true, playBass: true },
  { kind: 'outro', bars: 2, patternId: 'rock-basic', fillLast: false, progressionId: 'pop-1564', strumPatternId: 'whole', bassPatternId: 'root-only', playDrum: true, playChord: true, playBass: true },
];

const VOICE_LABEL: Record<DrumVoice, string> = {
  kick: 'Kick 底鼓', snare: 'Snare 军鼓', hihat: 'HiHat 闭镲', openhat: 'OpenHat 开镲',
  clap: 'Clap 拍手', ride: 'Ride 叮叮镲', crash: 'Crash 大镲', tomL: 'TomL 低嗵', tomM: 'TomM 中嗵', tomH: 'TomH 高嗵',
};

const VOICE_COLOR: Record<DrumVoice, string> = {
  kick: '#ef4444', snare: '#f59e0b', hihat: '#06b6d4', openhat: '#0ea5e9',
  clap: '#f97316', ride: '#8b5cf6', crash: '#a855f7', tomL: '#10b981', tomM: '#22c55e', tomH: '#84cc16',
};

const ALL_VOICES: DrumVoice[] = ['kick','snare','hihat','openhat','clap','ride','crash','tomL','tomM','tomH'];

function scheduleStrumPattern(strumPat: ChordStrumPattern, positions: { stringNum: 1|2|3|4|5|6; fret: number }[], barStart: number, barDur: number) {
  const now = synth.getCurrentTime();
  const beatDur = barDur / strumPat.beatsPerBar;
  const low = positions.filter(p => p.stringNum >= 5);
  const high = positions.filter(p => p.stringNum <= 3);
  const bassPos = positions.length > 0 ? positions.reduce((a, b) => a.stringNum > b.stringNum ? a : b) : null;
  for (const e of strumPat.events) {
    const when = barStart + e.beat * beatDur - now;
    if (when < -0.05) continue;
    const vel = e.vel ?? 1;
    const opts = (dir: 'down' | 'up', dur: number) => ({ direction: dir, duration: dur, spread: 0.020, when });
    switch (e.dir as StrumDir) {
      case 'D': synth.strum(positions, opts('down', 3.5)); break;
      case 'U': if (high.length) synth.strum(high, opts('up', 2.2)); break;
      case 'd': if (low.length) synth.strum(low, opts('down', 3.0)); break;
      case 'u': if (high.length) high.forEach(p => synth.playFret(p.stringNum, p.fret, 1.8 * vel, when)); break;
      case 'B': if (bassPos) synth.playFret(bassPos.stringNum, bassPos.fret, 3.2 * vel, when); break;
      case 'X': synth.strum(positions, { direction: 'down', duration: 0.18, spread: 0.012, when }); break;
    }
  }
}

function scheduleBassPattern(bassPat: BassPattern, chordRootPc: number, isMinor: boolean, barStart: number, barDur: number) {
  const now = bass.getCurrentTime();
  const beatDur = barDur / bassPat.beatsPerBar;
  for (const e of bassPat.events) {
    const when = barStart + e.beat * beatDur - now;
    if (when < -0.05) continue;
    const midi = bassNoteToMidi(chordRootPc, isMinor, e.note as BassNote);
    if (midi == null) continue;
    const dur = (e.dur ?? 1) * beatDur * 0.95;
    bass.playMidi(midi, Math.max(0.2, dur), 0.7 * (e.vel ?? 1), when);
  }
}

function parseChordId(id: string): { rootPc: number; isMinor: boolean } {
  const m = id.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return { rootPc: 0, isMinor: false };
  const noteMap: Record<string, number> = { C:0, 'C#':1, 'Db':1, D:2, 'D#':3, 'Eb':3, E:4, F:5, 'F#':6, 'Gb':6, G:7, 'G#':8, 'Ab':8, A:9, 'A#':10, 'Bb':10, B:11 };
  const rootPc = noteMap[m[1]] ?? 0;
  const isMinor = /^m(?!aj)/.test(m[2]);
  return { rootPc, isMinor };
}

/* ============ 试听结算 helper ============ */
function flushPlaySession(module: 'play-song' | 'play-jam', elapsedSec: number, toastText: string) {
  if (elapsedSec < 10) return;
  if (module === 'play-song') {
    recordSession('play-song', 0, 0, elapsedSec);
  } else {
    recordSessionThrottled('play-jam', 0, 0, elapsedSec, 30);
  }
  try {
    window.dispatchEvent(new CustomEvent('progress-recorded', { detail: { text: toastText } }));
  } catch {
    /* noop */
  }
}

/* ================ 主页 ================ */
type DrumMachineProps = { mode?: Mode };

export default function DrumMachinePage({ mode: propMode }: DrumMachineProps = {}) {
  const mode: Mode = propMode ?? 'play-song';
  const [customs, setCustoms] = useState<CustomDrumPattern[]>(() => loadCustomPatterns());
  const [customProgs, setCustomProgs] = useState<CustomChordProgression[]>(() => loadCustomProgressions());
  const [customStrums, setCustomStrums] = useState<CustomChordStrumPattern[]>(() => loadCustomStrumPatterns());
  const [customBass, setCustomBass] = useState<CustomBassPattern[]>(() => loadCustomBassPatterns());

  const updateCustoms = (n: CustomDrumPattern[]) => { setCustoms(n); saveCustomPatterns(n); };
  const updateProgs = (n: CustomChordProgression[]) => { setCustomProgs(n); saveCustomProgressions(n); };
  const updateStrums = (n: CustomChordStrumPattern[]) => { setCustomStrums(n); saveCustomStrumPatterns(n); };
  const updateBass = (n: CustomBassPattern[]) => { setCustomBass(n); saveCustomBassPatterns(n); };

  const allPatterns = useMemo(() => [...DRUM_PATTERNS, ...customs], [customs]);
  const allProgressions = useMemo(() => [...CHORD_PROGRESSIONS, ...customProgs], [customProgs]);
  const allStrums = useMemo(() => [...CHORD_STRUM_PATTERNS, ...customStrums], [customStrums]);
  const allBass = useMemo(() => [...BASS_PATTERNS, ...customBass], [customBass]);

  return (
    <div>
      <div className="hub-content">
        {mode === 'play-song' && <SongArranger allPatterns={allPatterns} allProgressions={allProgressions} allStrums={allStrums} allBass={allBass} />}
        {mode === 'lib-drum' && <CustomEditor customs={customs} onChange={updateCustoms} />}
        {mode === 'lib-chord' && <ChordProgEditor customs={customProgs} onChange={updateProgs} />}
        {mode === 'lib-strum' && <StrumPatternEditor customs={customStrums} onChange={updateStrums} />}
        {mode === 'lib-bass' && <BassPatternEditor customs={customBass} onChange={updateBass} />}
      </div>
    </div>
  );
}

/* ================ 鼓点网格显示 ================ */
function PatternGrid({ pattern, currentStep }: { pattern: DrumPattern; currentStep: number }) {
  const usedVoices = useMemo(() => { const set = new Set<DrumVoice>(); pattern.grid.forEach(s => s.forEach(v => set.add(v))); return ALL_VOICES.filter(v => set.has(v)); }, [pattern]);
  const stepsPerBeat = pattern.steps === 12 ? 3 : 4;
  return (
    <div style={{ marginTop: 12, overflowX: 'auto' }}>
      <div style={{ display: 'inline-block', minWidth: '100%' }}>
        {usedVoices.map(v => (
          <div key={v} style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
            <div style={{ width: 86, fontSize: 11, color: 'var(--text-dim)', textAlign: 'right', paddingRight: 6 }}>{VOICE_LABEL[v]}</div>
            <div style={{ display: 'flex', gap: 2, flex: 1 }}>
              {pattern.grid.map((cell, i) => {
                const on = cell.includes(v); const isCur = i === currentStep; const isBeat = i % stepsPerBeat === 0;
                return <div key={i} style={{ flex: 1, minWidth: 14, height: 18, borderRadius: 3, background: on ? VOICE_COLOR[v] : 'var(--bg-soft)', opacity: on ? (isCur ? 1 : 0.85) : (isBeat ? 0.5 : 0.25), border: isCur ? '2px solid var(--brand)' : '1px solid var(--border)', boxShadow: isCur ? '0 0 0 2px rgba(245,158,11,0.45)' : 'none', transform: isCur && on ? 'scale(1.08)' : 'scale(1)', transition: 'transform 70ms var(--ease-out), box-shadow 70ms var(--ease-out)' }} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================ 歌曲编排 ================ */
function SongArranger({ allPatterns, allProgressions, allStrums, allBass }: { allPatterns: DrumPattern[]; allProgressions: ChordProgression[]; allStrums: ChordStrumPattern[]; allBass: BassPattern[] }) {
  const [song, setSong] = useState<SongSection[]>(DEFAULT_SONG);
  const [bpm, setBpm] = useState(110);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [chordVol, setChordVol] = useState(0.55);
  const [bassVol, setBassVol] = useState(0.55);
  const [globalDrum, setGlobalDrum] = useState(true);
  const [globalChord, setGlobalChord] = useState(true);
  const [globalBass, setGlobalBass] = useState(true);
  const [curSecIdx, setCurSecIdx] = useState(-1);
  const [curBar, setCurBar] = useState(0);
  const [curStep, setCurStep] = useState(-1);
  const [curChord, setCurChord] = useState<string>('');

  useEffect(() => { drum.setVolume(volume); }, [volume]);
  useEffect(() => { synth.setVolume(chordVol); }, [chordVol]);
  useEffect(() => { bass.setVolume(bassVol); }, [bassVol]);

  const timerRef = useRef<number | null>(null);
  const uiTimerRef = useRef<number | null>(null);
  const uiQueueRef = useRef<{ secIdx: number; bar: number; step: number; time: number; chord?: string }[]>([]);
  const lastUIRef = useRef({ secIdx: -1, bar: -1, step: -1, chord: '' });
  const songRef = useRef(song); // 播放时使用的歌曲快照
  const playingRef = useRef(playing);
  const playStartTsRef = useRef<number>(0);

  // 播放开始时保存快照，编辑不会中断当前播放
  useEffect(() => {
    if (playing && !playingRef.current) {
      songRef.current = song; // 开始播放时保存快照
      playStartTsRef.current = Date.now();
    } else if (!playing && playingRef.current) {
      // playing: true → false 结算
      const elapsed = Math.round((Date.now() - playStartTsRef.current) / 1000);
      flushPlaySession('play-song', elapsed, `🎼 跟伴奏练了 ${elapsed} 秒`);
    }
    playingRef.current = playing;
  }, [playing, song]);

  useEffect(() => {
    if (!playing) { if (timerRef.current) clearTimeout(timerRef.current); if (uiTimerRef.current) cancelAnimationFrame(uiTimerRef.current); setCurSecIdx(-1); setCurBar(0); setCurStep(-1); setCurChord(''); lastUIRef.current = { secIdx: -1, bar: -1, step: -1, chord: '' }; return; }
    const songSnapshot = songRef.current;
    const start = async () => {
      await drum.unlock(); await synth.unlock(); await bass.unlock();
      let nextTime = drum.getCurrentTime() + 0.15;
      let secIdx = 0, bar = 0, stepInBar = 0;
      uiQueueRef.current = [];
      let lastFiredBarKey = '';
      const scheduler = () => {
        while (nextTime < drum.getCurrentTime() + 0.2) {
          if (secIdx >= songSnapshot.length) { setTimeout(() => setPlaying(false), 200); return; }
          const sec = songSnapshot[secIdx];
          const pat = allPatterns.find(p => p.id === sec.patternId) || allPatterns[0];
          const stepsPerBeat = pat.steps === 12 ? 3 : 4;
          const stepDur = 60.0 / bpm / stepsPerBeat;
          const isLastBar = bar === sec.bars - 1;
          const useFill = sec.fillLast && isLastBar && pat.steps === 16;
          const grid = applySection(useFill ? FILL_IN : pat.grid, sec.kind, bar === 0);
          const voices = grid[stepInBar] || [];
          const velMul = sec.kind === 'outro' ? Math.max(0.35, 1 - bar / Math.max(1, sec.bars)) : 1.0;
          if (globalDrum && (sec.playDrum ?? true)) voices.forEach(v => drum.play(v, nextTime, velMul));
          const chordOn = globalChord && (sec.playChord ?? false) && !!sec.progressionId;
          const bassOn = globalBass && (sec.playBass ?? false) && !!sec.progressionId;
          let chordName = '';
          const barKey = `${secIdx}-${bar}`;
          if ((chordOn || bassOn) && sec.progressionId && stepInBar === 0 && barKey !== lastFiredBarKey) {
            lastFiredBarKey = barKey;
            const prog = allProgressions.find(p => p.id === sec.progressionId);
            if (prog && prog.chords.length > 0) {
              const chordIdx = bar % prog.chords.length;
              chordName = prog.chords[chordIdx];
              const { rootPc, isMinor } = parseChordId(chordName);
              if (chordOn) {
                const chordDef = CHORDS.find(c => c.id === chordName);
                if (chordDef && chordDef.shapes[0]) {
                  const positions = chordPlayablePositions(chordDef.shapes[0]);
                  if (useFill) synth.strum(positions, { direction: 'down', duration: 3.0, spread: 0.020 });
                  else { const strumPat = allStrums.find(p => p.id === sec.strumPatternId) || allStrums[0]; scheduleStrumPattern(strumPat, positions, nextTime, 60.0 / bpm * strumPat.beatsPerBar); }
                }
              }
              if (bassOn) {
                const bassPat = allBass.find(p => p.id === sec.bassPatternId) || allBass[0];
                if (bassPat) {
                  const barDur = 60.0 / bpm * bassPat.beatsPerBar;
                  if (useFill) { const midi = bassNoteToMidi(rootPc, isMinor, 'R'); if (midi != null) bass.playMidi(midi, barDur * 0.95, 0.7); }
                  else scheduleBassPattern(bassPat, rootPc, isMinor, nextTime, barDur);
                }
              }
            }
          }
          uiQueueRef.current.push({ secIdx, bar, step: stepInBar, time: nextTime, chord: stepInBar === 0 ? chordName : undefined });
          nextTime += stepDur; stepInBar++;
          if (stepInBar >= pat.steps) { stepInBar = 0; bar++; if (bar >= sec.bars) { bar = 0; secIdx++; } }
        }
        timerRef.current = setTimeout(scheduler, 25);
      };
      const drawUI = () => {
        const now = drum.getCurrentTime(); let last: typeof uiQueueRef.current[number] | null = null;
        while (uiQueueRef.current.length && uiQueueRef.current[0].time <= now) { last = uiQueueRef.current[0]; uiQueueRef.current.shift(); }
        if (last && (last.secIdx !== lastUIRef.current.secIdx || last.bar !== lastUIRef.current.bar || last.step !== lastUIRef.current.step || (last.chord !== undefined && last.chord !== lastUIRef.current.chord))) {
          lastUIRef.current = { secIdx: last.secIdx, bar: last.bar, step: last.step, chord: last.chord ?? lastUIRef.current.chord };
          setCurSecIdx(last.secIdx); setCurBar(last.bar); setCurStep(last.step); if (last.chord !== undefined) setCurChord(last.chord); if (last.step === 0 && last.bar === 0) vibrate(20);
        }
        uiTimerRef.current = requestAnimationFrame(drawUI);
      };
      scheduler(); drawUI();
    };
    start();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); if (uiTimerRef.current) cancelAnimationFrame(uiTimerRef.current); };
  }, [playing, bpm, globalDrum, globalChord, globalBass, allPatterns, allProgressions, allStrums, allBass]);

  // 仅在段落切换时滚动（避免播放时的卡顿）
  const lastScrolledSecRef = useRef(-1);
  useEffect(() => {
    if (curSecIdx >= 0 && curSecIdx !== lastScrolledSecRef.current) {
      lastScrolledSecRef.current = curSecIdx;
      const el = document.querySelector(`[data-sec-idx="${curSecIdx}"][data-is-cur="1"]`);
      if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [curSecIdx]);

  const updateSec = (i: number, patch: Partial<SongSection>) => setSong(s => s.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const removeSec = (i: number) => setSong(s => s.filter((_, idx) => idx !== i));
  const moveSec = (i: number, dir: -1 | 1) => setSong(s => { const j = i + dir; if (j < 0 || j >= s.length) return s; const a = [...s]; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const addSec = (kind: SectionKind) => setSong(s => [...s, { kind, bars: SECTION_DEFAULTS[kind].bars, patternId: allPatterns[0].id, fillLast: kind !== 'intro' && kind !== 'outro', progressionId: allProgressions[0]?.id, strumPatternId: allStrums[0]?.id ?? 'whole', bassPatternId: allBass[0]?.id ?? 'root-only', playDrum: true, playChord: true, playBass: true }]);
  const curSec = curSecIdx >= 0 ? song[curSecIdx] : null;
  const curPattern = curSec ? (allPatterns.find(p => p.id === curSec.patternId) || allPatterns[0]) : null;

  return (
    <>
      {/* 正在演奏卡片 - hero-grad 主品牌 */}
      <div style={{ background: 'var(--hero-grad)', boxShadow: 'var(--brand-ring)', borderRadius: 'var(--radius-md)', padding: 'var(--space-5)', marginBottom: 12 }}>
        {curSec && curPattern ? (
          <>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>正在演奏</div>
            <div style={{ color: 'var(--text-strong)', fontSize: 28, lineHeight: '36px', fontWeight: 800, marginBottom: 4 }}>{SECTION_DEFAULTS[curSec.kind].label}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{curPattern.name} · 第 {curBar + 1}/{curSec.bars} 小节</div>
            {globalChord && curChord && (
              <div style={{ fontSize: 48, fontWeight: 900, color: 'var(--brand-strong)', margin: '8px 0', textShadow: '0 2px 12px rgba(245,158,11,0.25)' }}>
                🎸 {chordDisplayName(curChord)}
              </div>
            )}
            <PatternGrid pattern={curPattern} currentStep={curStep} />
          </>
        ) : null}
      </div>

      {/* 声部控制 - 紧凑布局 */}
      <div style={{ background: 'var(--bg-soft)', borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginBottom: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
            <input type="checkbox" checked={globalDrum} onChange={e => setGlobalDrum(e.target.checked)} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 22 }}>🥁</span>
            <span style={{ fontSize: 11, fontWeight: 600 }}>鼓</span>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
            <input type="checkbox" checked={globalChord} onChange={e => setGlobalChord(e.target.checked)} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 22 }}>🎸</span>
            <span style={{ fontSize: 11, fontWeight: 600 }}>和弦</span>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer' }}>
            <input type="checkbox" checked={globalBass} onChange={e => setGlobalBass(e.target.checked)} style={{ width: 18, height: 18 }} />
            <span style={{ fontSize: 22 }}>🎸</span>
            <span style={{ fontSize: 11, fontWeight: 600 }}>贝斯</span>
          </label>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 300, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 24, textAlign: 'center' }}>🥁</span>
            <input type="range" min={0} max={1} step={0.05} value={volume} disabled={!globalDrum} onChange={e => setVolume(+e.target.value)} style={{ flex: 1, opacity: globalDrum ? 1 : 0.3 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 24, textAlign: 'center' }}>🎸</span>
            <input type="range" min={0} max={1} step={0.05} value={chordVol} disabled={!globalChord} onChange={e => setChordVol(+e.target.value)} style={{ flex: 1, opacity: globalChord ? 1 : 0.3 }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 24, textAlign: 'center' }}>🎸</span>
            <input type="range" min={0} max={1} step={0.05} value={bassVol} disabled={!globalBass} onChange={e => setBassVol(+e.target.value)} style={{ flex: 1, opacity: globalBass ? 1 : 0.3 }} />
          </div>
        </div>
      </div>

      {/* BPM 和播放按钮 */}
      <div style={{ background: 'var(--bg-soft)', borderRadius: 12, padding: 14, marginBottom: 12, textAlign: 'center' }}>
        <div style={{ fontSize: 48, fontWeight: 800, color: 'var(--primary)' }}>{bpm}</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>BPM</div>
        <input type="range" min={40} max={220} value={bpm} onChange={e => setBpm(+e.target.value)} style={{ width: '100%', maxWidth: 280, marginBottom: 10 }} />
        <button 
          style={{ 
            width: '100%', 
            maxWidth: 180, 
            padding: '12px 20px', 
            borderRadius: 10, 
            border: 'none', 
            background: playing ? '#e74c3c' : 'var(--primary)', 
            color: '#fff', 
            fontSize: 15, 
            fontWeight: 700,
            cursor: 'pointer',
          }} 
          onClick={async () => { await drum.unlock(); await synth.unlock(); await bass.unlock(); setPlaying(p => !p); }}>
          {playing ? '■ 停止' : '▶ 播放歌曲'}
        </button>
      </div>

      {/* 歌曲结构 */}
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, paddingLeft: 4 }}>🎵 歌曲结构</div>
      <div style={{ background: 'var(--bg-soft)', borderRadius: 12, padding: 10 }}>
        {song.map((sec, i) => {
          const secDef = SECTION_DEFAULTS[sec.kind];
          const isCur = i === curSecIdx;
          const progress = isCur && sec.bars > 0 ? ((curBar + 1) / sec.bars) * 100 : 0;
          return (
            <div key={i} data-sec-idx={i} data-is-cur={isCur ? '1' : '0'} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 6px 8px 10px', borderLeft: isCur ? `6px solid ${secDef.color}` : `4px solid ${secDef.color}`, marginBottom: 6, background: isCur ? `${secDef.color}22` : 'transparent', borderRadius: 6, boxShadow: isCur ? `0 0 0 2px ${secDef.color}` : 'none', overflow: 'hidden' }}>
              {isCur && <div style={{ position: 'absolute', left: 8, top: 0, bottom: 0, display: 'flex', alignItems: 'center', pointerEvents: 'none', color: secDef.color, fontWeight: 800, fontSize: 18, animation: 'pulse 1s ease-in-out infinite' }}>▶</div>}
              {isCur && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }}><div style={{ width: `${progress}%`, height: '100%', background: secDef.color, transition: 'width .12s linear' }} /></div>}
              <div style={{ paddingLeft: isCur ? 22 : 0, transition: 'padding .18s', display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                  <select value={sec.kind} onChange={e => updateSec(i, { kind: e.target.value as SectionKind })} style={{ flex: '0 0 76px', padding: 4, fontSize: 12, fontWeight: isCur ? 700 : 400, color: isCur ? secDef.color : undefined }} className="select">{(['intro','verse','chorus','bridge','outro'] as SectionKind[]).map(k => <option key={k} value={k}>{SECTION_DEFAULTS[k].label}</option>)}</select>
                  <select value={sec.patternId} onChange={e => updateSec(i, { patternId: e.target.value })} style={{ flex: 1, minWidth: 0, padding: 4, fontSize: 12 }} className="select">{allPatterns.map(p => <option key={p.id} value={p.id}>{(p as CustomDrumPattern).custom ? '⭐ ' : ''}{p.name}</option>)}</select>
                  <input type="number" min={1} max={16} value={sec.bars} onChange={e => updateSec(i, { bars: Math.max(1, Math.min(16, +e.target.value || 1)) })} style={{ width: 48, padding: 4, fontSize: 12, textAlign: 'center' }} className="select" />
                  <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 2, color: 'var(--text-dim)' }}><input type="checkbox" checked={sec.fillLast} onChange={e => updateSec(i, { fillLast: e.target.checked })} />加花</label>
                  <button className="btn btn-sm" onClick={() => moveSec(i, -1)} disabled={i === 0}>↑</button>
                  <button className="btn btn-sm" onClick={() => moveSec(i, 1)} disabled={i === song.length - 1}>↓</button>
                  <button className="btn btn-sm" onClick={() => removeSec(i)} style={{ color: 'var(--danger)' }}>✕</button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-dim)' }}><input type="checkbox" checked={sec.playDrum ?? true} onChange={e => updateSec(i, { playDrum: e.target.checked })} />🥁</label>
                  <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-dim)' }}><input type="checkbox" checked={sec.playChord ?? false} onChange={e => updateSec(i, { playChord: e.target.checked })} />🎸</label>
                  <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3, color: 'var(--text-dim)' }}><input type="checkbox" checked={sec.playBass ?? false} onChange={e => updateSec(i, { playBass: e.target.checked })} />🎸</label>
                  <select value={sec.progressionId ?? ''} onChange={e => updateSec(i, { progressionId: e.target.value || undefined })} style={{ padding: 2, fontSize: 10, height: 26 }} className="select" title="和弦走向"><option value="">🎵 和弦走向</option>{allProgressions.map(p => <option key={p.id} value={p.id}>🎵 {(p as CustomChordProgression).custom ? '⭐ ' : ''}{p.name}</option>)}</select>
                  <select value={sec.strumPatternId ?? 'whole'} onChange={e => updateSec(i, { strumPatternId: e.target.value })} style={{ flex: 1, minWidth: 90, padding: 3, fontSize: 11, height: 28 }} className="select" title="吉他节奏">{allStrums.map(p => <option key={p.id} value={p.id}>🎸 {(p as CustomChordStrumPattern).custom ? '⭐ ' : ''}{p.name}</option>)}</select>
                  <select value={sec.bassPatternId ?? 'root-only'} onChange={e => updateSec(i, { bassPatternId: e.target.value })} style={{ flex: 1, minWidth: 90, padding: 3, fontSize: 11, height: 28 }} className="select" title="贝斯节奏">{allBass.map(p => <option key={p.id} value={p.id}>🎸 {(p as CustomBassPattern).custom ? '⭐ ' : ''}{p.name}</option>)}</select>
                </div>
              </div>
            </div>
          );
        })}
        <div className="chip-row" style={{ marginTop: 8, justifyContent: 'center' }}>{(['intro','verse','chorus','bridge','outro'] as SectionKind[]).map(k => <button key={k} className="chip" onClick={() => addSec(k)}>+ {SECTION_DEFAULTS[k].label}</button>)}</div>
      </div>
      <div className="card"><p style={{ fontSize: 13 }}>💡 每段选择：🥁鼓机节奏 + 🎵和弦走向 + 🎸吉他节奏 + 🎸贝斯节奏，勾选决定播放哪些声部。</p></div>
    </>
  );
}

/* ================ 鼓机节奏编辑器 ================ */
function CustomEditor({ customs, onChange }: { customs: CustomDrumPattern[]; onChange: (next: CustomDrumPattern[]) => void }) {
  const [editingId, setEditingId] = useState<string | null>(customs[0]?.id ?? null);
  const editing = customs.find(c => c.id === editingId) || null;
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [bpm, setBpm] = useState(100);

  const playStartTsRef = useRef(0);
  const playingRef = useRef(playing);
  useEffect(() => {
    if (playing && !playingRef.current) {
      playStartTsRef.current = Date.now();
    } else if (!playing && playingRef.current) {
      const elapsed = Math.round((Date.now() - playStartTsRef.current) / 1000);
      flushPlaySession('play-jam', elapsed, '🎵 试听记录已保存');
    }
    playingRef.current = playing;
  }, [playing]);

  const updateEditing = (patch: Partial<CustomDrumPattern>) => { if (!editing) return; onChange(customs.map(c => c.id === editing.id ? { ...c, ...patch } as CustomDrumPattern : c)); };
  const addNew = (steps: 16 | 12) => { const p = createEmptyPattern(steps); onChange([...customs, p]); setEditingId(p.id); };
  const cloneFrom = (src: DrumPattern) => { const p = clonePattern(src); onChange([...customs, p]); setEditingId(p.id); };
  const loadFrom = (src: DrumPattern) => { if (!editing) return; updateEditing({ grid: src.grid.map(row => [...row]), name: editing.name || src.name + ' 副本' }); };
  const remove = (id: string) => { if (!confirm('删除？')) return; const next = customs.filter(c => c.id !== id); onChange(next); setEditingId(next[0]?.id ?? null); };

  // 按类别分组预设
  const presetCategories = useMemo(() => {
    const map = new Map<string, DrumPattern[]>();
    DRUM_PATTERNS.forEach(p => { if (!map.has(p.category)) map.set(p.category, []); map.get(p.category)!.push(p); });
    return Array.from(map.entries());
  }, []);

  // 播放逻辑
  const stepRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !editing) { if (timerRef.current) clearTimeout(timerRef.current); setCurrentStep(-1); return; }
    const stepsPerBeat = editing.steps === 12 ? 3 : 4;
    const stepDur = 60.0 / bpm / stepsPerBeat;
    const play = async () => {
      await drum.unlock();
      stepRef.current = 0;
      const tick = () => {
        const i = stepRef.current % editing.steps;
        editing.grid[i].forEach(v => drum.play(v));
        setCurrentStep(i);
        stepRef.current++;
        timerRef.current = setTimeout(tick, stepDur * 1000);
      };
      tick();
    };
    play();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, bpm, editing]);

  return (
    <>
      {/* 预设库 */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🎯 预设库 <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: 11 }}>点击试听，长按克隆/应用</span></div>
        {presetCategories.map(([cat, list]) => (
          <div key={cat} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>{cat}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {list.map(p => (
                <button key={p.id} className="chip" style={{ position: 'relative', paddingRight: 24 }}
                  onClick={async () => {
                    await drum.unlock();
                    for (let i = 0; i < p.steps; i++) {
                      setTimeout(() => { p.grid[i].forEach(v => drum.play(v)); }, i * (60 / bpm / (p.steps === 12 ? 3 : 4)) * 1000);
                    }
                  }}
                  onContextMenu={e => { e.preventDefault(); cloneFrom(p); }}
                >
                  {p.name}
                  <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: 10, opacity: 0.6 }}>▶</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>💡 点击试听 · 右键克隆 · {editing && '选中后双击应用'}</div>
      </div>

      {/* 我的自定义 */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>📝 我的鼓机节奏</div>
        {customs.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>暂无自定义，从上方预设「克隆」或点击下方新建</div>}
        <div className="chip-row">{customs.map(c => <button key={c.id} className={'chip' + (editingId === c.id ? ' active' : '')} onClick={() => setEditingId(c.id)}>{c.name}</button>)}</div>
        <div className="chip-row" style={{ marginTop: 8 }}>
          <button className="chip" onClick={() => addNew(16)}>+ 新建 16步</button>
          <button className="chip" onClick={() => addNew(12)}>+ 新建 12步</button>
        </div>
      </div>

      {/* 编辑区域 */}
      {editing && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input type="text" value={editing.name} onChange={e => updateEditing({ name: e.target.value })} placeholder="输入名称" style={{ flex: 1, fontWeight: 700, fontSize: 14 }} className="select" />
            <button className="btn btn-sm" onClick={() => remove(editing.id)} style={{ color: 'var(--danger)' }}>删除</button>
          </div>

          {/* 试听控制 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 10px', background: 'var(--bg-soft)', borderRadius: 6 }}>
            <button className={'btn btn-sm ' + (playing ? '' : 'btn-primary')} onClick={async () => { await drum.unlock(); setPlaying(p => !p); }}>
              {playing ? '■ 停止' : '▶ 试听'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>BPM</span>
            <input type="range" min={60} max={180} value={bpm} onChange={e => setBpm(+e.target.value)} style={{ width: 80 }} />
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 32 }}>{bpm}</span>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>{editing.steps} 步 · 点击格子切换鼓件</div>
          {ALL_VOICES.map(v => (
            <div key={v} style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
              <div style={{ width: 80, fontSize: 10, color: 'var(--text-dim)', textAlign: 'right', paddingRight: 4 }}>{VOICE_LABEL[v]}</div>
              <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                {editing.grid.map((cell, i) => {
                  const on = cell.includes(v);
                  const isCur = i === currentStep;
                  return <button key={i} style={{ flex: 1, minWidth: 16, height: 22, borderRadius: 3, background: on ? VOICE_COLOR[v] : 'var(--bg-soft)', opacity: on ? 0.9 : 0.3, border: isCur ? '2px solid var(--primary)' : '1px solid var(--border)', cursor: 'pointer', padding: 0, transform: isCur ? 'scale(1.1)' : 'scale(1)', transition: 'all 0.05s' }} onClick={() => { const newGrid = editing.grid.map((c, idx) => idx === i ? (c.includes(v) ? c.filter(x => x !== v) : [...c, v]) : c); updateEditing({ grid: newGrid }); }} />;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ================ 和弦走向编辑器 ================ */
function ChordProgEditor({ customs, onChange }: { customs: CustomChordProgression[]; onChange: (next: CustomChordProgression[]) => void }) {
  const [editingId, setEditingId] = useState<string | null>(customs[0]?.id ?? null);
  const editing = customs.find(c => c.id === editingId) || null;
  const [playing, setPlaying] = useState(false);
  const [curIdx, setCurIdx] = useState(-1);
  const [bpm, setBpm] = useState(90);

  const playStartTsRef = useRef(0);
  const playingRef = useRef(playing);
  useEffect(() => {
    if (playing && !playingRef.current) {
      playStartTsRef.current = Date.now();
    } else if (!playing && playingRef.current) {
      const elapsed = Math.round((Date.now() - playStartTsRef.current) / 1000);
      flushPlaySession('play-jam', elapsed, '🎵 试听记录已保存');
    }
    playingRef.current = playing;
  }, [playing]);

  const updateEditing = (patch: Partial<CustomChordProgression>) => { if (!editing) return; onChange(customs.map(c => c.id === editing.id ? { ...c, ...patch } as CustomChordProgression : c)); };
  const addNew = () => { const p = createEmptyProgression(); onChange([...customs, p]); setEditingId(p.id); };
  const cloneFrom = (src: ChordProgression) => { const p = cloneProgression(src); onChange([...customs, p]); setEditingId(p.id); };
  const loadFrom = (src: ChordProgression) => { if (!editing) return; updateEditing({ chords: [...src.chords], name: editing.name || src.name + ' 副本' }); };
  const remove = (id: string) => { if (!confirm('删除？')) return; const next = customs.filter(c => c.id !== id); onChange(next); setEditingId(next[0]?.id ?? null); };

  // 播放逻辑
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !editing || editing.chords.length === 0) { if (timerRef.current) clearTimeout(timerRef.current); setCurIdx(-1); return; }
    const barDur = 60.0 / bpm * 4;
    let idx = 0;
    const play = async () => {
      await synth.unlock();
      const chordId = editing.chords[idx % editing.chords.length];
      const chordDef = CHORDS.find(c => c.id === chordId);
      if (chordDef && chordDef.shapes[0]) synth.strum(chordPlayablePositions(chordDef.shapes[0]), { direction: 'down', duration: barDur * 0.9, spread: 0.025 });
      setCurIdx(idx % editing.chords.length);
      idx++;
      timerRef.current = setTimeout(play, barDur * 1000);
    };
    play();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, bpm, editing]);

  return (
    <>
      {/* 预设库 */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🎯 预设库 <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: 11 }}>点击试听，右键克隆</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {CHORD_PROGRESSIONS.map(p => (
            <button key={p.id} className="chip" style={{ position: 'relative', paddingRight: 24 }}
              onClick={async () => {
                await synth.unlock();
                const barDur = 60 / 90 * 4;
                for (let i = 0; i < p.chords.length; i++) {
                  const chordDef = CHORDS.find(c => c.id === p.chords[i]);
                  if (chordDef && chordDef.shapes[0]) {
                    setTimeout(() => synth.strum(chordPlayablePositions(chordDef.shapes[0]), { direction: 'down', duration: barDur * 0.9, spread: 0.025 }), i * barDur * 1000);
                  }
                }
              }}
              onContextMenu={e => { e.preventDefault(); cloneFrom(p); }}>
              {p.name} ({p.chords.map(chordDisplayName).join('-')})
              <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: 10, opacity: 0.6 }}>▶</span>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>💡 点击试听 · 右键克隆 · {editing && '选中后双击应用'}</div>
      </div>

      {/* 我的自定义 */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>📝 我的和弦走向</div>
        {customs.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>暂无自定义，从上方预设「克隆」或点击下方新建</div>}
        <div className="chip-row">{customs.map(c => <button key={c.id} className={'chip' + (editingId === c.id ? ' active' : '')} onClick={() => setEditingId(c.id)}>{c.name}</button>)}</div>
        <div className="chip-row" style={{ marginTop: 8 }}><button className="chip" onClick={addNew}>+ 新建</button></div>
      </div>

      {/* 编辑区域 */}
      {editing && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input type="text" value={editing.name} onChange={e => updateEditing({ name: e.target.value })} placeholder="输入名称" style={{ flex: 1, fontWeight: 700, fontSize: 14 }} className="select" />
            <button className="btn btn-sm" onClick={() => remove(editing.id)} style={{ color: 'var(--danger)' }}>删除</button>
          </div>

          {/* 试听控制 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 10px', background: 'var(--bg-soft)', borderRadius: 6 }}>
            <button className={'btn btn-sm ' + (playing ? '' : 'btn-primary')} onClick={async () => { await synth.unlock(); setPlaying(p => !p); }}>
              {playing ? '■ 停止' : '▶ 试听'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>BPM</span>
            <input type="range" min={60} max={140} value={bpm} onChange={e => setBpm(+e.target.value)} style={{ width: 80 }} />
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 32 }}>{bpm}</span>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>点击选择和弦，支持拖拽排序</div>
          
          {/* 和弦类型分组选择器 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {/* 基础和弦：大三、小三 */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 60 }}>大三/小三:</span>
              {['C','D','E','F','G','A','B'].map(root => (
                <div key={root} style={{ display: 'flex', gap: 2 }}>
                  <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 5px', minWidth: 26 }} onClick={() => updateEditing({ chords: [...editing.chords, root] })}>{root}</button>
                  <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 5px', minWidth: 26 }} onClick={() => updateEditing({ chords: [...editing.chords, root + 'm'] })}>{root}m</button>
                </div>
              ))}
            </div>
            {/* 七和弦 */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 60 }}>七和弦:</span>
              {['C7','D7','E7','F7','G7','A7','B7','Am7','Dm7','Em7','Cmaj7','Gmaj7','Amaj7','Dmaj7','Fmaj7'].map(ch => (
                <button key={ch} className="btn btn-sm" style={{ fontSize: 10, padding: '2px 5px' }} onClick={() => updateEditing({ chords: [...editing.chords, ch] })}>{ch}</button>
              ))}
            </div>
            {/* 挂留、减、增和弦 */}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: 'var(--text-dim)', width: 60 }}>挂留/减/增:</span>
              {['Dsus2','Dsus4','Asus2','Asus4','Esus4','Csus2','Csus4','Gsus4','Adim','Bdim','Caug','Aaug'].map(ch => (
                <button key={ch} className="btn btn-sm" style={{ fontSize: 10, padding: '2px 5px' }} onClick={() => updateEditing({ chords: [...editing.chords, ch] })}>{ch}</button>
              ))}
            </div>
          </div>
          
          {/* 当前和弦序列 */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '10px 8px', background: 'var(--bg-soft)', borderRadius: 6, minHeight: 50 }}>
            {editing.chords.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>点击上方添加和弦...</div>}
            {editing.chords.map((ch, i) => {
              const chordDef = CHORDS.find(c => c.id === ch);
              return (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 10px', background: curIdx === i ? 'var(--primary)' : 'var(--bg)', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', transition: 'all 0.15s' }}
                  onClick={() => {
                    const chordList = CHORDS.filter(c => c.id.startsWith(ch[0]));
                    const next = chordList[(chordList.findIndex(c => c.id === ch) + 1) % chordList.length]?.id ?? ch;
                    const c = [...editing.chords]; c[i] = next; updateEditing({ chords: c });
                  }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: curIdx === i ? '#fff' : 'var(--text)' }}>{chordDisplayName(ch)}</div>
                  <div style={{ fontSize: 9, color: curIdx === i ? 'rgba(255,255,255,0.7)' : 'var(--text-dim)' }}>{chordDef?.category ?? ''}</div>
                  {editing.chords.length > 1 && (
                    <button style={{ fontSize: 9, color: 'var(--danger)', marginTop: 2, background: 'none', border: 'none', cursor: 'pointer' }} onClick={e => { e.stopPropagation(); updateEditing({ chords: editing.chords.filter((_, j) => j !== i) }); }}>✕</button>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--primary)', fontWeight: 600, textAlign: 'center' }}>
            {editing.chords.length > 0 && `预览：${editing.chords.map(chordDisplayName).join(' → ')}`}
          </div>
        </div>
      )}
    </>
  );
}

/* ================ 吉他节奏编辑器 ================ */
function StrumPatternEditor({ customs, onChange }: { customs: CustomChordStrumPattern[]; onChange: (next: CustomChordStrumPattern[]) => void }) {
  const [editingId, setEditingId] = useState<string | null>(customs[0]?.id ?? null);
  const editing = customs.find(c => c.id === editingId) || null;
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1); // 当前播放的时间步（用于高亮整列）
  const [bpm, setBpm] = useState(90);
  const [previewChord, setPreviewChord] = useState('C');

  const playStartTsRef = useRef(0);
  const playingRef = useRef(playing);
  useEffect(() => {
    if (playing && !playingRef.current) {
      playStartTsRef.current = Date.now();
    } else if (!playing && playingRef.current) {
      const elapsed = Math.round((Date.now() - playStartTsRef.current) / 1000);
      flushPlaySession('play-jam', elapsed, '🎵 试听记录已保存');
    }
    playingRef.current = playing;
  }, [playing]);

  const updateEditing = (patch: Partial<CustomChordStrumPattern>) => { if (!editing) return; onChange(customs.map(c => c.id === editing.id ? { ...c, ...patch } as CustomChordStrumPattern : c)); };
  const addNew = (beatsPerBar: 3 | 4 = 4) => { const p = createEmptyStrumPattern(beatsPerBar); onChange([...customs, p]); setEditingId(p.id); };
  const cloneFrom = (src: ChordStrumPattern) => { const p = cloneStrumPattern(src); onChange([...customs, p]); setEditingId(p.id); };
  const loadFrom = (src: ChordStrumPattern) => { if (!editing) return; updateEditing({ events: src.events.map(e => ({ ...e })), beatsPerBar: src.beatsPerBar, name: editing.name || src.name + ' 副本' }); };
  const remove = (id: string) => { if (!confirm('删除？')) return; const next = customs.filter(c => c.id !== id); onChange(next); setEditingId(next[0]?.id ?? null); };

  const DIRS: { dir: StrumDir; label: string; desc: string }[] = [
    { dir: 'D', label: 'D', desc: '下扫全部' }, { dir: 'U', label: 'U', desc: '上扫高音' },
    { dir: 'd', label: 'd', desc: '下扫低音' }, { dir: 'u', label: 'u', desc: '上扫轻' },
    { dir: 'B', label: 'B', desc: '拇指根音' }, { dir: 'X', label: 'X', desc: '切音' },
    { dir: '·', label: '·', desc: '留空' },
  ];

  // 播放逻辑 - 逐事件播放
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !editing) { if (timerRef.current) clearTimeout(timerRef.current); setCurrentStep(-1); return; }
    
    const totalSteps = editing.beatsPerBar * 4;
    const stepDur = 60.0 / bpm / 4; // 每步的时长
    let step = 0;
    
    const play = async () => {
      await synth.unlock();
      const chordDef = CHORDS.find(c => c.id === previewChord);
      if (!chordDef || !chordDef.shapes[0]) return;
      const positions = chordPlayablePositions(chordDef.shapes[0]);
      
      // 播放这一步上的所有事件
      const beatPos = step / 4;
      const eventsAtStep = editing.events.filter(e => Math.abs(e.beat - beatPos) < 0.1);
      eventsAtStep.forEach(ev => {
        const opts = (dir: 'down' | 'up', dur: number) => ({ direction: dir, duration: dur, spread: 0.020, when: 0 });
        switch (ev.dir as StrumDir) {
          case 'D': synth.strum(positions, opts('down', 3.5)); break;
          case 'U': synth.strum(positions.filter(p => p.stringNum <= 3), opts('up', 2.2)); break;
          case 'd': synth.strum(positions.filter(p => p.stringNum >= 5), opts('down', 3.0)); break;
          case 'u': positions.filter(p => p.stringNum <= 3).forEach(p => synth.playFret(p.stringNum, p.fret, 1.8 * (ev.vel ?? 1), 0)); break;
          case 'B': { const bassPos = positions.reduce((a, b) => a.stringNum > b.stringNum ? a : b); synth.playFret(bassPos.stringNum, bassPos.fret, 3.2 * (ev.vel ?? 1), 0); } break;
          case 'X': synth.strum(positions, { direction: 'down', duration: 0.18, spread: 0.012, when: 0 }); break;
        }
      });
      
      setCurrentStep(step);
      step = (step + 1) % totalSteps;
      
      timerRef.current = setTimeout(play, stepDur * 1000);
    };
    play();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, bpm, editing, previewChord]);

  return (
    <>
      {/* 预设库 */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🎯 预设库 <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: 11 }}>点击试听，右键克隆</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {CHORD_STRUM_PATTERNS.map(p => (
            <button key={p.id} className="chip" style={{ position: 'relative', paddingRight: 24 }}
              onClick={async () => {
                await synth.unlock();
                const chordDef = CHORDS.find(c => c.id === 'C');
                if (chordDef && chordDef.shapes[0]) {
                  scheduleStrumPattern(p, chordPlayablePositions(chordDef.shapes[0]), synth.getCurrentTime(), 60 / 90 * p.beatsPerBar);
                }
              }}
              onContextMenu={e => { e.preventDefault(); cloneFrom(p); }}>
              {p.name} {p.events.map(e => e.dir as string).join('')}
              <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: 10, opacity: 0.6 }}>▶</span>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>💡 点击试听 · 右键克隆 · {editing && '选中后双击应用'}</div>
      </div>

      {/* 我的自定义 */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>📝 我的吉他节奏</div>
        {customs.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>暂无自定义，从上方预设「克隆」或点击下方新建</div>}
        <div className="chip-row">{customs.map(c => <button key={c.id} className={'chip' + (editingId === c.id ? ' active' : '')} onClick={() => setEditingId(c.id)}>{c.name}</button>)}</div>
        <div className="chip-row" style={{ marginTop: 8 }}>
          <button className="chip" onClick={() => addNew(4)}>+ 新建 4/4</button>
          <button className="chip" onClick={() => addNew(3)}>+ 新建 3/4</button>
        </div>
      </div>

      {/* 编辑区域 */}
      {editing && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input type="text" value={editing.name} onChange={e => updateEditing({ name: e.target.value })} placeholder="输入名称" style={{ flex: 1, fontWeight: 700, fontSize: 14 }} className="select" />
            <button className="btn btn-sm" onClick={() => remove(editing.id)} style={{ color: 'var(--danger)' }}>删除</button>
          </div>

          {/* 试听控制 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 10px', background: 'var(--bg-soft)', borderRadius: 6, flexWrap: 'wrap' }}>
            <button className={'btn btn-sm ' + (playing ? '' : 'btn-primary')} onClick={async () => { await synth.unlock(); setPlaying(p => !p); }}>
              {playing ? '■ 停止' : '▶ 试听'}
            </button>
            <select className="select" value={previewChord} onChange={e => setPreviewChord(e.target.value)} style={{ fontSize: 11, padding: '2px 6px', width: 70 }}>
              <optgroup label="大三/小三">
                {CHORDS.filter(c => c.quality === 'major' || c.quality === 'minor').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
              <optgroup label="七和弦">
                {CHORDS.filter(c => c.quality === 'dom7' || c.quality === 'maj7' || c.quality === 'min7').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
              <optgroup label="挂留/减/增">
                {CHORDS.filter(c => c.quality === 'sus' || c.quality === 'dim' || c.quality === 'aug').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            </select>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>BPM</span>
            <input type="range" min={60} max={140} value={bpm} onChange={e => setBpm(+e.target.value)} style={{ width: 80 }} />
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 32 }}>{bpm}</span>
          </div>

          {/* 笔刷说明 */}
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
            点击格子切换：D下扫全 U上扫高 d下扫低 u上扫轻 B根音 X切音 ·留空
          </div>
          
          {/* 网格编辑器 - 和鼓机一样的风格 */}
          {['D','U','d','u','B','X','·'].map(strumType => {
            const STRUM_LABEL: Record<string, string> = { D: 'D 下扫全', U: 'U 上扫高', d: 'd 下扫低', u: 'u 上扫轻', B: 'B 根音', X: 'X 切音', '·': '· 留空' };
            const STRUM_COLOR: Record<string, string> = { D: '#e74c3c', U: '#3498db', d: '#c0392b', u: '#2980b9', B: '#27ae60', X: '#7f8c8d', '·': '#bdc3c7' };
            const totalSteps = editing.beatsPerBar * 4; // 每拍4个细分
            
            return (
              <div key={strumType} style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
                <div style={{ width: 80, fontSize: 10, color: 'var(--text-dim)', textAlign: 'right', paddingRight: 4 }}>{STRUM_LABEL[strumType]}</div>
                <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                  {Array.from({ length: totalSteps }, (_, stepIdx) => {
                    const beatPos = stepIdx / 4; // 转换为拍位
                    const event = editing.events.find(e => Math.abs(e.beat - beatPos) < 0.1 && e.dir === strumType);
                    const isOn = !!event;
                    const isCur = stepIdx === currentStep; // 高亮当前时间步（整列）
                    const isBeat = stepIdx % 4 === 0;
                    
                    return (
                      <button key={stepIdx} style={{
                        flex: 1, minWidth: 16, height: 22, borderRadius: 3,
                        background: isOn ? STRUM_COLOR[strumType] : 'var(--bg-soft)',
                        opacity: isOn ? (isCur ? 1 : 0.9) : (isBeat ? 0.5 : 0.3),
                        border: isCur ? '2px solid var(--primary)' : '1px solid var(--border)',
                        cursor: 'pointer', padding: 0,
                        transform: isCur && isOn ? 'scale(1.1)' : 'scale(1)',
                        transition: 'all 0.05s'
                      }} onClick={() => {
                        if (isOn) {
                          // 移除这个事件
                          updateEditing({ events: editing.events.filter(e => !(Math.abs(e.beat - beatPos) < 0.1 && e.dir === strumType)) });
                        } else {
                          // 添加新事件
                          updateEditing({ events: [...editing.events, { beat: beatPos, dir: strumType as StrumDir, vel: 1 }] });
                        }
                      }} />
                    );
                  })}
                </div>
              </div>
            );
          })}
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
            <div style={{ width: 80, fontSize: 10, color: 'var(--text-dim)', textAlign: 'right', paddingRight: 4 }}>拍位</div>
            <div style={{ display: 'flex', gap: 2, flex: 1 }}>
              {Array.from({ length: editing.beatsPerBar }, (_, beatIdx) => (
                <div key={beatIdx} style={{ flex: 4, textAlign: 'center', fontSize: 10, color: 'var(--text-dim)' }}>{beatIdx + 1}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ================ 贝斯节奏型编辑器 ================ */
function BassPatternEditor({ customs, onChange }: { customs: CustomBassPattern[]; onChange: (next: CustomBassPattern[]) => void }) {
  const [editingId, setEditingId] = useState<string | null>(customs[0]?.id ?? null);
  const editing = customs.find(c => c.id === editingId) || null;
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1); // 当前播放的时间步（用于高亮整列）
  const [bpm, setBpm] = useState(90);
  const [previewChord, setPreviewChord] = useState('C');

  const playStartTsRef = useRef(0);
  const playingRef = useRef(playing);
  useEffect(() => {
    if (playing && !playingRef.current) {
      playStartTsRef.current = Date.now();
    } else if (!playing && playingRef.current) {
      const elapsed = Math.round((Date.now() - playStartTsRef.current) / 1000);
      flushPlaySession('play-jam', elapsed, '🎵 试听记录已保存');
    }
    playingRef.current = playing;
  }, [playing]);

  const updateEditing = (patch: Partial<CustomBassPattern>) => { if (!editing) return; onChange(customs.map(c => c.id === editing.id ? { ...c, ...patch } as CustomBassPattern : c)); };
  const addNew = (beatsPerBar: 3 | 4 = 4) => { const p = createEmptyBassPattern(beatsPerBar); onChange([...customs, p]); setEditingId(p.id); };
  const cloneFrom = (src: BassPattern) => { const p = cloneBassPattern(src); onChange([...customs, p]); setEditingId(p.id); };
  const loadFrom = (src: BassPattern) => { if (!editing) return; updateEditing({ events: src.events.map(e => ({ ...e })), beatsPerBar: src.beatsPerBar, name: editing.name || src.name + ' 副本' }); };
  const remove = (id: string) => { if (!confirm('删除？')) return; const next = customs.filter(c => c.id !== id); onChange(next); setEditingId(next[0]?.id ?? null); };

  const NOTE_LABEL: Record<BassNote, string> = { R: '根', '5': '五', '3': '三', O: '高', L: '低', p5: '经', X: '休' };
  const NOTE_DESC: Record<BassNote, string> = { R: '根音', '5': '五度', '3': '三度', O: '高八度', L: '低八度', p5: '经过音', X: '休止' };

  // 解析和弦ID获取根音和是否小调
  const parseChord = (chordId: string): { rootPc: number; isMinor: boolean } => {
    const match = chordId.match(/^([A-G](?:#|b)?)(m)?/);
    if (!match) return { rootPc: 0, isMinor: false };
    const noteMap: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    let pc = noteMap[match[1][0]] ?? 0;
    if (match[1].includes('#')) pc = (pc + 1) % 12;
    if (match[1].includes('b')) pc = (pc - 1 + 12) % 12;
    return { rootPc: pc, isMinor: !!match[2] };
  };

  // 播放逻辑 - 按时间步播放
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !editing) { if (timerRef.current) clearTimeout(timerRef.current); setCurrentStep(-1); return; }
    
    const totalSteps = editing.beatsPerBar * 4;
    const stepDur = 60.0 / bpm / 4; // 每步的时长
    let step = 0;
    
    const play = async () => {
      await bass.unlock();
      const { rootPc, isMinor } = parseChord(previewChord);
      
      // 播放这一步上的所有事件
      const beatPos = step / 4;
      const eventsAtStep = editing.events.filter(e => Math.abs(e.beat - beatPos) < 0.1);
      eventsAtStep.forEach(ev => {
        const midi = bassNoteToMidi(rootPc, isMinor, ev.note as BassNote);
        if (midi != null) {
          const dur = (ev.dur ?? 1) * stepDur * 4 * 0.95;
          bass.playMidi(midi, Math.max(0.2, dur), 0.7 * (ev.vel ?? 1), 0);
        }
      });
      
      setCurrentStep(step);
      step = (step + 1) % totalSteps;
      
      timerRef.current = setTimeout(play, stepDur * 1000);
    };
    play();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, bpm, editing, previewChord]);

  return (
    <>
      {/* 预设库 */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>🎯 预设库 <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: 11 }}>点击试听，右键克隆</span></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {BASS_PATTERNS.map(p => (
            <button key={p.id} className="chip" style={{ position: 'relative', paddingRight: 24 }}
              onClick={async () => {
                await bass.unlock();
                scheduleBassPattern(p, 0, false, bass.getCurrentTime(), 60 / 90 * p.beatsPerBar);
              }}
              onContextMenu={e => { e.preventDefault(); cloneFrom(p); }}>
              {p.name} {p.events.map(e => NOTE_LABEL[e.note as BassNote]).join('-')}
              <span style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', fontSize: 10, opacity: 0.6 }}>▶</span>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>💡 点击试听 · 右键克隆 · {editing && '选中后双击应用'}</div>
      </div>

      {/* 我的自定义 */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>📝 我的贝斯节奏</div>
        {customs.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>暂无自定义，从上方预设「克隆」或点击下方新建</div>}
        <div className="chip-row">{customs.map(c => <button key={c.id} className={'chip' + (editingId === c.id ? ' active' : '')} onClick={() => setEditingId(c.id)}>{c.name}</button>)}</div>
        <div className="chip-row" style={{ marginTop: 8 }}>
          <button className="chip" onClick={() => addNew(4)}>+ 新建 4/4</button>
          <button className="chip" onClick={() => addNew(3)}>+ 新建 3/4</button>
        </div>
      </div>

      {/* 编辑区域 */}
      {editing && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <input type="text" value={editing.name} onChange={e => updateEditing({ name: e.target.value })} placeholder="输入名称" style={{ flex: 1, fontWeight: 700, fontSize: 14 }} className="select" />
            <button className="btn btn-sm" onClick={() => remove(editing.id)} style={{ color: 'var(--danger)' }}>删除</button>
          </div>

          {/* 试听控制 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '8px 10px', background: 'var(--bg-soft)', borderRadius: 6, flexWrap: 'wrap' }}>
            <button className={'btn btn-sm ' + (playing ? '' : 'btn-primary')} onClick={async () => { await bass.unlock(); setPlaying(p => !p); }}>
              {playing ? '■ 停止' : '▶ 试听'}
            </button>
            <select className="select" value={previewChord} onChange={e => setPreviewChord(e.target.value)} style={{ fontSize: 11, padding: '2px 6px', width: 70 }}>
              <optgroup label="大三/小三">
                {CHORDS.filter(c => c.quality === 'major' || c.quality === 'minor').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
              <optgroup label="七和弦">
                {CHORDS.filter(c => c.quality === 'dom7' || c.quality === 'maj7' || c.quality === 'min7').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
              <optgroup label="挂留/减/增">
                {CHORDS.filter(c => c.quality === 'sus' || c.quality === 'dim' || c.quality === 'aug').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            </select>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>BPM</span>
            <input type="range" min={60} max={140} value={bpm} onChange={e => setBpm(+e.target.value)} style={{ width: 80 }} />
            <span style={{ fontSize: 12, fontWeight: 600, minWidth: 32 }}>{bpm}</span>
          </div>

          {/* 音符说明 */}
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
            点击格子切换：R根音 5五度 3三度 O高八度 L低八度 X休止
          </div>
          
          {/* 网格编辑器 - 和鼓机一样的风格 */}
          {['R','5','3','O','L','X'].map(noteType => {
            const NOTE_LABEL_FULL: Record<string, string> = { R: 'R 根音', '5': '5 五度', '3': '3 三度', O: 'O 高八度', L: 'L 低八度', X: 'X 休止' };
            const NOTE_COLOR: Record<string, string> = { R: '#e74c3c', '5': '#3498db', '3': '#27ae60', O: '#a16207', L: '#8e44ad', X: '#7f8c8d' };
            const totalSteps = editing.beatsPerBar * 4; // 每拍4个细分
            
            return (
              <div key={noteType} style={{ display: 'flex', alignItems: 'center', marginBottom: 3 }}>
                <div style={{ width: 80, fontSize: 10, color: 'var(--text-dim)', textAlign: 'right', paddingRight: 4 }}>{NOTE_LABEL_FULL[noteType]}</div>
                <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                  {Array.from({ length: totalSteps }, (_, stepIdx) => {
                    const beatPos = stepIdx / 4; // 转换为拍位
                    const event = editing.events.find(e => Math.abs(e.beat - beatPos) < 0.1 && e.note === noteType);
                    const isOn = !!event;
                    const isCur = stepIdx === currentStep; // 高亮当前时间步（整列）
                    const isBeat = stepIdx % 4 === 0;
                    
                    return (
                      <button key={stepIdx} style={{
                        flex: 1, minWidth: 16, height: 22, borderRadius: 3,
                        background: isOn ? NOTE_COLOR[noteType] : 'var(--bg-soft)',
                        opacity: isOn ? (isCur ? 1 : 0.9) : (isBeat ? 0.5 : 0.3),
                        border: isCur ? '2px solid var(--primary)' : '1px solid var(--border)',
                        cursor: 'pointer', padding: 0,
                        transform: isCur && isOn ? 'scale(1.1)' : 'scale(1)',
                        transition: 'all 0.05s'
                      }} onClick={() => {
                        if (isOn) {
                          // 移除这个事件
                          updateEditing({ events: editing.events.filter(e => !(Math.abs(e.beat - beatPos) < 0.1 && e.note === noteType)) });
                        } else {
                          // 添加新事件
                          updateEditing({ events: [...editing.events, { beat: beatPos, note: noteType as BassNote, dur: 0.5, vel: 1 }] });
                        }
                      }} />
                    );
                  })}
                </div>
              </div>
            );
          })}
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
            <div style={{ width: 80, fontSize: 10, color: 'var(--text-dim)', textAlign: 'right', paddingRight: 4 }}>拍位</div>
            <div style={{ display: 'flex', gap: 2, flex: 1 }}>
              {Array.from({ length: editing.beatsPerBar }, (_, beatIdx) => (
                <div key={beatIdx} style={{ flex: 4, textAlign: 'center', fontSize: 10, color: 'var(--text-dim)' }}>{beatIdx + 1}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}