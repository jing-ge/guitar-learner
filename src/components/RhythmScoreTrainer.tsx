/**
 * Round 50: 节奏稳定度评分训练
 *
 * 流程:
 *   1. 选 BPM (60/80/100/120, 默认 80)
 *   2. 点开始 → 4 拍预备 (click) → 4 拍校准 (用户跟拍 → 自动算 offset)
 *      → 8 小节 32 拍正式录音 + 节拍器
 *   3. Essentia.OnsetRate 检测起音 → rhythmScorer 评分 → 可视化时间轴 + 数据卡
 *
 * 关键设计:
 *   - 拍点用 AudioContext.currentTime 记录, 抗 setTimeout 抖动
 *   - 录音用 MediaRecorder + decodeAudioData 重采样到 44100
 *   - 校准阶段先算 median offset, 评分阶段减掉系统延迟
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { synth } from '../audio/synth';
import { detectOnsets, warmupEngine } from '../audio/essentia-engine';
import {
  computeCalibrationOffset, scoreRhythm, gradeColor, gradeLabel,
  type BeatGrade, type RhythmScore,
} from '../audio/rhythmScorer';
import { vibrate } from '../utils/haptic';
import { recordSession } from '../utils/progress';
import MicPermissionState, { type MicPermState } from './MicPermissionState';

type Phase = 'idle' | 'requesting' | 'countdown' | 'calibrating' | 'recording' | 'analyzing' | 'done' | 'error';

const BPM_OPTIONS = [60, 80, 100, 120] as const;
const COUNTDOWN_BEATS = 4;       // 4 拍预备
const CALIBRATION_BEATS = 4;     // 4 拍校准
const SCORING_BEATS = 32;        // 8 小节 × 4 = 32 拍正式录音

export default function RhythmScoreTrainer() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [bpm, setBpm] = useState<number>(80);
  const [micState, setMicState] = useState<MicPermState>('idle');
  const [currentBeat, setCurrentBeat] = useState(-1);  // 当前显示的拍子 index (countdown/calib/scoring 累计)
  const [score, setScore] = useState<RhythmScore | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // 拍点时间戳 (AudioContext 时间, 秒): 整段从 countdown 开始
  const allBeatTimesRef = useRef<number[]>([]);
  // 评分阶段的拍点时间 (相对录音开始的 0 点)
  const scoringBeatTimesRef = useRef<number[]>([]);
  // 校准阶段拍点时间 (相对录音开始的 0 点)
  const calibBeatTimesRef = useRef<number[]>([]);

  // 录音
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartCtxTimeRef = useRef<number>(0);  // recorder.start() 那一刻的 AudioContext.currentTime

  // 调度器
  const beatTimerRef = useRef<number | null>(null);

  // 预热 essentia
  useEffect(() => {
    warmupEngine().catch(() => {});
  }, []);

  // 卸载清理
  useEffect(() => () => cleanup(), []);

  const cleanup = () => {
    if (beatTimerRef.current) { window.clearTimeout(beatTimerRef.current); beatTimerRef.current = null; }
    // Round 50 oracle #1: 先解绑 onstop 再 stop, 防 cleanup/重试时 onstop 在已卸载组件上 setState
    if (mediaRecorderRef.current) {
      try { mediaRecorderRef.current.onstop = null; } catch {}
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
  };

  /** 开始训练 */
  const start = useCallback(async () => {
    setPhase('requesting');
    setMicState('requesting');
    setErrorMsg('');
    setScore(null);
    setCurrentBeat(-1);
    allBeatTimesRef.current = [];
    scoringBeatTimesRef.current = [];
    calibBeatTimesRef.current = [];
    chunksRef.current = [];

    // 1. 申请麦克风
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err: any) {
      const name = err?.name || '';
      const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError';
      setMicState(denied ? 'denied' : 'error');
      setPhase('error');
      setErrorMsg(denied ? '麦克风权限被拒绝' : `麦克风启动失败: ${name || '未知'}`);
      return;
    }
    streamRef.current = stream;
    setMicState('granted');

    // 2. 解锁 synth + 启动 MediaRecorder (mimeType 兼容选择)
    await synth.unlock();
    const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    let mimeType: string | undefined;
    for (const t of mimeTypes) {
      try { if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; } } catch {}
    }
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = onRecordingStop;
    mediaRecorderRef.current = recorder;

    // 3. 排好整个流程的拍点 (countdown 4 + calibration 4 + scoring 32 = 40 拍)
    //    用 AudioContext.currentTime 做基准
    const beatDur = 60 / bpm;
    const ctxStart = synth.getCurrentTime() + 0.3;  // 300ms 准备时间
    recordStartCtxTimeRef.current = ctxStart;

    const totalBeats = COUNTDOWN_BEATS + CALIBRATION_BEATS + SCORING_BEATS;
    const allTimes: number[] = [];
    for (let i = 0; i < totalBeats; i++) {
      const t = ctxStart + i * beatDur;
      allTimes.push(t);
      const isAccent = (i % 4) === 0;
      synth.click(isAccent, t);
    }
    allBeatTimesRef.current = allTimes;

    // calibration beats (相对录音开始 0 点) = 拍点 4-7 (索引 4,5,6,7) - ctxStart
    calibBeatTimesRef.current = allTimes
      .slice(COUNTDOWN_BEATS, COUNTDOWN_BEATS + CALIBRATION_BEATS)
      .map(t => t - ctxStart);
    // scoring beats = 拍点 8-39
    scoringBeatTimesRef.current = allTimes
      .slice(COUNTDOWN_BEATS + CALIBRATION_BEATS)
      .map(t => t - ctxStart);

    // 4. 启动 MediaRecorder 在 ctxStart 那一刻
    //    但 MediaRecorder 没法精确定时, 我们提前 50ms 启动, 用 ctxStart 作为绝对 0 时刻参考
    const delayMs = (ctxStart - synth.getCurrentTime()) * 1000;
    window.setTimeout(() => {
      try { recorder.start(250); } catch (err) { console.error('[round50] recorder start failed', err); }
    }, Math.max(0, delayMs - 50));

    setPhase('countdown');

    // 5. UI 拍号更新 (用 setTimeout 跟 ctx 时间近似对齐, 仅用于显示拍数)
    const updateBeat = (i: number) => {
      if (i >= totalBeats) {
        // 结束: 停录音
        try { recorder.stop(); } catch {}
        setPhase('analyzing');
        return;
      }
      setCurrentBeat(i);
      if (i === 0) vibrate(15);
      if (i === COUNTDOWN_BEATS) setPhase('calibrating');
      if (i === COUNTDOWN_BEATS + CALIBRATION_BEATS) setPhase('recording');

      const nextT = allTimes[i + 1];
      if (nextT === undefined) {
        // 已是最后一拍, 等一拍后停
        beatTimerRef.current = window.setTimeout(() => updateBeat(totalBeats), beatDur * 1000);
        return;
      }
      const delayToNext = (nextT - synth.getCurrentTime()) * 1000;
      beatTimerRef.current = window.setTimeout(() => updateBeat(i + 1), Math.max(0, delayToNext));
    };
    const initialDelay = (ctxStart - synth.getCurrentTime()) * 1000;
    beatTimerRef.current = window.setTimeout(() => updateBeat(0), Math.max(0, initialDelay));
    // onRecordingStop 在闭包内通过 recorder.onstop 异步调用，加入依赖会造成 useCallback 每次 onstop
    // 改写都重建，反而失去稳定性
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bpm]);

  /** 录音结束 → Essentia 检测 onset → 评分 */
  const onRecordingStop = useCallback(async () => {
    try {
      const blob = new Blob(chunksRef.current, { type: mediaRecorderRef.current?.mimeType || 'audio/webm' });
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      // 重采样到 44100 (Essentia OnsetRate 必须)
      const decodeCtx = new Ctor({ sampleRate: 44100 });
      const arrayBuf = await blob.arrayBuffer();
      const audioBuffer = await decodeCtx.decodeAudioData(arrayBuf);
      await decodeCtx.close();
      const audio = audioBuffer.getChannelData(0);

      // detectOnsets 返回 onset 时间戳 (相对录音开头, 秒)
      const { onsets } = await detectOnsets(audio);

      // 1. 校准: 算系统延迟 (Round 50 oracle #3: 检测用户是否真的跟拍了)
      const { offsetSec: offset, matched } = computeCalibrationOffset(calibBeatTimesRef.current, onsets);
      if (matched < 2) {
        // 用户在校准阶段没扫弦 → median 退化为 0, 评分阶段会把全部系统延迟当成用户拖拍
        setErrorMsg(
          `校准失败：仅检测到 ${matched} 次扫弦（应有 ${CALIBRATION_BEATS} 次）。\n` +
          `重新开始并确保在「校准」阶段对着麦克风扫弦 ${CALIBRATION_BEATS} 拍。`
        );
        setPhase('error');
        return;
      }

      // 2. 评分阶段
      const result = scoreRhythm(scoringBeatTimesRef.current, onsets, offset);
      setScore(result);
      setPhase('done');

      const hitPct = Math.round(result.hitRate * 100);
      try {
        recordSession('rhythm-score', Math.round(result.hitRate * SCORING_BEATS), SCORING_BEATS, 30);
      } catch {}
      vibrate(hitPct >= 80 ? 30 : 10);
    } catch (err: any) {
      console.error('[round50] analyze failed', err);
      setErrorMsg('分析失败: ' + (err?.message || String(err)));
      setPhase('error');
    } finally {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      mediaRecorderRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cleanup();
    setPhase('idle');
    setScore(null);
    setCurrentBeat(-1);
    setErrorMsg('');
    setMicState('idle');
  }, []);

  // ============ 渲染 ============

  const totalBeats = COUNTDOWN_BEATS + CALIBRATION_BEATS + SCORING_BEATS;
  const beatInPhase = currentBeat < COUNTDOWN_BEATS
    ? `预备 ${currentBeat + 1}/${COUNTDOWN_BEATS}`
    : currentBeat < COUNTDOWN_BEATS + CALIBRATION_BEATS
      ? `校准 ${currentBeat - COUNTDOWN_BEATS + 1}/${CALIBRATION_BEATS}`
      : `第 ${currentBeat - COUNTDOWN_BEATS - CALIBRATION_BEATS + 1}/${SCORING_BEATS} 拍`;

  return (
    <div className="card">
      <h2>🎯 节奏评分训练</h2>
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        跟节拍器扫弦，结束后看每拍偏差 ms + 命中率。<br/>
        流程：4 拍预备 → 4 拍跟拍校准 → 8 小节正式（共 {SCORING_BEATS} 拍）
      </p>

      {/* BPM 选择 */}
      {phase === 'idle' && (
        <>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>速度</div>
            <div className="subpage-segmented" role="tablist">
              {BPM_OPTIONS.map(b => (
                <button
                  key={b}
                  role="tab"
                  aria-selected={bpm === b}
                  className={bpm === b ? 'active' : ''}
                  onClick={() => setBpm(b)}
                >{b} BPM</button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <button
              onClick={start}
              style={{
                padding: '14px 28px', borderRadius: 12,
                background: 'linear-gradient(135deg, var(--brand), var(--accent-cyan, var(--brand)))',
                color: '#fff', fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer',
              }}
            >🎤 开始评分训练</button>
          </div>
        </>
      )}

      <MicPermissionState state={micState} onRetry={start} />

      {/* 进行中状态 */}
      {(phase === 'countdown' || phase === 'calibrating' || phase === 'recording') && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <div style={{
            fontSize: 14, fontWeight: 600,
            color: phase === 'countdown' ? 'var(--text-muted)'
                  : phase === 'calibrating' ? 'var(--brand)'
                  : 'var(--danger, #ef4444)',
          }}>
            {phase === 'countdown' && '🎵 预备 — 听节拍器，先不弹'}
            {phase === 'calibrating' && '👂 校准 — 跟着节拍器扫弦 4 拍'}
            {phase === 'recording' && '🎸 正式录音 — 持续扫弦到结束'}
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8, color: 'var(--text-strong)' }}>
            {beatInPhase}
          </div>
          {/* 4 个拍点指示 (mod 4) */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 12 }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{
                width: 16, height: 16, borderRadius: '50%',
                background: (currentBeat % 4) === i ? 'var(--brand)' : 'var(--bg-soft)',
                border: '1px solid var(--line-soft)',
                transition: 'background 0.1s',
              }} />
            ))}
          </div>
          {/* 进度条 */}
          <div style={{
            marginTop: 16, height: 6, borderRadius: 3,
            background: 'var(--bg-soft)', overflow: 'hidden',
          }}>
            <div style={{
              width: `${Math.min(100, (currentBeat / totalBeats) * 100)}%`,
              height: '100%', background: 'var(--brand)',
              transition: 'width 0.1s linear',
            }} />
          </div>
        </div>
      )}

      {phase === 'analyzing' && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <div className="mic-perm-loader" style={{ margin: '0 auto 8px' }} aria-hidden="true" />
          <div style={{ fontSize: 13, color: 'var(--text-strong)' }}>分析中...</div>
        </div>
      )}

      {phase === 'error' && errorMsg && (
        <div style={{
          marginTop: 12, padding: 10, borderRadius: 8,
          background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
        }}>
          <div style={{ fontSize: 13, color: 'var(--danger, #ef4444)', fontWeight: 600 }}>训练出错</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, whiteSpace: 'pre-line' }}>{errorMsg}</div>
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={reset}>重试</button>
        </div>
      )}

      {/* 评分结果 */}
      {phase === 'done' && score && <ScoreResult score={score} onRetry={reset} />}
    </div>
  );
}

