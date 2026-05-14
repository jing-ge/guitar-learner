import { useEffect, useRef, useState, useCallback } from 'react';
import { pitchDetector, type PitchResult } from '../audio/pitch-detector';
import { midiToFreq } from '../theory/notes';
import { synth } from '../audio/synth';

// 标准调弦 6 弦信息
const STRINGS = [
  { name: 'E2', label: '6弦 E', midi: 40, freq: 82.41 },
  { name: 'A2', label: '5弦 A', midi: 45, freq: 110.00 },
  { name: 'D3', label: '4弦 D', midi: 50, freq: 146.83 },
  { name: 'G3', label: '3弦 G', midi: 55, freq: 196.00 },
  { name: 'B3', label: '2弦 B', midi: 59, freq: 246.94 },
  { name: 'E4', label: '1弦 E', midi: 64, freq: 329.63 },
];

export default function TunerPage() {
  const [active, setActive] = useState(false);
  const [pitch, setPitch] = useState<PitchResult | null>(null);
  const [error, setError] = useState('');
  const [selectedString, setSelectedString] = useState(-1); // -1 = 自动检测

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

  const toggleTuner = useCallback(async () => {
    if (active) {
      pitchDetector.stop();
      setActive(false);
      setPitch(null);
      return;
    }
    setError('');
    try {
      await pitchDetector.start((result) => setPitch(result));
      setActive(true);
    } catch {
      setError('无法访问麦克风，请在浏览器设置中允许麦克风权限。');
    }
  }, [active]);

  // 页面卸载时停止
  useEffect(() => {
    return () => { pitchDetector.stop(); };
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

      {/* 启动按钮 */}
      <div style={{ textAlign: 'center', marginBottom: 14 }}>
        <button className={'btn ' + (active ? '' : 'btn-primary')} style={{ width: 200 }} onClick={toggleTuner}>
          {active ? '■ 停止调音' : '🎤 开始调音'}
        </button>
        {error && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</div>}
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
          <div className="tuner-note" style={{ color: 'var(--text-dim)', fontSize: 18 }}>正在听…请弹一根弦</div>
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