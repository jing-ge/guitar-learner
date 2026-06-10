import { useEffect, useId, useRef, useState, useCallback } from 'react';
import { pitchDetector, type PitchResult } from '../audio/pitch-detector';
import { midiToFreq } from '../theory/notes';
import { synth } from '../audio/synth';
import { recordSession } from '../utils/progress';
import MicPermissionState, { type MicPermState } from '../components/MicPermissionState';
import SubpageHero from '../components/SubpageHero';
import { vibrate, vibratePattern } from '../utils/haptic';

// Round 68 · M1 — 校准偏移记忆 (localStorage 持久化 ±cent 微调偏好)
// 用户在仪表盘旁微调 ±cents 后, 下次再打开调音器仍保留偏好, 省去每次重设
const CALIBRATION_OFFSET_KEY = 'gl_tuner_calibration_offset_v1';
const CALIBRATION_OFFSET_MAX = 50; // ±50 cents, 与仪表盘量程一致

function loadCalibrationOffset(): number {
  try {
    const raw = localStorage.getItem(CALIBRATION_OFFSET_KEY);
    if (!raw) return 0;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-CALIBRATION_OFFSET_MAX, Math.min(CALIBRATION_OFFSET_MAX, Math.round(n)));
  } catch {
    return 0;
  }
}

function saveCalibrationOffset(n: number): void {
  try {
    const clamped = Math.max(-CALIBRATION_OFFSET_MAX, Math.min(CALIBRATION_OFFSET_MAX, Math.round(n)));
    localStorage.setItem(CALIBRATION_OFFSET_KEY, String(clamped));
  } catch {}
}

// 标准调弦 6 弦（按弦序 6→1 排列，UI 网格也按这个顺序）
const STRINGS = [
  { stringNo: 6, name: 'E2', noteOnly: 'E', label: '6弦 E', midi: 40, freq: 82.41 },
  { stringNo: 5, name: 'A2', noteOnly: 'A', label: '5弦 A', midi: 45, freq: 110.00 },
  { stringNo: 4, name: 'D3', noteOnly: 'D', label: '4弦 D', midi: 50, freq: 146.83 },
  { stringNo: 3, name: 'G3', noteOnly: 'G', label: '3弦 G', midi: 55, freq: 196.00 },
  { stringNo: 2, name: 'B3', noteOnly: 'B', label: '2弦 B', midi: 59, freq: 246.94 },
  { stringNo: 1, name: 'E4', noteOnly: 'E', label: '1弦 E', midi: 64, freq: 329.63 },
];

/** 探测麦克风权限：返回 'granted' / 'denied' / 'error' */
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

