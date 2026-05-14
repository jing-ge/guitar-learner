// 离线鼓机音色合成器（Web Audio API）
// 不依赖任何采样，所有音色用振荡器 + 噪声 + 滤波器实时合成
// 提供：kick / snare / hihat(closed) / openhat / clap / ride / crash / tom-low / tom-mid / tom-high

import { getSharedAudioContext, unlockSharedContext } from './audio-ctx';

export type DrumVoice =
  | 'kick'
  | 'snare'
  | 'hihat'
  | 'openhat'
  | 'clap'
  | 'ride'
  | 'crash'
  | 'tomL'
  | 'tomM'
  | 'tomH';

class DrumMachine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private initialized = false;

  private getCtx(): AudioContext {
    if (!this.initialized) {
      this.ctx = getSharedAudioContext();

      // 限制器，避免削顶
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 10;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;

      const master = this.ctx.createGain();
      master.gain.value = 0.85;

      master.connect(limiter);
      limiter.connect(this.ctx.destination);
      this.master = master;

      // 预生成一段白噪声 buffer 复用
      const len = Math.floor(this.ctx.sampleRate * 1.5);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      this.initialized = true;
    }
    return this.ctx!;
  }

  async unlock(): Promise<void> {
    this.getCtx();
    await unlockSharedContext();
  }

  setVolume(v: number) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  getCurrentTime(): number {
    return this.getCtx().currentTime;
  }

  private noiseSource(): AudioBufferSourceNode {
    const ctx = this.getCtx();
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    src.loop = false;
    return src;
  }

  /** 主调度入口 */
  play(voice: DrumVoice, when = 0, vel = 1.0) {
    const ctx = this.getCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t = (when > 0 ? when : ctx.currentTime);
    switch (voice) {
      case 'kick':     return this.playKick(t, vel);
      case 'snare':    return this.playSnare(t, vel);
      case 'hihat':    return this.playHat(t, vel, false);
      case 'openhat':  return this.playHat(t, vel, true);
      case 'clap':     return this.playClap(t, vel);
      case 'ride':     return this.playRide(t, vel);
      case 'crash':    return this.playCrash(t, vel);
      case 'tomL':     return this.playTom(t, vel, 90);
      case 'tomM':     return this.playTom(t, vel, 160);
      case 'tomH':     return this.playTom(t, vel, 240);
    }
  }

  /** 底鼓：60Hz 正弦音 + 快速频率下滑 + 极短瞬态 */
  private playKick(t: number, vel: number) {
    const ctx = this.getCtx();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

    // 加一点点击（瞬态）
    const click = this.noiseSource();
    const clickHP = ctx.createBiquadFilter();
    clickHP.type = 'highpass';
    clickHP.frequency.value = 2500;
    const clickG = ctx.createGain();
    clickG.gain.setValueAtTime(0.25 * vel, t);
    clickG.gain.exponentialRampToValueAtTime(0.001, t + 0.02);

    osc.connect(g); g.connect(this.master!);
    click.connect(clickHP); clickHP.connect(clickG); clickG.connect(this.master!);

    osc.start(t); osc.stop(t + 0.4);
    click.start(t); click.stop(t + 0.04);
  }

  /** 军鼓：低频"咚" + 高频噪声 */
  private playSnare(t: number, vel: number) {
    const ctx = this.getCtx();
    // 低频部分
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.4 * vel, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

    // 噪声部分
    const n = this.noiseSource();
    const nf = ctx.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 1500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    osc.connect(og); og.connect(this.master!);
    n.connect(nf); nf.connect(ng); ng.connect(this.master!);

    osc.start(t); osc.stop(t + 0.15);
    n.start(t); n.stop(t + 0.2);
  }

  /** 踩镲（闭/开） */
  private playHat(t: number, vel: number, open: boolean) {
    const ctx = this.getCtx();
    const n = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 10000;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    const dur = open ? 0.32 : 0.06;
    g.gain.setValueAtTime((open ? 0.35 : 0.45) * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this.master!);
    n.start(t); n.stop(t + dur + 0.02);
  }

  /** 拍手：噪声 + 多次快速触发模拟群体拍手 */
  private playClap(t: number, vel: number) {
    const ctx = this.getCtx();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    [0, 0.012, 0.024, 0.038].forEach((off, i) => {
      const peak = (i === 3 ? 0.6 : 0.4) * vel;
      g.gain.setValueAtTime(peak, t + off);
      g.gain.exponentialRampToValueAtTime(0.001, t + off + 0.04);
    });
    g.gain.setValueAtTime(0.4 * vel, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

    const n = this.noiseSource();
    n.connect(bp); bp.connect(g); g.connect(this.master!);
    n.start(t); n.stop(t + 0.2);
  }

  /** 叮叮镲（Ride）：金属感的高频泛音 */
  private playRide(t: number, vel: number) {
    const ctx = this.getCtx();
    const partials = [800, 1200, 1800, 2400, 3200];
    partials.forEach(f => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.04 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 1.5;
      bp.Q.value = 4;
      osc.connect(bp); bp.connect(g); g.connect(this.master!);
      osc.start(t); osc.stop(t + 0.55);
    });
    // 顶部点亮"叮"
    const n = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5000;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.15 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    n.connect(hp); hp.connect(ng); ng.connect(this.master!);
    n.start(t); n.stop(t + 0.3);
  }

  /** 大镲（Crash）：长尾噪声扩散 */
  private playCrash(t: number, vel: number) {
    const ctx = this.getCtx();
    const n = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4500;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 8000;
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this.master!);
    n.start(t); n.stop(t + 1.3);
  }

  /** 嗵鼓（Tom）：基频可调 */
  private playTom(t: number, vel: number, freq: number) {
    const ctx = this.getCtx();
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.8, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.connect(g); g.connect(this.master!);
    osc.start(t); osc.stop(t + 0.45);
  }
}

export const drum = new DrumMachine();