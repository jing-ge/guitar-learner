import { useEffect, useRef, useState, useCallback } from 'react';
import { pitchDetector, type PitchResult } from '../audio/pitch-detector';
import { midiToFreq } from '../theory/notes';
import { synth } from '../audio/synth';
import { recordSession } from '../utils/progress';
import MicPermissionState, { type MicPermState } from '../components/MicPermissionState';

// 标准调弦 6 弦信息
const STRINGS = [
  { name: 'E2', label: '6弦 E', midi: 40, freq: 82.41 },
  { name: 'A2', label: '5弦 A', midi: 45, freq: 110.00 },
  { name: 'D3', label: '4弦 D', midi: 50, freq: 146.83 },
  { name: 'G3', label: '3弦 G', midi: 55, freq: 196.00 },
  { name: 'B3', label: '2弦 B', midi: 59, freq: 246.94 },
  { name: 'E4', label: '1弦 E', midi: 64, freq: 329.63 },
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

  // 进度记录相关
  const recordedRef = useRef(false);
  const sessionStartRef = useRef<number>(0);
  const inTuneStableRef = useRef(0);
  // 用 ref 保存最新的 active 状态，便于 cleanup 时读取
  const activeRef = useRef(false);

  // 最近的目标弦
  const targetString = selectedString >= 0
    ? STRINGS[selectedString]
    : pitch
      ? STRINGS.reduce((best, s) => Math.abs(s.midi - pitch.midi) < Math.abs(best.midi - pitch.midi) ? s : best, STRINGS[0])
      : null;

  // 相对于目标弦的偏差
  const centsFromTarget = pitch && targetString
    ? Math.round(1200 * Math.log2(pitch.freq / midiToFreq(targetString.midi)))
    : 0;

  const inTune = pitch && Math.abs(centsFromTarget) <= 5;
  const closeEnough = pitch && Math.abs(centsFromTarget) <= 15;

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

    await pitchDetector.start((result) => {
      setPitch(result);
      // 实时判定：连续 ~3 帧 ±5 cent
      if (result && targetStringRef.current) {
        const cents = Math.round(
          1200 * Math.log2(result.freq / midiToFreq(targetStringRef.current.midi))
        );
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
  };

  // 偏差仪表角度（-50 cent → -90°，+50 cent → +90°）
  const needleAngle = pitch ? Math.max(-90, Math.min(90, centsFromTarget * 1.8)) : 0;

  return (
    <div>
      <div className="card">
        <h2>🎛 调音器</h2>
        <p>使用手机麦克风实时检测弦音，帮你把吉他调准。调准后再进行听音/弹琴练习。</p>
      </div>

      <MicPermissionState state={micState} onRetry={startListen} />

      {/* 启动按钮 */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <button className={'btn ' + (active ? '' : 'btn-primary')} style={{ width: 200 }} onClick={toggleTuner}>
          {active ? '■ 停止调音' : '🎤 开始调音'}
        </button>
      </div>

      {/* 偏差仪表盘 */}
      <div className="tuner-gauge">
        <svg viewBox="0 0 300 170" style={{ width: '100%', maxWidth: 340, display: 'block', margin: '0 auto' }}>
          {/* 刻度弧 */}
          <path d="M 30 150 A 120 120 0 0 1 270 150" fill="none" stroke="#374151" strokeWidth={6} strokeLinecap="round" />
          {/* 绿色中心区（±5 cents） */}
          <path d="M 141 31 A 120 120 0 0 1 159 31" fill="none" stroke="var(--green)" strokeWidth={8} strokeLinecap="round" />

          {/* 刻度标记 */}
          {[-50, -25, 0, 25, 50].map(c => {
            const a = (c * 1.8 - 90) * Math.PI / 180;
            const r1 = 115, r2 = 125;
            return (
              <g key={c}>
                <line x1={150 + r1 * Math.cos(a)} y1={150 + r1 * Math.sin(a)} x2={150 + r2 * Math.cos(a)} y2={150 + r2 * Math.sin(a)} stroke="#6b7280" strokeWidth={2} />
                <text x={150 + 105 * Math.cos(a)} y={150 + 105 * Math.sin(a) + 3} fontSize={10} fill="#6b7280" textAnchor="middle">{c > 0 ? `+${c}` : c}</text>
              </g>
            );
          })}

          {/* 指针 */}
          {active && (
            <line
              x1={150} y1={150}
              x2={150 + 100 * Math.cos((needleAngle - 90) * Math.PI / 180)}
              y2={150 + 100 * Math.sin((needleAngle - 90) * Math.PI / 180)}
              stroke={inTune ? 'var(--green)' : closeEnough ? 'var(--primary)' : 'var(--danger)'}
              strokeWidth={3}
              strokeLinecap="round"
              style={{ transition: 'all .12s ease-out' }}
            />
          )}
          <circle cx={150} cy={150} r={6} fill={active ? (inTune ? 'var(--green)' : 'var(--primary)') : '#6b7280'} />
        </svg>
      </div>

      {/* 检测结果 */}
      <div className="tuner-result">
        {active && pitch ? (
          <>
            <div className="tuner-note" style={{ color: inTune ? 'var(--green)' : closeEnough ? 'var(--primary)' : 'var(--text)' }}>
              {pitch.noteOnly}<span className="tuner-octave">{pitch.noteName.replace(pitch.noteOnly, '')}</span>
            </div>
            <div className="tuner-freq">{pitch.freq.toFixed(1)} Hz</div>
            <div className="tuner-cents" style={{ color: inTune ? 'var(--green)' : centsFromTarget > 0 ? 'var(--danger)' : 'var(--accent)' }}>
              {inTune ? '准了！' : centsFromTarget > 0 ? `偏高 +${centsFromTarget} cent ↓ 松一点` : `偏低 ${centsFromTarget} cent ↑ 紧一点`}
            </div>
          </>
        ) : active ? (
          <div className="tuner-note" style={{ color: 'var(--text-muted)', fontSize: 16, lineHeight: '24px', textAlign: 'center' }}>正在听… 弹一下吧</div>
        ) : (
          <div className="tuner-note" style={{ color: 'var(--text-dim)', fontSize: 16 }}>点击"开始调音"启用麦克风</div>
        )}
      </div>

      {/* 6 弦快速选择 + 参考音 */}
      <div className="section-title">标准调弦参考</div>
      <div className="tuner-strings">
        {STRINGS.map((s, i) => {
          const isTarget = targetString?.midi === s.midi;
          return (
            <div key={s.name} className={'tuner-string-btn' + (isTarget && active ? ' active' : '')} onClick={() => { setSelectedString(i === selectedString ? -1 : i); }}>
              <div className="ts-name">{s.name}</div>
              <div className="ts-label">{s.label}</div>
              <div className="ts-freq">{s.freq.toFixed(0)} Hz</div>
              <button className="btn btn-sm" style={{ marginTop: 4 }} onClick={e => { e.stopPropagation(); playReference(s); }}>
                ▶ 播放
              </button>
            </div>
          );
        })}
      </div>

      {selectedString >= 0 && (
        <p className="fretboard-hint" style={{ textAlign: 'center', marginTop: 6 }}>
          已锁定 {STRINGS[selectedString].label}。再次点击取消锁定（自动检测）。
        </p>
      )}

      {/* 使用说明 */}
      <div className="section-title">使用方法</div>
      <div className="card">
        <p><b>1.</b> 点击「开始调音」允许麦克风权限。</p>
        <p><b>2.</b> 弹一根弦，仪表盘指针会实时显示偏差。</p>
        <p><b>3.</b> 指针居中（绿色）= 音准了。偏左偏低需拧紧，偏右偏高需松开。</p>
        <p><b>4.</b> 也可以点击下方「▶ 播放」听标准音，用耳朵比对。</p>
        <p><b>5.</b> 调准后再进入「音阶练习 → 弹琴识别」模式，app 就能准确识别你弹的音。</p>
      </div>
    </div>
  );
}
