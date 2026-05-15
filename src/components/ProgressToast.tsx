import { useEffect, useRef, useState } from 'react';
import { vibrate } from '../utils/haptic';

/**
 * 全局进度提示 Toast。
 * 任何模块调用：
 *   window.dispatchEvent(new CustomEvent('progress-recorded', { detail: { text: '...' } }));
 * 即可触发显示，约 1.8s 后自动消失。
 */
export default function ProgressToast() {
  const [text, setText] = useState('');
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const onRecorded = (e: Event) => {
      const detail = (e as CustomEvent).detail as { text?: string } | undefined;
      const t = detail?.text || '';
      if (!t) return;
      setText(t);
      setVisible(true);
      vibrate(15);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setVisible(false), 1800);
    };
    window.addEventListener('progress-recorded', onRecorded as EventListener);
    return () => {
      window.removeEventListener('progress-recorded', onRecorded as EventListener);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div className={'progress-toast' + (visible ? ' show' : '')} role="status" aria-live="polite">
      <span className="check">✓</span>
      <span>{text.replace(/^\s*[\u2713\u2714✓]\s*/, '')}</span>
    </div>
  );
}
