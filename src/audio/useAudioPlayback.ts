/**
 * Round 52: 录音回放 hook
 *
 * 用 HTML5 <audio> 元素 (不用 AudioBufferSourceNode), 自带可恢复 pause + seek
 * RAF 驱动 currentSec 用于外部 UI 同步 (时间游标 + 当前和弦/音符高亮)
 *
 * 调用方:
 *   const playback = useAudioPlayback(audioBlob);
 *   playback.play() / playback.pause() / playback.seek(sec)
 *   <ChordTimeline currentSec={playback.currentSec} />
 *
 * 资源生命周期:
 *   - blob 变化 → 创建新 blob URL + revoke 旧的
 *   - unmount → revoke URL + pause + release audio
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface AudioPlaybackHandle {
  /** 是否正在播放 */
  playing: boolean;
  /** 当前播放秒数 */
  currentSec: number;
  /** 音频总时长 (秒) */
  durationSec: number;
  /** 是否已加载就绪 (metadata loaded) */
  ready: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** seek 到指定秒数 (0 ~ durationSec) */
  seek: (sec: number) => void;
}

export function useAudioPlayback(blob: Blob | null): AudioPlaybackHandle {
  const [playing, setPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [ready, setReady] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);

  // 创建 audio + blob URL, blob 变化时重建
  useEffect(() => {
    if (!blob) {
      // 清理旧资源
      if (audioRef.current) {
        try { audioRef.current.pause(); } catch {}
        audioRef.current = null;
      }
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setPlaying(false);
      setCurrentSec(0);
      setDurationSec(0);
      setReady(false);
      return;
    }

    const url = URL.createObjectURL(blob);
    urlRef.current = url;

    const audio = new Audio(url);
    audio.preload = 'auto';
    audioRef.current = audio;

    const onLoaded = () => {
      // duration 在 metadata loaded 时可读, 但 MediaRecorder 的 webm 有时 duration=Infinity
      // 兜底: 用 seek 大数 trick 触发实际 duration 计算
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) {
        setDurationSec(d);
        setReady(true);
      } else {
        // webm/opus 已知 bug: duration=Infinity 时 seek 到 1e9 后 audio 内部会矫正
        audio.currentTime = 1e9;
        const onTimeUpdate = () => {
          audio.removeEventListener('timeupdate', onTimeUpdate);
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            setDurationSec(audio.duration);
          }
          audio.currentTime = 0;
          setReady(true);
        };
        audio.addEventListener('timeupdate', onTimeUpdate);
      }
    };
    const onEnded = () => {
      setPlaying(false);
      setCurrentSec(audio.duration || 0);
    };
    const onError = () => {
      console.warn('[round52] audio playback error');
      setReady(false);
    };

    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      try { audio.pause(); } catch {}
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      URL.revokeObjectURL(url);
      if (urlRef.current === url) urlRef.current = null;
    };
  }, [blob]);

  // RAF 驱动 currentSec (仅在 playing 时跑)
  useEffect(() => {
    if (!playing || !audioRef.current) return;
    const tick = () => {
      const a = audioRef.current;
      if (!a) return;
      setCurrentSec(a.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [playing]);

  const play = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    // Round 52 oracle #1: 立即乐观更新 playing=true, 不等 promise
    // 避免 audio.play() 返回前 UI 卡 200ms 才显示游标动
    setPlaying(true);
    a.play().catch(err => {
      console.warn('[round52] audio.play() failed', err);
      setPlaying(false);  // 失败回滚
    });
  }, []);

  const pause = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    setPlaying(false);
    setCurrentSec(a.currentTime);
  }, []);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, play, pause]);

  const seek = useCallback((sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    const clamped = Math.max(0, Math.min(durationSec || 1e9, sec));
    a.currentTime = clamped;
    setCurrentSec(clamped);
  }, [durationSec]);

  return { playing, currentSec, durationSec, ready, play, pause, toggle, seek };
}
