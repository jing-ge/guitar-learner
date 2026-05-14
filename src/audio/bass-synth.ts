// 贝斯音色合成器（Web Audio API）
// 厚实低音 + 短瞬态 + 中频泛音
// 模拟电贝斯指弹音色

import { midiToFreq } from '../theory/notes';
import { getSharedAudioContext, unlockSharedContext } from './audio-ctx';

class BassSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private initialized = false;

  private getCtx(): AudioContext {
    if (!this.initialized) {
      this.ctx = getSharedAudioContext();

      const bus = this.ctx.createGain();
      bus.gain.value = 1.0;

      // 砍掉 30Hz 以下的隆隆低频
      const subHP = this.ctx.createBiquadFilter();
      subHP.type = 'highpass';
      subHP.frequency.value = 35;

      // 80Hz 加厚
      const lowBoost = this.ctx.createBiquadFilter();
      lowBoost.type = 'peaking';
      lowBoost.frequency.value = 80;
      lowBoost.gain.value = 3;
      lowBoost.Q.value = 1.0;

      // 中频泛音稍弱（让贝斯不抢吉他的中频）
      const midCut = this.ctx.createBiquadFilter();
      midCut.type = 'peaking';
      midCut.frequency.value = 800;
      midCut.gain.value = -2;
      midCut.Q.value = 0.8;

      // 高频稍亮（指弹的"咚"感）
      const air = this.ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = 2200;
      air.Q.value = 0.5;

      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 14;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;

      const master = this.ctx.createGain();
      master.gain.value = 0.55;

      bus.connect(subHP);
      subHP.connect(lowBoost);
      lowBoost.connect(midCut);
      midCut.connect(air);
      air.connect(master);
      master.connect(limiter);
      limiter.connect(this.ctx.destination);

      this.master = master;
      this.bus = bus;
      this.initialized = true;
    }
    return this.ctx!;
  }

  async unlock(): Promise<void> {
    this.getCtx();
    await unlockSharedContext();
  }

  getCurrentTime(): number {
    return this.getCtx().currentTime;
  }

  setVolume(v: number) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  /** 弹一个贝斯音（midi 通常在 28-55 之间，对应 E1-G3） */
  playMidi(midi: number, durationSec = 0.6, vol = 0.7, when = 0) {
    const ctx = this.getCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + when;
    const busNode = this.bus!;
    const freq = midiToFreq(midi);

    // 贝斯：基频强 + 二倍频中等 + 三倍频弱
    const harmonics = [
      { n: 1, amp: 1.00, decay: 1.00 },
      { n: 2, amp: 0.35, decay: 0.70 },
      { n: 3, amp: 0.15, decay: 0.45 },
    ];

    const norm = 0.65 / (harmonics.reduce((s, h) => s + h.amp, 0));
    const nodes: AudioNode[] = [];

    for (const h of harmonics) {
      const f = freq * h.n;
      if (f > 3000) continue;
      const osc = ctx.createOscillator();
      // 基频用 triangle 模拟指弹的厚实，泛音用 sine
      osc.type = h.n === 1 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(f, t0);

      const g = ctx.createGain();
      const peakVol = vol * h.amp * norm;
      const decay = Math.max(0.2, durationSec * h.decay);
      // 起音 4ms（贝斯音头略硬于吉他）
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peakVol, t0 + 0.004);
      g.gain.setTargetAtTime(0, t0 + 0.01, decay / 3);

      osc.connect(g);
      g.connect(busNode);
      osc.start(t0);
      osc.stop(t0 + decay + 0.3);
      nodes.push(osc, g);
    }

    setTimeout(() => {
      for (const n of nodes) {
        try { n.disconnect(); } catch {}
      }
    }, (when + durationSec * 1.3 + 0.5) * 1000);
  }
}

export const bass = new BassSynth();