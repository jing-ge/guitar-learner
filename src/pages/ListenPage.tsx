/**
 * Round 47: Essentia.js 离线和弦/调性识别
 *
 * 用户流程：
 *   1. 选择录音时长 (10s / 20s / 30s)
 *   2. 点开始 → 录音中显示波形 + dB + 倒计时进度环
 *   3. 录满自动停（也可手动停）→ 进入 analyzing → 出结果
 *   4. 结果：BPM + 调性 + 时间线 + ChordSummaryCard
 *
 * 不再做实时流式识别（旧逻辑在 ListenPage.legacy.tsx 里保留）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MicPermissionState, { type MicPermState } from '../components/MicPermissionState';
import ChordSummaryCard, { summarizeChords, parseRootPc } from '../components/ChordSummaryCard';
import MelodyTimeline from '../components/MelodyTimeline';
import {
  analyzeRecording, warmupEngine, isEngineReady, extractMelody,
  type AnalysisResult, type BeatChord, type MelodyTrack,
} from '../audio/essentia-engine';
import { vibrate } from '../utils/haptic';
import { recordSession } from '../utils/progress';

const SHARP_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

type Phase = 'idle' | 'requesting' | 'recording' | 'analyzing' | 'done' | 'error';

// Round 51: 两种模式 — 和弦/调性识别 vs 主旋律扒带
type Mode = 'chord' | 'melody';

const DURATION_OPTIONS = [10, 20, 30] as const;
// Round 51: 主旋律模式仅支持 ≤15s, 防 PitchMelodia 在长录音上爆 RAM/超时
const MELODY_DURATION_OPTIONS = [5, 10, 15] as const;
type Duration = number;

/**
 * Round 48: WebAssembly 能力检测（防 Expo WebView file:// 下 dynamic import 失败）
 *
 * 真实降级条件:
 *   - WebAssembly 全局不可用（极老浏览器）
 *   - BigInt 不支持（Essentia WASM 依赖）
 *
 * 不再根据 UA 字符串判断 Expo —— 让真实功能检测说话。
 */
function isEssentiaSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof WebAssembly === 'undefined') return false;
  if (typeof BigInt === 'undefined') return false;
  return true;
}

/**
 * Round 48: MediaRecorder mimeType 兼容检测
 * 优先级: webm/opus（Chrome/Firefox/Android）→ mp4（iOS Safari 14+）→ 浏览器默认
 */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/mp4;codecs=mp4a.40.2',
  ];
  for (const t of candidates) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {}
  }
  return undefined;
}

