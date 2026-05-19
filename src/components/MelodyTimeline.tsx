/**
 * Round 51: 主旋律时间轴可视化
 *
 * 输入: MelodyTrack {notes, durationSec, minMidi, maxMidi}
 * 输出:
 *   - 上方 SVG: X 轴 = 时间, Y 轴 = 音高, 每个音符 = 圆角矩形 + 音名
 *   - 下方文本: 纯音名序列 "C4 — D4 — E4 ..." 用户可复制
 *
 * 不做: 播放回放 / 时间游标 / 指板高亮 — 留 Round 52
 */
import type { MelodyTrack } from '../audio/melodyPostprocess';

const SVG_HEIGHT = 200;
const TIME_LABEL_HEIGHT = 16;
const NOTE_LABEL_WIDTH = 28; // Y 轴 MIDI 标签宽

interface Props {
  track: MelodyTrack;
  /** Round 52: 当前播放秒数 (用于高亮当前音符 + 游标) */
  currentSec?: number;
  /** Round 52: 点击音符时回调, 用于 seek */
  onSeek?: (sec: number) => void;
}

export default function MelodyTimeline({ track, currentSec, onSeek }: Props) {
  const { notes, durationSec, minMidi, maxMidi } = track;

  if (notes.length === 0) {
    return (
      <div className="card">
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          未检测到清晰主旋律。<br/>
          <span style={{ fontSize: 12 }}>
            提示：哼唱或弹单音旋律效果最好。带和声/伴奏的歌曲容易跟错声部。
          </span>
        </div>
      </div>
    );
  }

  // SVG 视窗
  const totalSec = Math.max(durationSec, notes[notes.length - 1].startSec + notes[notes.length - 1].durSec);
  const semitoneRange = Math.max(1, maxMidi - minMidi);
  // 每秒像素宽度: 自适应屏宽, 但保证最小 40px/s (避免短录音音符太挤)
  // 用户屏幅 ~320-420px, 15s 录音 → 25-30px/s; 短录音 4s → 80px/s
  const pxPerSec = totalSec < 5 ? 80 : totalSec < 10 ? 50 : 32;
  const noteAreaWidth = totalSec * pxPerSec;
  const svgWidth = NOTE_LABEL_WIDTH + noteAreaWidth;
  const noteAreaHeight = SVG_HEIGHT - TIME_LABEL_HEIGHT;

  // 横坐标 (秒 → x)
  const xOfSec = (sec: number) => NOTE_LABEL_WIDTH + sec * pxPerSec;
  // 纵坐标 (midi → y, midi 越高 y 越小)
  const semitoneHeight = noteAreaHeight / (semitoneRange + 1);
  const yOfMidi = (midi: number) => (maxMidi - midi) * semitoneHeight + semitoneHeight / 2;

  // 时间轴刻度: 每秒一个
  const timeTicks: number[] = [];
  for (let t = 0; t <= Math.ceil(totalSec); t++) timeTicks.push(t);

  // Y 轴 MIDI 标签: 每隔 12 个半音 (八度) 一个 + minMidi/maxMidi 两端
  const midiTicks = new Set<number>([minMidi, maxMidi]);
  for (let m = Math.ceil(minMidi / 12) * 12; m <= maxMidi; m += 12) midiTicks.add(m);

  // 音符颜色: 按 pitch class 染色 (12 色环)
  const pcColor = (midi: number) => {
    const pc = ((midi % 12) + 12) % 12;
    return `hsl(${pc * 30}, 70%, 60%)`;
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>🎼 主旋律</h2>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {notes.length} 个音符 · {totalSec.toFixed(1)}s
        </div>
      </div>

      {/* 横向滚动 SVG */}
      <div style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
        <svg
          width={svgWidth}
          height={SVG_HEIGHT}
          style={{ display: 'block', minWidth: '100%' }}
          aria-label="主旋律时间轴"
        >
          {/* Y 轴 MIDI 标签 + 横向参考线 */}
          {[...midiTicks].map(m => (
            <g key={`y-${m}`}>
              <line
                x1={NOTE_LABEL_WIDTH}
                y1={yOfMidi(m)}
                x2={svgWidth}
                y2={yOfMidi(m)}
                stroke="var(--line-soft)"
                strokeWidth={0.5}
                strokeDasharray="2,3"
              />
              <text
                x={4}
                y={yOfMidi(m) + 3}
                fontSize={9}
                fill="var(--text-muted)"
                fontFamily="ui-monospace, monospace"
              >
                {midiToNoteName(m)}
              </text>
            </g>
          ))}

          {/* 时间轴刻度 (底部) */}
          {timeTicks.map(t => (
            <g key={`x-${t}`}>
              <line
                x1={xOfSec(t)}
                y1={noteAreaHeight}
                x2={xOfSec(t)}
                y2={noteAreaHeight + 4}
                stroke="var(--text-muted)"
                strokeWidth={0.8}
              />
              <text
                x={xOfSec(t)}
                y={noteAreaHeight + TIME_LABEL_HEIGHT - 2}
                fontSize={9}
                fill="var(--text-muted)"
                textAnchor="middle"
              >
                {t}s
              </text>
            </g>
          ))}

          {/* 音符方块 */}
          {notes.map((n, i) => {
            const x = xOfSec(n.startSec);
            const w = Math.max(3, n.durSec * pxPerSec);
            const y = yOfMidi(n.midi) - semitoneHeight / 2 + 1;
            const h = Math.max(6, semitoneHeight - 2);
            const showLabel = w >= 18 || i === 0; // 太窄不显示标签
            // Round 52: 当前播放是否在此音符内
            const isActive = currentSec !== undefined &&
              currentSec >= n.startSec && currentSec < (n.startSec + n.durSec);
            return (
              <g
                key={i}
                onClick={onSeek ? () => onSeek(n.startSec) : undefined}
                style={{ cursor: onSeek ? 'pointer' : 'default' }}
              >
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={Math.min(3, h / 2)}
                  fill={pcColor(n.midi)}
                  opacity={isActive ? 1 : 0.85}
                  stroke={isActive ? '#fff' : 'none'}
                  strokeWidth={isActive ? 2 : 0}
                />
                {showLabel && (
                  <text
                    x={x + w / 2}
                    y={y + h / 2 + 3}
                    fontSize={10}
                    fontWeight={600}
                    fill="#000"
                    textAnchor="middle"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {n.noteName}
                  </text>
                )}
              </g>
            );
          })}

          {/* Round 52: 时间游标 */}
          {currentSec !== undefined && currentSec >= 0 && currentSec <= totalSec && (
            <line
              x1={xOfSec(currentSec)}
              y1={0}
              x2={xOfSec(currentSec)}
              y2={noteAreaHeight}
              stroke="var(--text-strong)"
              strokeWidth={1.5}
              opacity={0.7}
              style={{ pointerEvents: 'none' }}
            />
          )}
        </svg>
      </div>

      {/* 音名序列文本 (可选中复制) */}
      <div style={{
        marginTop: 10, padding: 10, borderRadius: 6,
        background: 'var(--bg-soft)', border: '1px solid var(--line-soft)',
        fontFamily: 'ui-monospace, monospace', fontSize: 13,
        color: 'var(--text-body)', lineHeight: 1.7,
        overflowWrap: 'anywhere', userSelect: 'text',
      }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>音名序列 (可复制):</div>
        {notes.map(n => n.noteName).join(' — ')}
      </div>

      {/* MVP 场景说明 */}
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        💡 哼唱单音 / 弹单音旋律效果最佳。带和声/伴奏的歌曲, 算法可能跟错声部 (跟到 bass 或伴奏).
      </div>
    </div>
  );
}

const SHARP_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function midiToNoteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return SHARP_NAMES[pc] + octave;
}
