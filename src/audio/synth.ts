// 民谣吉他音色合成器（Web Audio API）
// 多谐波叠加 + 琴体共鸣滤波 + 温暖低通 → 接近真实民谣吉他拨弦
// 完全离线，无需音频样本

import { midiToFreq, fretToMidi } from '../theory/notes';

class GuitarSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bodyFilter: BiquadFilterNode | null = null;
  private warmth: BiquadFilterNode | null = null;
  private unlocked = false;

  private getCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      this.ctx = new Ctor();

      // 温暖滤波：砍掉高频毛刺
      const warmth = this.ctx.createBiquadFilter();
      warmth.type = 'lowpass';
      warmth.frequency.value = 3500;
      warmth.Q.value = 0.5;

      // 琴体共鸣：低频加厚
      const body = this.ctx.createBiquadFilter();
      body.type = 'peaking';
      body.frequency.value = 180;
      body.gain.value = 4;
      body.Q.value = 1.2;

      // 限制器（DynamicsCompressor）—— 防止音量调高后削顶失真
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;

      // 主音量（提升到 1.4 — 比原 0.45 大 3 倍多）
      const master = this.ctx.createGain();
      master.gain.value = 1.4;

      // 连接链：body → warmth → limiter → master → destination
      body.connect(warmth);
      warmth.connect(limiter);
      limiter.connect(master);
      master.connect(this.ctx.destination);

      this.master = master;
      this.bodyFilter = body;
      this.warmth = warmth;
    }
    return this.ctx;
  }

  /** 获取混音总线入口（body → warmth → master → dest） */
  private getBus(): AudioNode {
    this.getCtx();
    return this.bodyFilter!;
  }

  /** 解锁音频（iOS Safari & Android Chrome 都需要用户手势） */
  async unlock(): Promise<void> {
    const ctx = this.getCtx();
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch {}
    }
    if (!this.unlocked) {
      const buf = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(ctx.destination);
      try { s.start(0); } catch {}
      this.unlocked = true;
    }
  }

  setVolume(v: number) {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  /**
   * 核心：民谣吉他拨弦音
   * 原理：用多个谐波正弦（基频 + 2/3/4/5 倍频）叠加出拨弦初始音色，
   * 每个谐波按不同衰减速率消失（高次衰减更快），再经全局温暖滤波 + 琴体共鸣。
   */
  playFreq(freq: number, durationSec = 2.0, vol = 0.55, when = 0) {
    const ctx = this.getCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + when;
    const bus = this.getBus();

    // 谐波参数：[倍频, 相对振幅, 衰减时间比例]
    // 民谣吉他特点：基频强、偶次谐波明显、高次衰减快
    const harmonics: [number, number, number][] = [
      [1,   1.0,  1.0 ],   // 基频
      [2,   0.48, 0.72],   // 二倍频（八度泛音）
      [3,   0.22, 0.50],   // 三倍频
      [4,   0.12, 0.35],   // 四倍频
      [5,   0.06, 0.25],   // 五倍频
      [6,   0.03, 0.18],   // 六倍频（很快消失）
    ];

    // 短噪声模拟指尖/拨片的"触弦"瞬态（非常短）
    const clickLen = 0.04;
    const clickBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * clickLen), ctx.sampleRate);
    const clickData = clickBuf.getChannelData(0);
    for (let i = 0; i < clickData.length; i++) {
      const t = i / clickData.length;
      clickData[i] = (Math.random() * 2 - 1) * (1 - t) * 0.3;
    }
    const clickSrc = ctx.createBufferSource();
    clickSrc.buffer = clickBuf;
    const clickFilt = ctx.createBiquadFilter();
    clickFilt.type = 'bandpass';
    clickFilt.frequency.value = Math.min(freq * 3, 4000);
    clickFilt.Q.value = 0.6;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0, t0);
    clickGain.gain.linearRampToValueAtTime(vol * 0.35, t0 + 0.002);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t0 + clickLen - 0.005);
    clickGain.gain.linearRampToValueAtTime(0, t0 + clickLen);
    
    clickSrc.connect(clickFilt);
    clickFilt.connect(clickGain);
    clickGain.connect(bus);
    clickSrc.start(t0);
    clickSrc.stop(t0 + clickLen + 0.05);

    // 各谐波振荡器
    const nodes: (OscillatorNode | GainNode)[] = [clickSrc as any, clickFilt as any, clickGain];
    for (const [mult, amp, decayMult] of harmonics) {
      const f = freq * mult;
      if (f > 8000) continue; // 超过 8kHz 不合成（反正听不到什么）
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t0);
      // 轻微频率抖动模拟非线性（更自然）
      osc.frequency.linearRampToValueAtTime(f * 0.9992, t0 + durationSec * 0.8);

      const g = ctx.createGain();
      const peakVol = vol * amp;
      const decay = durationSec * decayMult;
      // 起音包络：极短的上升（~3ms）→ 指数衰减 → 完全归零（防止结束时爆音）
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(peakVol, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peakVol * 0.001), t0 + decay - 0.05);
      g.gain.linearRampToValueAtTime(0, t0 + decay);

      osc.connect(g);
      g.connect(bus);
      osc.start(t0);
      osc.stop(t0 + decay + 0.05);
      nodes.push(osc, g);
    }

    // 清理节点
    setTimeout(() => {
      for (const n of nodes) {
        try { n.disconnect(); } catch {}
      }
    }, (when + durationSec + 0.2) * 1000);
  }

  playMidi(midi: number, durationSec = 2.0, when = 0) {
    this.playFreq(midiToFreq(midi), durationSec, 0.55, when);
  }

  playFret(stringNum: 1|2|3|4|5|6, fret: number, durationSec = 2.0, when = 0) {
    // 低音弦音量略大、衰减略长，高音弦稍柔
    const volMap: Record<number, number> = { 6: 0.60, 5: 0.57, 4: 0.54, 3: 0.50, 2: 0.48, 1: 0.45 };
    const v = volMap[stringNum] ?? 0.50;
    this.playFreq(midiToFreq(fretToMidi(stringNum, fret)), durationSec, v, when);
  }

  strum(positions: { stringNum: 1|2|3|4|5|6; fret: number }[], opts: { direction?: 'down' | 'up'; duration?: number; spread?: number } = {}) {
    const { direction = 'down', duration = 2.5, spread = 0.028 } = opts;
    const sorted = [...positions].sort((a, b) =>
      direction === 'down' ? b.stringNum - a.stringNum : a.stringNum - b.stringNum
    );
    sorted.forEach((p, idx) => {
      this.playFret(p.stringNum, p.fret, duration, idx * spread);
    });
  }

  getCurrentTime(): number {
    return this.getCtx().currentTime;
  }

  /** 节拍器 click —— 用短正弦脉冲，模拟木块/木鱼的柔和敲击声 */
  click(accent = false, when = 0) {
    const ctx = this.getCtx();
    const now = when > 0 ? when : ctx.currentTime;
    const bus = this.getBus();

    // 正弦脉冲（不用方波，避免刺耳）
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = accent ? 880 : 660;

    // 快速的频率下滑，模拟木块敲击的"嗒"声
    osc.frequency.exponentialRampToValueAtTime(accent ? 440 : 330, now + 0.04);

    const g = ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.45 : 0.30, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    // 轻微失真让音色更有"木质感"
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 128) - 1;
      curve[i] = (Math.PI + 3) * x / (Math.PI + 3 * Math.abs(x)); // soft clip
    }
    shaper.curve = curve;
    shaper.oversample = 'none';

    osc.connect(shaper);
    shaper.connect(g);
    g.connect(bus);
    osc.start(now);
    osc.stop(now + 0.08);

    setTimeout(() => {
      try { osc.disconnect(); shaper.disconnect(); g.disconnect(); } catch {}
    }, 200);
  }
}

export const synth = new GuitarSynth();