/* =================== 评分结果展示 =================== */
function ScoreResult({ score, onRetry }: { score: RhythmScore; onRetry: () => void }) {
  const hitPct = Math.round(score.hitRate * 100);
  const hitColor = hitPct >= 80 ? 'var(--success, #10b981)'
                : hitPct >= 50 ? 'var(--brand)'
                : 'var(--text-muted)';
  const signed = score.meanSignedDeviationMs;
  const signedLabel = Math.abs(signed) < 5 ? '稳' : signed > 0 ? `+${signed.toFixed(0)}ms (抢)` : `${signed.toFixed(0)}ms (拖)`;

  // 等级统计
  const counts = score.matches.reduce((acc, m) => {
    acc[m.grade] = (acc[m.grade] ?? 0) + 1;
    return acc;
  }, {} as Record<BeatGrade, number>);

  return (
    <div style={{ marginTop: 14 }}>
      {/* Round 55 A5: 检测到回授 → UI 警告条 (顶部, 不影响主数据显示) */}
      {score.feedbackSuspected && (
        <div style={{
          marginBottom: 10, padding: 8, borderRadius: 6,
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.3)',
          fontSize: 12, color: 'var(--text-body)', lineHeight: 1.5,
        }}>
          ⚠ <b>检测到节拍器声可能被麦克风收录</b>（命中率可能虚高）。<br/>
          建议戴耳机或降低外放音量后重测。
        </div>
      )}

      {/* 顶部数据卡 */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
        marginBottom: 12,
      }}>
        <StatBlock label="命中率" value={`${hitPct}%`} sub={`${counts.hit ?? 0}+${counts.near ?? 0} / ${score.matches.length}`} color={hitColor} />
        <StatBlock label="平均偏差" value={`${score.meanAbsDeviationMs.toFixed(0)}ms`} sub={signedLabel} />
        <StatBlock label="系统延迟" value={`${score.calibrationOffsetMs.toFixed(0)}ms`} sub="自动校准" />
      </div>

      {/* 时间轴 */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 6 }}>每拍偏差</div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 3,
        padding: 8, borderRadius: 8,
        background: 'var(--bg-soft)', border: '1px solid var(--line-soft)',
      }}>
        {score.matches.map((m, i) => (
          <div
            key={i}
            title={
              m.deviationMs === null
                ? `第 ${i+1} 拍: 漏`
                : `第 ${i+1} 拍: ${m.deviationMs > 0 ? '+' : ''}${m.deviationMs.toFixed(0)}ms (${gradeLabel(m.grade)})`
            }
            style={{
              width: 16, height: 28, borderRadius: 3,
              background: gradeColor(m.grade),
              opacity: m.grade === 'absent' ? 0.3 : 1,
              cursor: 'help',
            }}
          />
        ))}
      </div>

      {/* 图例 */}
      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <LegendItem grade="hit"  label="准 ≤20ms" />
        <LegendItem grade="near" label="偏 ≤50ms" />
        <LegendItem grade="miss" label="差 ≤150ms" />
        <LegendItem grade="absent" label="漏" />
      </div>

      {/* 反馈语 */}
      <div style={{
        marginTop: 12, padding: 10, borderRadius: 8,
        background: 'var(--bg-soft)',
        fontSize: 13, color: 'var(--text-body)', lineHeight: 1.6,
      }}>
        {hitPct >= 90 && '🎉 节奏感非常稳！'}
        {hitPct >= 70 && hitPct < 90 && '👍 不错，再练几遍可以更准。'}
        {hitPct >= 40 && hitPct < 70 && '🎯 抓住节拍器的"咔"对齐你的扫弦。'}
        {hitPct < 40 && '🔍 检查：是节拍器太快了，还是扫弦没在拍上？'}
        {Math.abs(signed) >= 30 && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
            提示：你的扫弦整体{signed > 0 ? '偏抢拍 (早)' : '偏拖拍 (晚)'}，下次有意识地{signed > 0 ? '慢半拍' : '快半拍'}试试。
          </div>
        )}
      </div>

      <button className="btn" onClick={onRetry} style={{ marginTop: 12, width: '100%' }}>↻ 再来一组</button>
    </div>
  );
}

function StatBlock({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      padding: 10, borderRadius: 8, textAlign: 'center',
      background: 'var(--bg-soft)', border: '1px solid var(--line-soft)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? 'var(--text-strong)', lineHeight: 1.2, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function LegendItem({ grade, label }: { grade: BeatGrade; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: gradeColor(grade), display: 'inline-block' }} />
      {label}
    </span>
  );
}
