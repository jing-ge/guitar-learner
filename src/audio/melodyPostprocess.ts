/**
 * Round 51: PitchMelodia 输出后处理
 *
 * 输入: PitchMelodia 每 ~2.9ms 一帧的 Hz 数组 (pitch[i] > 0 = 有音, 0 = 静音/无)
 * 输出: 紧凑的音符段数组 { midi, startSec, durSec, noteName }
 *
 * 算法流水线:
 *   1. Hz → MIDI 连续值 (log2)
 *   2. 量化到最近整数 MIDI (吉他/钢琴 12-TET 半音音格)
 *   3. 中值滤波 (window=5 帧) — 抑制颤音/瞬时跳变, 防止 C4-C#4-C4 抖动
 *   4. 合并相邻同 MIDI 帧成段
 *   5. 过滤短段 (< minDurMs, 默认 80ms)
 *   6. 合并相邻同 MIDI 段 (中间有 <gap 的静音可拼接)
 *
 * Round 51 oracle 风险 3 (压音符段是真正难点):
 *   - 颤音 (vibrato) 在 PitchMelodia 输出里是 ±50 cents 抖动
 *   - 滑音 (slide) 让 Hz 连续上下行, 量化后可能频繁切换 MIDI
 *   - 单元测试覆盖: 连续 100 帧 261Hz 内夹杂 3 帧 277Hz → 应输出一段 C4, 不是 C4-C#4-C4
 */

const HOP_MS = 128 / 44100 * 1000; // PitchMelodia 默认 hopSize=128 @ 44100Hz ≈ 2.9 ms/帧

export interface MelodyNote {
  /** MIDI 音高 (0-127), 60 = C4 */
  midi: number;
  /** 起始时间 (秒) */
  startSec: number;
  /** 持续时长 (秒) */
  durSec: number;
  /** 音名如 "C4", "F#3" */
  noteName: string;
}

export interface MelodyTrack {
  notes: MelodyNote[];
  /** 录音总时长 (秒) */
  durationSec: number;
  /** 音高范围, 用于 UI 绘图自动 fit */
  minMidi: number;
  maxMidi: number;
  /** 主调猜测 (后续可加, 当前留空) */
}

const SHARP_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

function midiToNoteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return SHARP_NAMES[pc] + octave;
}

function hzToMidiExact(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/** 中值滤波 (window 必须奇数, 边界用最近值填充) */
function medianFilter(arr: number[], window: number): number[] {
  if (window <= 1) return arr.slice();
  const half = Math.floor(window / 2);
  const out = new Array(arr.length);
  const buf: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    buf.length = 0;
    for (let k = -half; k <= half; k++) {
      const idx = i + k;
      if (idx >= 0 && idx < arr.length) buf.push(arr[idx]);
    }
    buf.sort((a, b) => a - b);
    out[i] = buf[Math.floor(buf.length / 2)];
  }
  return out;
}

/**
 * 后处理主入口
 *
 * @param pitchHz PitchMelodia 输出的 Hz 数组 (0 = 静音)
 * @param hopMs 帧步 (默认 2.9 ms)
 * @param minDurMs 最短音符段时长 (默认 80ms)
 * @param maxGapMs 相邻同 MIDI 段之间允许的最大静音 (默认 50ms)
 * @returns 音符段数组
 */
export function postprocessMelody(
  pitchHz: number[],
  hopMs: number = HOP_MS,
  minDurMs: number = 80,
  maxGapMs: number = 50,
): MelodyNote[] {
  if (pitchHz.length === 0) return [];

  // 1. Hz → 量化 MIDI (0 表示静音/无)
  const midis: number[] = new Array(pitchHz.length);
  for (let i = 0; i < pitchHz.length; i++) {
    if (pitchHz[i] <= 0) {
      midis[i] = 0;  // 静音占位
    } else {
      midis[i] = Math.round(hzToMidiExact(pitchHz[i]));
    }
  }

  // 2. 中值滤波 (只对有音帧, 静音保留为 0)
  // 简化做法: 整体 medianFilter, 静音(0) 会自然过滤掉孤立帧
  const smoothed = medianFilter(midis, 5);

  // 3. 合并相邻同 MIDI 帧成段
  const rawSegments: { midi: number; startFrame: number; endFrame: number }[] = [];
  let curMidi = -1;
  let curStart = -1;
  for (let i = 0; i < smoothed.length; i++) {
    const m = smoothed[i];
    if (m === curMidi) continue;
    if (curMidi > 0 && curStart >= 0) {
      rawSegments.push({ midi: curMidi, startFrame: curStart, endFrame: i });
    }
    curMidi = m;
    curStart = i;
  }
  if (curMidi > 0 && curStart >= 0) {
    rawSegments.push({ midi: curMidi, startFrame: curStart, endFrame: smoothed.length });
  }

  // 4. 过滤短段
  const minDurFrames = Math.ceil(minDurMs / hopMs);
  const filtered = rawSegments.filter(s => (s.endFrame - s.startFrame) >= minDurFrames);

  // 5. 合并相邻同 MIDI 段 (中间允许 ≤ maxGapMs 静音, 视为同一个音符延续)
  const maxGapFrames = Math.ceil(maxGapMs / hopMs);
  const merged: typeof filtered = [];
  for (const seg of filtered) {
    const last = merged[merged.length - 1];
    if (last && last.midi === seg.midi && (seg.startFrame - last.endFrame) <= maxGapFrames) {
      last.endFrame = seg.endFrame;
    } else {
      merged.push({ ...seg });
    }
  }

  // 6. 帧 → 秒 + 音名
  return merged.map(s => {
    const startSec = s.startFrame * hopMs / 1000;
    const durSec = (s.endFrame - s.startFrame) * hopMs / 1000;
    return {
      midi: s.midi,
      startSec,
      durSec,
      noteName: midiToNoteName(s.midi),
    };
  });
}

/** 计算音高范围 (用于 UI 自动 fit) */
export function getMelodyMidiRange(notes: MelodyNote[]): { minMidi: number; maxMidi: number } {
  if (notes.length === 0) return { minMidi: 60, maxMidi: 72 }; // 默认 C4-C5
  let minMidi = Infinity, maxMidi = -Infinity;
  for (const n of notes) {
    if (n.midi < minMidi) minMidi = n.midi;
    if (n.midi > maxMidi) maxMidi = n.midi;
  }
  // 上下各加 2 半音 padding, 让 UI 不挤边
  return { minMidi: minMidi - 2, maxMidi: maxMidi + 2 };
}
