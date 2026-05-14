// 民谣吉他音色合成器（Web Audio API）
// 加法合成：基频 + 多个谐波，每个谐波独立的振幅包络 + 衰减率
// 完全离线，可控、不会爆音

import { midiToFreq, fretToMidi } from '../theory/notes';
import { getSharedAudioContext, unlockSharedContext } from './audio-ctx';

class GuitarSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private initialized = false;

  private getCtx(): AudioContext {
    if (!this.initialized) {
      this.ctx = getSharedAudioContext();

      // 总线入口
      const bus = this.ctx.createGain();
      bus.gain.value = 1.0;

      // 琴箱共鸣（200Hz 木质感）
      const body = this.ctx.createBiquadFilter();
      body.type = 'peaking';
      body.frequency.value = 220;
      body.gain.value = 2.5;
      body.Q.value = 1.0;

      // 中频在场感
      const presence = this.ctx.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.value = 1200;
      presence.gain.value = 1.5;
      presence.Q.value = 1.0;

      // 高频温暖（去掉刺耳成分）
      const air = this.ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = 4500;
      air.Q.value = 0.5;

      // 砍掉极低频
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 70;
      hp.Q.value = 0.5;

      // 限制器
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.knee.value = 8;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;

      const master = this.ctx.createGain();
      master.gain.value = 0.6;

      bus.connect(body);
      body.connect(presence);
      presence.connect(air);
      air.connect(hp);
      hp.connect(master);
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

  setVolume(v: number) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  getCurrentTime(): number {
    return this.getCtx().currentTime;
  }

  /**
   * 加法合成拨弦音
   * - 多个正弦谐波（1, 2, 3, 4, 5, 6 倍频）叠加
   * - 振幅按 1/n^1.3 自然衰减（与真实吉他频谱相近）
   * - 每个谐波独立的指数衰减（基频尾音长、高次衰减快）
   * - 严格振幅归一化，绝不爆音
   */
  playFreq(freq: number, durationSec = 3.0, vol = 0.4, when = 0) {
    const ctx = this.getCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + when;
    const busNode = this.bus!;

    // 谐波配置：[倍频, 相对振幅, 衰减时间倍率]
    const harmonics: { n: number; amp: number; decayMult: number }[] = [
      { n: 1, amp: 1.00, decayMult: 1.00 },  // 基频：完整衰减
      { n: 2, amp: 0.45, decayMult: 0.80 },  // 八度：略短
      { n: 3, amp: 0.22, decayMult: 0.60 },
      { n: 4, amp: 0.12, decayMult: 0.45 },
      { n: 5, amp: 0.07, decayMult: 0.35 },
      { n: 6, amp: 0.04, decayMult: 0.25 },
    ];

    // 归一化：所有谐波振幅总和不超过 1
    const totalAmp = harmonics.reduce((sum, h) => sum + h.amp, 0);
    const norm = 0.55 / totalAmp; // 单根弦最大振幅 0.55，6 弦叠加最大 3.3，由 limiter 压住

    const nodes: AudioNode[] = [];

    for (const h of harmonics) {
      const f = freq * h.n;
      if (f > 6000) continue; // 6kHz 以上不合成（节省 CPU）

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t0);

      const g = ctx.createGain();
      const peakVol = vol * h.amp * norm;
      const decay = Math.max(0.3, durationSec * h.decayMult);

      // ADSR 包络：5ms 起音 → 指数衰减
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peakVol, t0 + 0.005);
      // setTargetAtTime 给自然指数衰减，时间常数 = decay/3（约 5倍衰减期内归零）
      g.gain.setTargetAtTime(0, t0 + 0.01, decay / 3);

      osc.connect(g);
      g.connect(busNode);
      osc.start(t0);
      // 振荡器在尾音明确归零后停止
      osc.stop(t0 + decay + 0.5);

      nodes.push(osc, g);
    }

    // 一个非常短的"触弦噪声"瞬态（10ms），让音头更真实
    const tickLen = 0.012;
    const tickBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * tickLen), ctx.sampleRate);
    const tickData = tickBuf.getChannelData(0);
    for (let i = 0; i < tickData.length; i++) {
      const t = i / tickData.length;
      tickData[i] = (Math.random() * 2 - 1) * (1 - t);
    }
    const tickSrc = ctx.createBufferSource();
    tickSrc.buffer = tickBuf;
    const tickLP = ctx.createBiquadFilter();
    tickLP.type = 'lowpass';
    tickLP.frequency.value = Math.min(2500, freq * 4);
    tickLP.Q.value = 0.3;
    const tickGain = ctx.createGain();
    tickGain.gain.setValueAtTime(0, t0);
    tickGain.gain.linearRampToValueAtTime(vol * 0.05, t0 + 0.001);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + tickLen);
    tickSrc.connect(tickLP);
    tickLP.connect(tickGain);
    tickGain.connect(busNode);
    tickSrc.start(t0);
    tickSrc.stop(t0 + tickLen + 0.02);
    nodes.push(tickSrc, tickLP, tickGain);

    // 清理
    const totalLife = durationSec * 1.2 + 0.5;
    setTimeout(() => {
      for (const n of nodes) {
        try { n.disconnect(); } catch {}
      }
    }, (when + totalLife) * 1000);
  }

  playMidi(midi: number, durationSec = 3.0, when = 0) {
    this.playFreq(midiToFreq(midi), durationSec, 0.45, when);
  }

  playFret(stringNum: 1|2|3|4|5|6, fret: number, durationSec = 3.0, when = 0) {
    // 低音弦音量略大
    const volMap: Record<number, number> = { 6: 0.50, 5: 0.48, 4: 0.46, 3: 0.42, 2: 0.40, 1: 0.38 };
    const v = volMap[stringNum] ?? 0.42;
    this.playFreq(midiToFreq(fretToMidi(stringNum, fret)), durationSec, v, when);
  }

  strum(positions: { stringNum: 1|2|3|4|5|6; fret: number }[], opts: { direction?: 'down' | 'up'; duration?: number; spread?: number; when?: number } = {}) {
    const { direction = 'down', duration = 3.0, spread = 0.022, when = 0 } = opts;
    const sorted = [...positions].sort((a, b) =>
      direction === 'down' ? b.stringNum - a.stringNum : a.stringNum - b.stringNum
    );
    sorted.forEach((p, idx) => {
      const velRatio = direction === 'down'
        ? 1 - idx * 0.04
        : 0.85 - idx * 0.03;
      // 6 弦同时弹时，单根弦的有效音量要相应降低（避免叠加爆音）
      const stringVolMap: Record<number, number> = { 6: 0.42, 5: 0.40, 4: 0.38, 3: 0.35, 2: 0.32, 1: 0.30 };
      const baseVol = stringVolMap[p.stringNum] ?? 0.35;
      // 低音弦尾音更长（真实吉他物理特性）
      const stringDurMult: Record<number, number> = { 6: 1.15, 5: 1.10, 4: 1.05, 3: 1.0, 2: 0.95, 1: 0.90 };
      const dur = duration * (stringDurMult[p.stringNum] ?? 1.0);
      this.playFreq(midiToFreq(fretToMidi(p.stringNum, p.fret)), dur, baseVol * Math.max(0.65, velRatio), when + idx * spread);
    });
  }

  /** 节拍器 click */
  click(accent = false, when = 0) {
    const ctx = this.getCtx();
    const now = when > 0 ? when : ctx.currentTime;
    const busNode = this.bus!;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = accent ? 880 : 660;
    osc.frequency.exponentialRampToValueAtTime(accent ? 440 : 330, now + 0.04);

    const g = ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.45 : 0.30, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = (Math.PI + 3) * x / (Math.PI + 3 * Math.abs(x));
    }
    shaper.curve = curve;
    shaper.oversample = 'none';

    osc.connect(shaper);
    shaper.connect(g);
    g.connect(busNode);
    osc.start(now);
    osc.stop(now + 0.08);

    setTimeout(() => {
      try { osc.disconnect(); shaper.disconnect(); g.disconnect(); } catch {}
    }, 200);
  }
}

export const synth = new GuitarSynth();