export default function ListenPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<Mode>('chord');
  const [duration, setDuration] = useState<Duration>(20);
  const [micState, setMicState] = useState<MicPermState>('idle');
  const [recordedSec, setRecordedSec] = useState(0);
  const [level, setLevel] = useState(0);  // 0~1 实时 dB
  const [waveform, setWaveform] = useState<number[]>([]);  // 滚动波形（最近 60 帧）
  const [engineReady, setEngineReady] = useState(isEngineReady());
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [melody, setMelody] = useState<MelodyTrack | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);

  // Round 48: 环境能力检测（一次性）
  const supported = useMemo(() => isEssentiaSupported(), []);

  // 进入页面时静默预热 Essentia WASM（不阻塞，仅缩短首次分析延迟）
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    warmupEngine().then(() => { if (!cancelled) setEngineReady(true); }).catch(err => {
      console.warn('[round48] essentia warmup failed:', err);
    });
    return () => { cancelled = true; };
  }, [supported]);

  // Round 48: 切后台兜底 — 录音中切 tab/锁屏，主动 stop，让 onstop 走正常分析链
  useEffect(() => {
    const handleVis = () => {
      if (document.visibilityState === 'hidden' && phase === 'recording') {
        console.log('[round48] page hidden during recording → auto-stop');
        try { mediaRecorderRef.current?.stop(); } catch {}
      }
    };
    document.addEventListener('visibilitychange', handleVis);
    return () => document.removeEventListener('visibilitychange', handleVis);
  }, [phase]);

  // 卸载清理
  useEffect(() => () => { cleanup(); }, []);

  const cleanup = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    try { mediaRecorderRef.current?.stop(); } catch {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;
    analyserRef.current = null;
    mediaRecorderRef.current = null;
  };

  const startRecording = useCallback(async () => {
    setPhase('requesting');
    setMicState('requesting');
    setErrorMsg('');
    setResult(null);
    setMelody(null);
    setWaveform([]);
    setRecordedSec(0);
    setLevel(0);
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // 关闭浏览器自动处理 — 我们要原始音频做分析，echoCancellation/AGC 会破坏 chroma
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err: any) {
      const name = err?.name || '';
      const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
      setMicState(denied ? 'denied' : 'error');
      setPhase('error');
      setErrorMsg(denied ? '麦克风权限被拒绝' : `麦克风启动失败: ${name || err?.message || '未知错误'}`);
      return;
    }

    streamRef.current = stream;
    setMicState('granted');
    setPhase('recording');

    // 建 AudioContext + AnalyserNode 做实时波形/dB
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const audioCtx = new Ctor();
    audioCtxRef.current = audioCtx;
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);
    analyserRef.current = analyser;

    const timeData = new Uint8Array(analyser.fftSize);

    const loop = () => {
      if (!analyserRef.current) return;
      analyser.getByteTimeDomainData(timeData);
      // 计算 RMS → dB 等效电平
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < timeData.length; i++) {
        const s = (timeData[i] - 128) / 128;
        sum += s * s;
        if (Math.abs(s) > peak) peak = Math.abs(s);
      }
      const rms = Math.sqrt(sum / timeData.length);
      setLevel(Math.min(1, rms * 4));  // 放大显示
      setWaveform(prev => {
        const next = prev.concat([peak]);
        if (next.length > 60) next.splice(0, next.length - 60);
        return next;
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();

    // 启动 MediaRecorder — Round 48: 显式选 mimeType 防 iOS/Android 容器不兼容
    const mimeType = pickMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    console.log('[round48] MediaRecorder mimeType:', recorder.mimeType);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = async () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      try {
        setPhase('analyzing');
        // 用 44100 Hz 的 AudioContext 做解码，让浏览器底层 C++ 做高质量重采样
        const decodeCtx = new Ctor({ sampleRate: 44100 });
        const arrayBuf = await blob.arrayBuffer();
        const audioBuffer = await decodeCtx.decodeAudioData(arrayBuf);
        await decodeCtx.close();

        const float32 = audioBuffer.getChannelData(0);

        // Round 51: 按 mode 分支 — chord 走 analyzeRecording, melody 走 extractMelody
        if (mode === 'melody') {
          const m = await extractMelody(float32);
          setMelody(m);
          setPhase('done');
          vibrate(20);
          try {
            recordSession('melody', m.notes.length, m.notes.length, Math.round(recordedSec));
          } catch {}
        } else {
          const analysis = await analyzeRecording(float32, audioBuffer.sampleRate);
          setResult(analysis);
          setPhase('done');
          vibrate(20);
          // 记录练习 session（用于 progress 统计）
          try {
            recordSession('listen', analysis.beatChords.length, analysis.beatChords.length, Math.round(recordedSec));
          } catch {}
        }
      } catch (err: any) {
        console.error('[round47] analyze failed', err);
        setErrorMsg('分析失败：' + (err?.message || String(err)));
        setPhase('error');
      } finally {
        try { audioCtxRef.current?.close(); } catch {}
        audioCtxRef.current = null;
        analyserRef.current = null;
        mediaRecorderRef.current = null;
      }
    };

    mediaRecorderRef.current = recorder;
    recorder.start(250);  // 250ms timeslice，方便取消时已有部分数据
    startTimeRef.current = performance.now();

    // 倒计时
    tickRef.current = window.setInterval(() => {
      const elapsed = (performance.now() - startTimeRef.current) / 1000;
      setRecordedSec(elapsed);
      if (elapsed >= duration) {
        try { recorder.stop(); } catch {}
      }
    }, 100);
  }, [duration, mode]);

  const stopRecording = useCallback(() => {
    // Round 47 review: 立刻切到 analyzing，避免 onstop 异步触发期间 UI 卡死感
    setPhase('analyzing');
    try { mediaRecorderRef.current?.stop(); } catch {}
  }, []);

  const reset = useCallback(() => {
    cleanup();
    setPhase('idle');
    setResult(null);
    setMelody(null);
    setErrorMsg('');
    setRecordedSec(0);
    setWaveform([]);
    setMicState('idle');
  }, []);

  // 衍生数据：走向总结（基于 beatChords，做 Essentia → ChordSummaryCard 的格式适配）
  const summary = useMemo(() => {
    if (!result) return null;
    // Essentia 输出和弦名形如 "C", "Am", "F#", "Bm" → 转 chordId 格式：major 留原样，minor 把 "m" 留住
    const history = result.beatChords.map((bc): { name: string; chordId: string } => {
      const ch = bc.chord || 'N';
      return { name: ch, chordId: ch };  // chordId 与 name 同（parseRootPc 接受 "Am" 这种格式）
    });
    const keyRootPc = result.key.key ? parseRootPc(result.key.key) : -1;
    return summarizeChords(
      history,
      keyRootPc >= 0 ? keyRootPc : null,
      keyRootPc >= 0 ? result.key.scale : null,
    );
  }, [result]);

  return (
    <div>
      <div className="card">
        <h2>🎧 听歌识别 (Essentia)</h2>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          离线模式：录一段音频 → 用 Essentia.js 分析<br/>
          <span style={{ fontSize: 12 }}>「和弦/调性」识别和弦走向 + 调性 + BPM｜「主旋律」提取音高轨</span>
        </p>
      </div>

      {/* Round 48: 不支持 WebAssembly 的环境降级提示（如某些 Expo WebView 旧版本） */}
      {!supported && (
        <div className="card" style={{ borderColor: 'var(--brand)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--brand)' }}>当前环境不支持离线识别</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.6 }}>
            听歌识别功能依赖 WebAssembly。请在主流浏览器（Chrome / Safari / Firefox / Edge）中打开本 App。
            <br />
            其他功能（调音器、和弦练习、节拍器等）不受影响。
          </div>
        </div>
      )}

      {supported && <>
      {/* Round 51: 模式切换 tab */}
      <div className="card">
        <div className="subpage-segmented" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'chord'}
            className={mode === 'chord' ? 'active' : ''}
            onClick={() => {
              if (phase === 'recording' || phase === 'analyzing') return;
              setMode('chord');
              setDuration(20);
              setResult(null);
              setMelody(null);
            }}
            disabled={phase === 'recording' || phase === 'analyzing'}
          >🎵 和弦/调性</button>
          <button
            role="tab"
            aria-selected={mode === 'melody'}
            className={mode === 'melody' ? 'active' : ''}
            onClick={() => {
              if (phase === 'recording' || phase === 'analyzing') return;
              setMode('melody');
              setDuration(10);
              setResult(null);
              setMelody(null);
            }}
            disabled={phase === 'recording' || phase === 'analyzing'}
          >🎼 主旋律</button>
        </div>
        {mode === 'melody' && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
            💡 哼唱单音 / 弹单音旋律效果最佳。带和声/伴奏的歌曲, 算法可能跟错声部.
          </div>
        )}
      </div>

      {/* 时长选择 */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>录音时长</div>
        <div className="subpage-segmented" role="tablist">
          {(mode === 'melody' ? MELODY_DURATION_OPTIONS : DURATION_OPTIONS).map(d => (
            <button
              key={d}
              role="tab"
              aria-selected={duration === d}
              className={duration === d ? 'active' : ''}
              onClick={() => setDuration(d)}
              disabled={phase === 'recording' || phase === 'analyzing'}
            >
              {d}秒
            </button>
          ))}
        </div>

        {/* 主按钮区 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 18, gap: 12 }}>
          {phase === 'idle' && (
            <button
              onClick={startRecording}
              style={{
                width: 120, height: 120, borderRadius: '50%',
                border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg, var(--brand), var(--accent-cyan, var(--brand)))',
                color: '#fff', fontSize: 16, fontWeight: 700,
                boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >🎤<br/>开始录音</button>
          )}

          {phase === 'requesting' && (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>请求麦克风…</div>
          )}

          {phase === 'recording' && (
            <RecordingView
              recordedSec={recordedSec}
              duration={duration}
              level={level}
              waveform={waveform}
              onStop={stopRecording}
            />
          )}

          {phase === 'analyzing' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div className="mic-perm-loader" style={{ margin: '0 auto 12px' }} aria-hidden="true" />
              <div style={{ fontSize: 14, color: 'var(--text-strong)' }}>分析中…</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {engineReady ? '运行 Essentia.js 算法' : '首次加载约 2.5MB 引擎，请稍候'}
              </div>
            </div>
          )}

          {(phase === 'done' || phase === 'error') && (
            <button className="btn" onClick={reset}>↻ 再录一段</button>
          )}
        </div>
      </div>

      <MicPermissionState state={micState} onRetry={startRecording} />

      {phase === 'error' && errorMsg && (
        <div className="card" style={{ borderColor: 'var(--danger, #ef4444)' }}>
          <div style={{ fontSize: 14, color: 'var(--danger, #ef4444)', fontWeight: 600 }}>分析出错</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>{errorMsg}</div>
        </div>
      )}

      {/* Round 51: 结果按 mode 分支显示 */}
      {phase === 'done' && mode === 'chord' && result && (
        <>
          <ResultHeader result={result} />
          <ChordTimeline beatChords={result.beatChords} totalDuration={recordedSec} />
          {summary && <ChordSummaryCard summary={summary} />}
        </>
      )}
      {phase === 'done' && mode === 'melody' && melody && (
        <MelodyTimeline track={melody} />
      )}

      <div className="card">
        <p style={{ fontSize: 13 }}>💡 <b>使用方法</b>：对着手机播放歌曲（音箱/另一台手机外放），或弹吉他录自己的进行。</p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          ⚙️ Essentia.js 自带 ChordsDetectionBeats 算法：先用 RhythmExtractor2013 找节拍，再按节拍切片识别和弦，避免半拍闪烁。
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          ⚠️ 当前版本仅识别大三和弦/小三和弦（Cmaj7 会识别为 C，Am7 会识别为 Am）。
        </p>
      </div>
      </>}
    </div>
  );
}

