// 全局共享的 AudioContext，让 synth 和 drum 使用同一时间基准
// 这样调度时可以用同一个 currentTime，避免不同步

let _ctx: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext {
  if (!_ctx) {
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    _ctx = new Ctor();
  }
  return _ctx;
}

export async function unlockSharedContext(): Promise<void> {
  const ctx = getSharedAudioContext();
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch {}
  }
  // iOS Safari 需要静音 buffer 启动
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.connect(ctx.destination);
    s.start(0);
  } catch {}
}