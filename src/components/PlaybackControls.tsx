/**
 * Round 52: 录音回放控件
 *
 * 大圆播放按钮 (▶ / ⏸) + 进度条 (clickable seek) + 时间显示 (current / total)
 *
 * 输入: useAudioPlayback hook 返回的 handle
 * 输出: 控件 UI, 用户交互直接调 handle.play/pause/seek
 */
import { useCallback, useRef } from 'react';
import type { AudioPlaybackHandle } from '../audio/useAudioPlayback';

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface Props {
  playback: AudioPlaybackHandle;
}

export default function PlaybackControls({ playback }: Props) {
  const { playing, currentSec, durationSec, ready, toggle, seek } = playback;
  const progressBarRef = useRef<HTMLDivElement | null>(null);

  // 点击/拖拽进度条 → seek
  const handleProgressClick = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const bar = progressBarRef.current;
    if (!bar || !durationSec) return;
    const rect = bar.getBoundingClientRect();
    let clientX: number;
    if ('touches' in e) {
      if (e.touches.length === 0) return;
      clientX = e.touches[0].clientX;
    } else {
      clientX = e.clientX;
    }
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seek(ratio * durationSec);
  }, [durationSec, seek]);

  const progressRatio = durationSec > 0 ? Math.min(1, currentSec / durationSec) : 0;

  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
      {/* 播放/暂停按钮 */}
      <button
        onClick={toggle}
        disabled={!ready}
        aria-label={playing ? '暂停' : '播放'}
        style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'var(--brand)',
          color: '#fff', fontSize: 22, fontWeight: 700,
          border: 'none', cursor: ready ? 'pointer' : 'not-allowed',
          opacity: ready ? 1 : 0.5,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
        }}
      >{playing ? '⏸' : '▶'}</button>

      {/* 进度条 + 时间 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* 时间显示 */}
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 11, color: 'var(--text-muted)', marginBottom: 4,
          fontFamily: 'ui-monospace, monospace',
        }}>
          <span>{formatTime(currentSec)}</span>
          <span>{formatTime(durationSec)}</span>
        </div>

        {/* 进度条 (clickable seek + touch drag) */}
        <div
          ref={progressBarRef}
          onClick={handleProgressClick}
          onTouchStart={handleProgressClick}
          onTouchMove={handleProgressClick}
          role="slider"
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={durationSec || 1}
          aria-valuenow={currentSec}
          style={{
            position: 'relative',
            height: 12, borderRadius: 6,
            background: 'var(--bg-soft)',
            border: '1px solid var(--line-soft)',
            cursor: ready ? 'pointer' : 'not-allowed',
            overflow: 'hidden',
            // 增大触控区, 不影响视觉
            padding: '8px 0', margin: '-8px 0',
          }}
        >
          <div style={{
            position: 'absolute', left: 0, top: 8, bottom: 8,
            width: `${progressRatio * 100}%`,
            background: 'var(--brand)',
            borderRadius: 6,
            transition: playing ? 'none' : 'width 0.1s',
            pointerEvents: 'none',
          }} />
          {/* 游标圆点 */}
          <div style={{
            position: 'absolute',
            left: `${progressRatio * 100}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 14, height: 14, borderRadius: '50%',
            background: 'var(--brand)',
            border: '2px solid var(--bg-elev-1, #fff)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
            pointerEvents: 'none',
          }} />
        </div>
      </div>
    </div>
  );
}