export default function TunerPage() {
  const [active, setActive] = useState(false);
  const [pitch, setPitch] = useState<PitchResult | null>(null);
  const [micState, setMicState] = useState<MicPermState>('idle');
  const [selectedString, setSelectedString] = useState(-1); // -1 = 自动检测
  const [lastPlayedString, setLastPlayedString] = useState<number>(-1); // stringNo
  const [tunedTick, setTunedTick] = useState(0); // 强制重渲染当 tunedSet 变化
  const [showSuccess, setShowSuccess] = useState(false);
  /** 每弦最近一次 cents（绝对值大于 15 时显示偏差警告） */
  const [perStringCents, setPerStringCents] = useState<Record<number, number>>({});
  // Round 68 · M1 — 校准偏移 (持久化), 用户的 ±cents 微调偏好, 影响所有 cents 计算
  const [calibrationOffset, setCalibrationOffset] = useState<number>(() => loadCalibrationOffset());

  // M1: 持久化变化
  useEffect(() => { saveCalibrationOffset(calibrationOffset); }, [calibrationOffset]);

  // 进度记录相关
  const recordedRef = useRef(false);
  const sessionStartRef = useRef<number>(0);
  const inTuneStableRef = useRef(0);
  // 用 ref 保存最新的 active 状态，便于 cleanup 时读取
  const activeRef = useRef(false);

  // tunedSet：弦序 1-6 中已稳定调准的弦
  const tunedSetRef = useRef<Set<number>>(new Set());
  // 每弦独立的稳定计数（弦序 -> 连续帧数）
  const stableByStringRef = useRef<Record<number, number>>({});
  // 防止 success 卡重复触发
  const successTriggeredRef = useRef(false);

  const filterId = useId();

  // 最近的目标弦
  const targetString = selectedString >= 0
    ? STRINGS[selectedString]
    : pitch
      ? STRINGS.reduce((best, s) => Math.abs(s.midi - pitch.midi) < Math.abs(best.midi - pitch.midi) ? s : best, STRINGS[0])
      : null;

  // 相对于目标弦的偏差（M1: 减去用户校准偏移）
  const centsFromTarget = pitch && targetString
    ? Math.round(1200 * Math.log2(pitch.freq / midiToFreq(targetString.midi))) - calibrationOffset
    : 0;

  const inTune = !!(pitch && Math.abs(centsFromTarget) <= 5);

  const startListen = useCallback(async () => {
    setMicState('requesting');
    const perm = await probeMic();
    if (perm !== 'granted') {
      setMicState(perm);
      return;
    }
    setMicState('granted');
    sessionStartRef.current = Date.now();
    recordedRef.current = false;
    inTuneStableRef.current = 0;
    tunedSetRef.current = new Set();
    stableByStringRef.current = {};
    successTriggeredRef.current = false;
    setPerStringCents({});
    setTunedTick(t => t + 1);

    await pitchDetector.start((result) => {
      setPitch(result);
      const tgt = targetStringRef.current;
      if (result && tgt) {
        const cents = Math.round(
          1200 * Math.log2(result.freq / midiToFreq(tgt.midi))
        ) - calibrationOffsetRef.current;
        // 全局 tuner session 记录（首次 in-tune 3 帧后记 tuner）
        if (Math.abs(cents) <= 5) {
          inTuneStableRef.current++;
        } else {
          inTuneStableRef.current = 0;
        }
        if (inTuneStableRef.current >= 3 && !recordedRef.current) {
          recordedRef.current = true;
          const sec = Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 1000));
          recordSession('tuner', 1, 1, sec);
          window.dispatchEvent(new CustomEvent('progress-recorded', {
            detail: { text: `已记录 · 调音 +${sec}s` }
          }));
        }

        // 每弦独立稳定计数 & 偏差缓存
        setPerStringCents(prev => prev[tgt.stringNo] === cents ? prev : { ...prev, [tgt.stringNo]: cents });
        if (Math.abs(cents) <= 5) {
          const cur = (stableByStringRef.current[tgt.stringNo] || 0) + 1;
          stableByStringRef.current[tgt.stringNo] = cur;
          if (cur >= 3 && !tunedSetRef.current.has(tgt.stringNo)) {
            tunedSetRef.current.add(tgt.stringNo);
            setTunedTick(t => t + 1);
            // 检查是否全部 6 弦调准
            if (tunedSetRef.current.size === 6 && !successTriggeredRef.current) {
              successTriggeredRef.current = true;
              const sec = Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 1000));
              recordSession('tuner-full', 1, 1, sec);
              window.dispatchEvent(new CustomEvent('progress-recorded', {
                detail: { text: '✓ 6 根弦已全部调准' }
              }));
              vibratePattern([20, 40, 20]);
              setShowSuccess(true);
              setTimeout(() => {
                setShowSuccess(false);
                // reset 避免重复触发
                tunedSetRef.current = new Set();
                stableByStringRef.current = {};
                successTriggeredRef.current = false;
                setTunedTick(t => t + 1);
              }, 1300);
            }
          }
        } else {
          stableByStringRef.current[tgt.stringNo] = 0;
        }
      } else {
        inTuneStableRef.current = 0;
      }
    });
    setActive(true);
    activeRef.current = true;
  }, []);

  // targetString 通过 ref 给回调读
  const targetStringRef = useRef(targetString);
  useEffect(() => { targetStringRef.current = targetString; }, [targetString]);
  // M1: calibrationOffset 通过 ref 给回调读, 避免每次改动重启 detector
  const calibrationOffsetRef = useRef(calibrationOffset);
  useEffect(() => { calibrationOffsetRef.current = calibrationOffset; }, [calibrationOffset]);

  const stopListen = useCallback(() => {
    pitchDetector.stop();
    setActive(false);
    activeRef.current = false;
    setPitch(null);
    // 若没记过 tuner 但持续 ≥5s，记 tuner-warmup
    if (!recordedRef.current && sessionStartRef.current > 0) {
      const sec = Math.round((Date.now() - sessionStartRef.current) / 1000);
      if (sec >= 5) {
        recordSession('tuner-warmup', 0, 0, sec);
      }
    }
    sessionStartRef.current = 0;
  }, []);

  const toggleTuner = useCallback(async () => {
    if (active) {
      stopListen();
      return;
    }
    await startListen();
  }, [active, startListen, stopListen]);

  // 页面卸载时停止
  useEffect(() => {
    return () => {
      if (activeRef.current) {
        pitchDetector.stop();
        if (!recordedRef.current && sessionStartRef.current > 0) {
          const sec = Math.round((Date.now() - sessionStartRef.current) / 1000);
          if (sec >= 5) recordSession('tuner-warmup', 0, 0, sec);
        }
      }
    };
  }, []);

  const playReference = async (s: typeof STRINGS[number]) => {
    await synth.unlock();
    synth.playMidi(s.midi, 3.0);
    setLastPlayedString(s.stringNo);
    vibrate(20);
  };

  // ===== Hero 标题/描述动态切换 =====
  let heroTitle = '调音器';
  let heroDesc: string | undefined = '允许麦克风后弹一根弦';
  if (active) {
    if (inTune && pitch && targetString) {
      heroTitle = `✓ 已调准 ${targetString.name}`;
      heroDesc = '保持，再调下一根';
    } else {
      heroTitle = '正在听…';
      heroDesc = '弹一根弦，对照仪表';
    }
  }

  // ===== 半圆仪表 SVG =====
  // viewBox 0 0 320 180, pivot (160, 160), needle length ~120
  // cents ∈ [-50, +50] → angle ∈ [-90°, +90°]
  // 静止角度 0°（指向正上方），需要把指针从默认朝向（0,0→0,-120）旋转 needleAngle
  const needleAngle = pitch ? Math.max(-90, Math.min(90, centsFromTarget * 1.8)) : 0;

  // 21 根刻度（每 5 cent）
  const ticks: { cent: number; isCenter: boolean; isInTuneBand: boolean }[] = [];
  for (let c = -50; c <= 50; c += 5) {
    ticks.push({ cent: c, isCenter: c === 0, isInTuneBand: Math.abs(c) <= 5 });
  }

  // ===== tunedSet 视图（依赖 tunedTick 强制刷新） =====
  // 读一下 tunedTick 即可让 React 把它当依赖，触发重渲染
  void tunedTick;
  const tunedSet = tunedSetRef.current;

  return (
    <div>
      <SubpageHero
        eyebrow="PRACTICE · TUNER"
        title={heroTitle}
        desc={heroDesc}
        meta="适合刚拿起琴时先热身 · 调准后建议继续做今日 5 分钟或综合训练"
      />

      <MicPermissionState state={micState} onRetry={startListen} />

      {/* Round 68 · M1 — 校准偏移微调（持久化） */}
      <div
        className="tuner-calibration"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          margin: '4px 0 12px',
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        <span style={{ marginRight: 4 }}>校准偏移</span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setCalibrationOffset(v => Math.max(-CALIBRATION_OFFSET_MAX, v - 1))}
          aria-label="校准偏移 -1 cent"
          style={{ minWidth: 40, minHeight: 36, padding: '6px 10px' }}
        >−1</button>
        <span
          aria-live="polite"
          style={{
            minWidth: 60,
            textAlign: 'center',
            fontFamily: 'monospace',
            color: calibrationOffset !== 0 ? 'var(--brand)' : 'var(--text-muted)',
            fontWeight: calibrationOffset !== 0 ? 700 : 400,
          }}
        >
          {calibrationOffset > 0 ? '+' : ''}{calibrationOffset} ¢
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setCalibrationOffset(v => Math.min(CALIBRATION_OFFSET_MAX, v + 1))}
          aria-label="校准偏移 +1 cent"
          style={{ minWidth: 40, minHeight: 36, padding: '6px 10px' }}
        >+1</button>
        {calibrationOffset !== 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setCalibrationOffset(0)}
            aria-label="重置校准偏移"
            style={{ marginLeft: 4, minHeight: 36, padding: '6px 10px' }}
          >重置</button>
        )}
      </div>

      {/* 启动按钮 */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <button
          className={'btn ' + (active ? '' : 'btn-primary')}
          style={{ width: active ? 200 : 280, maxWidth: '100%' }}
          onClick={toggleTuner}
        >
          {active ? '■ 停止调音' : '🎤 开始调音'}
        </button>
      </div>

      {/* 半圆仪表盘 */}
      <div className={'tuner-gauge-wrap' + (active && inTune ? ' in-tune' : '')} style={{ padding: '8px 4px' }}>
        <svg className="tuner-gauge-svg" viewBox="0 0 320 180" aria-hidden="true">
          <defs>
            <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="var(--success)" floodOpacity="0.85" />
            </filter>
          </defs>

          {/* 外弧（细灰） */}
          <path
            d="M 40 160 A 120 120 0 0 1 280 160"
            fill="none"
            stroke="var(--line-soft)"
            strokeWidth={1}
            strokeLinecap="round"
          />

          {/* 21 根刻度线 */}
          {ticks.map(({ cent, isCenter, isInTuneBand }) => {
            // cent -50 → angle -90°（弧左端，π），cent +50 → angle +90°（弧右端，0）
            // 弧上某点：极角 θ = (cent/50) * 90°，相对竖直向上方向
            // 对应 SVG 坐标：x = 160 + r*sin(θ), y = 160 - r*cos(θ)
            const rad = (cent * 1.8) * Math.PI / 180;
            const rInner = isCenter ? 96 : 102;
            const rOuter = 118;
            const x1 = 160 + rInner * Math.sin(rad);
            const y1 = 160 - rInner * Math.cos(rad);
            const x2 = 160 + rOuter * Math.sin(rad);
            const y2 = 160 - rOuter * Math.cos(rad);
            const stroke = isInTuneBand ? 'var(--success)' : 'var(--text-muted)';
            const opacity = isInTuneBand ? 1 : 0.5;
            const sw = isCenter ? 2.5 : 1.2;
            return (
              <line
                key={cent}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={stroke}
                strokeOpacity={opacity}
                strokeWidth={sw}
                strokeLinecap="round"
              />
            );
          })}

          {/* 刻度数字（-50/-25/0/+25/+50） */}
          {[-50, -25, 0, 25, 50].map(c => {
            const rad = (c * 1.8) * Math.PI / 180;
            const r = 134;
            const x = 160 + r * Math.sin(rad);
            const y = 160 - r * Math.cos(rad) + 4;
            return (
              <text
                key={c}
                x={x} y={y}
                fontSize={10}
                fill="var(--text-muted)"
                textAnchor="middle"
              >
                {c > 0 ? `+${c}` : c}
              </text>
            );
          })}

          {/* 指针（默认朝上 0°，rotate(angleDeg) 围绕 pivot） */}
          {active && (
            <g
              className={'tuner-needle' + (inTune ? ' in-tune' : '')}
              style={{ transform: `rotate(${needleAngle}deg)` }}
            >
              <line
                x1={160} y1={160}
                x2={160} y2={40}
                stroke="var(--brand)"
                strokeWidth={3}
                strokeLinecap="round"
                filter={inTune ? `url(#${filterId})` : undefined}
              />
              <circle
                cx={160} cy={40}
                r={inTune ? 10 : 6}
                fill="var(--brand)"
                filter={inTune ? `url(#${filterId})` : undefined}
              />
            </g>
          )}
          {/* 弧心枢轴点 */}
          <circle cx={160} cy={160} r={4} fill="var(--text-muted)" />
        </svg>

        {/* 中央大数字 & 音名 */}
        <div className={'tuner-cent-display' + (active && inTune ? ' in-tune' : '')}>
          {active && pitch ? (
            <>
              {centsFromTarget > 0 ? `+${centsFromTarget}` : centsFromTarget}
              {inTune && ' ✓'}
            </>
          ) : (
            '—'
          )}
        </div>
        <div className="tuner-note-display">
          {active && pitch && targetString
            ? `${targetString.name} · ${pitch.freq.toFixed(1)} Hz`
            : active
              ? '正在听… 弹一下吧'
              : '点击"开始调音"启用麦克风'}
        </div>
      </div>

      {/* 6 弦按钮（3 列网格，弦序 6→1） */}
      <div className="section-title" style={{ marginTop: 18 }}>标准调弦参考</div>
      <div className="tuner-strings-grid">
        {STRINGS.map((s, i) => {
          const isActive = lastPlayedString === s.stringNo;
          const isTuned = tunedSet.has(s.stringNo);
          const lastCents = perStringCents[s.stringNo];
          const hasBigDrift = typeof lastCents === 'number' && Math.abs(lastCents) > 15;

          let statusEl: React.ReactNode;
          if (isTuned) {
            statusEl = <span className="ts-status ok">✓ 已调准</span>;
          } else if (hasBigDrift) {
            const sign = (lastCents as number) > 0 ? '+' : '';
            statusEl = <span className="ts-status bad">⚠ 偏 {sign}{lastCents}¢</span>;
          } else {
            statusEl = <span className="ts-status idle">点击试听</span>;
          }

          return (
            <button
              key={s.name}
              type="button"
              className={'tuner-string-card' + (isActive ? ' active' : '')}
              onClick={() => {
                setSelectedString(i === selectedString ? -1 : i);
                playReference(s);
              }}
              aria-label={`${s.label}，标准频率 ${s.freq.toFixed(1)} Hz`}
            >
              <div className="ts-name">{s.stringNo}{s.noteOnly}</div>
              <div className="ts-freq">{s.freq.toFixed(1)} Hz</div>
              {statusEl}
            </button>
          );
        })}
      </div>

      {selectedString >= 0 && (
        <p className="fretboard-hint" style={{ textAlign: 'center', marginTop: 8 }}>
          已锁定 {STRINGS[selectedString].label}。再次点击取消锁定（自动检测）。
        </p>
      )}

      {/* 使用说明 */}
      <div className="section-title">使用方法</div>
      <div className="card">
        <p><b>1.</b> 点击「开始调音」允许麦克风权限。</p>
        <p><b>2.</b> 弹一根弦，仪表盘指针会实时显示偏差（±50 cent）。</p>
        <p><b>3.</b> 指针居中变绿 = 音准了。偏左偏低需拧紧，偏右偏高需松开。</p>
        <p><b>4.</b> 也可以点击下方弦卡片听标准音，用耳朵比对。</p>
        <p><b>5.</b> 6 根都调准后会自动弹出"全部调准"提示。</p>
      </div>

      {/* 全部调准成功卡 */}
      {showSuccess && (
        <div className="tuner-success-card" role="status" aria-live="polite">
          <div className="tsc-emoji">🎉</div>
          <div className="tsc-title">全部调准！</div>
          <div className="tsc-sub">可以开始练习了</div>
          <div className="tsc-actions">
            <button className="btn btn-sm btn-primary" onClick={() => location.hash = '#/practice/daily'}>做今日 5 分钟</button>
            <button className="btn btn-sm btn-ghost" onClick={() => location.hash = '#/practice'}>去训练中心</button>
          </div>
        </div>
      )}
    </div>
  );
}