/* =================== 子组件：录音中视图 =================== */

function RecordingView({ recordedSec, duration, level, waveform, onStop }: {
  recordedSec: number;
  duration: number;
  level: number;
  waveform: number[];
  onStop: () => void;
}) {
  const remainSec = Math.max(0, duration - recordedSec);
  const progress = Math.min(1, recordedSec / duration);

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
      {/* 进度环 */}
      <div style={{ position: 'relative', width: 140, height: 140 }}>
        <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="70" cy="70" r="62" stroke="var(--line-soft)" strokeWidth="6" fill="none" />
          <circle
            cx="70" cy="70" r="62"
            stroke="var(--danger, #ef4444)" strokeWidth="6" fill="none"
            strokeDasharray={`${2 * Math.PI * 62}`}
            strokeDashoffset={`${2 * Math.PI * 62 * (1 - progress)}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.1s linear' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--danger, #ef4444)' }}>
            {remainSec.toFixed(1)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>秒</div>
        </div>
      </div>

      {/* 波形条 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 2, height: 40,
        width: '100%', maxWidth: 280, padding: '0 4px',
      }}>
        {waveform.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 auto' }}>波形初始化…</div>
        )}
        {waveform.map((v, i) => (
          <div key={i} style={{
            flex: 1, height: `${Math.max(2, v * 100)}%`,
            background: 'var(--brand)', borderRadius: 2, minWidth: 2,
            opacity: 0.4 + 0.6 * (i / waveform.length),
          }} />
        ))}
      </div>

      {/* dB 电平指示 */}
      <div style={{ width: '100%', maxWidth: 280 }}>
        <div style={{
          width: '100%', height: 6, background: 'var(--bg-soft)',
          borderRadius: 3, overflow: 'hidden',
        }}>
          <div style={{
            width: `${level * 100}%`, height: '100%',
            background: level > 0.7 ? 'var(--danger, #ef4444)' :
                       level > 0.3 ? 'var(--brand)' : 'var(--success, #10b981)',
            transition: 'width 0.1s',
          }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, textAlign: 'center' }}>
          {level < 0.05 ? '⚠️ 声音太小，靠近麦克风或调大音量' : level > 0.85 ? '⚠️ 音量过大，可能失真' : '✓ 音量正常'}
        </div>
      </div>

      <button className="btn" onClick={onStop} style={{ marginTop: 4 }}>⏹ 提前停止</button>
    </div>
  );
}

/* =================== 子组件：结果头 (BPM + 调性) =================== */

function ResultHeader({ result }: { result: AnalysisResult }) {
  // Essentia 调性输出的 key 已经是 SHARP 名（A~G + #）
  // scale: major | minor
  const scaleLabel = result.key.scale === 'major' ? '大调' : '小调';
  const confColor = result.key.strength > 0.6 ? 'var(--success, #10b981)' :
                    result.key.strength > 0.4 ? 'var(--brand)' : 'var(--text-muted)';

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <Stat label="调性" value={`${result.key.key} ${scaleLabel}`} sub={`置信 ${(result.key.strength * 100).toFixed(0)}%`} color={confColor} />
        <Stat label="BPM" value={result.bpm > 0 ? result.bpm.toFixed(0) : '—'} sub="拍/分钟" />
        <Stat label="节拍数" value={`${result.ticks.length}`} sub={`和弦 ${result.beatChords.length}`} />
        <Stat label="耗时" value={`${(result.elapsedMs / 1000).toFixed(2)}s`} sub="分析时间" />
      </div>
    </div>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 70 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--text-strong)', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* =================== 子组件：和弦时间线 =================== */

function ChordTimeline({ beatChords, totalDuration }: { beatChords: BeatChord[]; totalDuration: number }) {
  if (beatChords.length === 0) {
    return (
      <div className="card">
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>未识别到和弦（可能音量太小或节拍不稳）</div>
      </div>
    );
  }

  const lastEnd = beatChords[beatChords.length - 1]?.endSec || totalDuration;
  const total = Math.max(lastEnd, totalDuration, 1);
  // Round 48: 统计被 key-aware snap 的段数
  const snappedCount = beatChords.filter(b => b.snapped).length;

  return (
    <div className="card">
      <h2>🎵 节拍和弦时间线</h2>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        {beatChords.length} 个 beat-aligned 和弦段（卡节拍）
        {snappedCount > 0 && (
          <span> · <span style={{ borderBottom: '1px dashed currentColor' }}>{snappedCount} 段</span>已按调性纠正</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {/* 时间轴刻度 */}
        <div style={{ position: 'relative', height: 14, marginBottom: 4 }}>
          {Array.from({ length: Math.floor(total) + 1 }).map((_, sec) => (
            <div key={sec} style={{
              position: 'absolute',
              left: `${(sec / total) * 100}%`,
              fontSize: 9, color: 'var(--text-muted)',
              transform: 'translateX(-50%)',
            }}>{sec}s</div>
          ))}
        </div>

        {/* 和弦条 */}
        <div style={{
          position: 'relative', display: 'flex', height: 40,
          borderRadius: 6, overflow: 'hidden',
          background: 'var(--bg-soft)',
          border: '1px solid var(--line-soft)',
        }}>
          {beatChords.map((bc, i) => {
            const widthPct = ((bc.endSec - bc.startSec) / total) * 100;
            if (widthPct < 0.5) return null;
            const isMinor = bc.chord.endsWith('m') && !bc.chord.endsWith('aj') && bc.chord !== 'm';
            const isUnknown = bc.chord === 'N' || !bc.chord;
            const bg = isUnknown ? 'var(--bg-elev-2, rgba(0,0,0,0.05))' :
                      isMinor ? 'var(--info, #3b82f6)' : 'var(--brand)';
            return (
              <div
                key={i}
                style={{
                  width: `${widthPct}%`,
                  background: bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 13, fontWeight: 700,
                  borderRight: i < beatChords.length - 1 ? '1px solid rgba(255,255,255,0.15)' : 'none',
                  cursor: 'default',
                  opacity: bc.strength > 0.3 ? 1 : 0.5,
                  // Round 48: snap 过的段加虚线下划线，让用户看到哪些是经过 key-aware 纠正的
                  borderBottom: bc.snapped ? '2px dashed rgba(255,255,255,0.5)' : 'none',
                }}
                title={
                  bc.snapped
                    ? `${bc.chord} (key-aware 纠正自 ${bc.originalChord}) · ${bc.startSec.toFixed(2)}s → ${bc.endSec.toFixed(2)}s · 强度 ${(bc.strength * 100).toFixed(0)}%`
                    : `${bc.chord} · ${bc.startSec.toFixed(2)}s → ${bc.endSec.toFixed(2)}s · 强度 ${(bc.strength * 100).toFixed(0)}%`
                }
              >
                {widthPct > 4 ? bc.chord : ''}
              </div>
            );
          })}
        </div>

        {/* 完整序列文本（小屏可读） */}
        <div style={{ fontSize: 13, color: 'var(--text-body)', marginTop: 8, lineHeight: 1.8 }}>
          {beatChords.map((bc, i) => (
            <span key={i} style={{
              display: 'inline-block', padding: '2px 6px', marginRight: 4, marginBottom: 4,
              background: 'var(--bg-soft)', border: '1px solid var(--line-soft)',
              borderRadius: 4, fontSize: 12,
            }}>
              {bc.chord}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
