/**
 * Round 53: 主旋律 → 吉他指板按法可视化
 *
 * 显示推荐弹的位置 (基于 melodyToFretboard.midiToLowestPosition 算法)
 *
 * 设计原则:
 *   - 复用 Fretboard.tsx 的视觉风格 (sidePad / fretLen / 弦间距等参数对齐)
 *   - 但不复用 Fretboard 组件本身 — 它的渲染逻辑是"按 pitch class 染色全部点位"
 *     与本场景"在指定 (string, fret) 位置画带序号 marker" 不匹配
 *   - 新写一个轻量 SVG (~120 行) 而不是改 Fretboard (Karpathy 规则三)
 *
 * UI:
 *   - 上方一行 "主旋律推荐按法 (N 个位置)"
 *   - 中间 SVG 指板, 每个推荐位置 = 一个圆点 + 音名 + 序号
 *   - 下方:
 *     · 范围外音符列表 (如有)
 *     · 警告文案 "按法基于上方主旋律识别. 若识别有误, 按法也会错."
 */
import { useMemo, useState } from 'react';
import type { MelodyNote } from '../audio/melodyPostprocess';
import {
  getUniquePositionsByStrategy, pickAutoFretRange,
  FIXED_FRET_RANGES, type FretboardStrategy,
} from '../audio/melodyToFretboard';

// 吉他风格 (与 Fretboard.tsx 对齐)
const FRET_LEN = 42;
const STRING_SPACING = 22;
const SIDE_PAD = 28;
const HEAD_PAD = 18;
const TAIL_PAD = 14;
const NUT_WIDTH = 6;
const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E']; // 1 弦到 6 弦
const INLAY_FRETS = [3, 5, 7, 9];
const DOUBLE_INLAY_FRETS = [12];

interface Props {
  notes: MelodyNote[];
  /** Round 54: 当前播放秒数 (用于高亮当前音符的按法位置, undefined = 不高亮) */
  currentSec?: number;
}

export default function FretboardMap({ notes, currentSec }: Props) {
  // Round 56: 策略切换 state (内部, 不上抬, 切 mode 时随组件卸载自动清理)
  const [strategy, setStrategy] = useState<FretboardStrategy>('lowest');
  // 'auto' 字符串 表示自动选最优把位, 否则是 [from, to] 元组
  const [fixedRangeMode, setFixedRangeMode] = useState<'auto' | number>('auto');

  // 自动把位 (仅当 strategy='fixed' 且 fixedRangeMode='auto' 时生效)
  const autoRange = useMemo(
    () => pickAutoFretRange(notes),
    [notes],
  );

  const activeRange: readonly [number, number] | undefined =
    strategy === 'fixed'
      ? (fixedRangeMode === 'auto' ? autoRange : FIXED_FRET_RANGES[fixedRangeMode])
      : undefined;

  const { positions, outOfRange, fallbackKeys } = useMemo(
    () => getUniquePositionsByStrategy(notes, strategy, activeRange),
    [notes, strategy, activeRange],
  );

  if (notes.length === 0) return null;

  // Round 54: 找当前播放的 note 索引 (notes 数组里的 index, 0-based)
  // R53 用 noteIndexes 是 1-based 序号 (用户可见), 这里要对齐到 1-based
  // 静音段/末尾: activeNoteIndex = -1 → 任何位置都不会高亮
  let activeNoteIndex = -1;
  if (currentSec !== undefined && currentSec >= 0) {
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (currentSec >= n.startSec && currentSec < n.startSec + n.durSec) {
        activeNoteIndex = i + 1; // 转 1-based 与 noteIndexes 对齐
        break;
      }
    }
  }

  // 自动决定 fret 范围: 0 ~ max(已用 fret) + 1, 最少到 5 品, 最多 12 品
  const maxFret = positions.reduce((m, p) => Math.max(m, p.position.fret), 0);
  const toFret = Math.max(5, Math.min(12, maxFret + 1));
  const fretCount = toFret;

  // SVG 尺寸
  const fretAxisLen = fretCount * FRET_LEN + NUT_WIDTH;
  const stringAxisLen = 5 * STRING_SPACING;
  const totalW = SIDE_PAD + fretAxisLen + TAIL_PAD;
  const totalH = HEAD_PAD + stringAxisLen + 20; // +20 for fret label

  // 坐标计算
  const stringY = (stringIdx: number) => HEAD_PAD + stringIdx * STRING_SPACING;
  const fretCenterX = (fret: number) => {
    if (fret === 0) return SIDE_PAD - 12;  // 空弦画在琴枕外
    return SIDE_PAD + NUT_WIDTH + (fret - 0.5) * FRET_LEN;
  };
  const fretLineX = (i: number) => SIDE_PAD + NUT_WIDTH + i * FRET_LEN;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>🎸 推荐按法</h2>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {positions.length} 个位置 {outOfRange.length > 0 && `· ${outOfRange.length} 音超范围`}
        </div>
      </div>

      {/* Round 56: 策略切换 segmented */}
      <div className="subpage-segmented" role="tablist" style={{ marginBottom: 6 }}>
        <button
          role="tab"
          aria-selected={strategy === 'lowest'}
          className={strategy === 'lowest' ? 'active' : ''}
          onClick={() => setStrategy('lowest')}
        >最低把位</button>
        <button
          role="tab"
          aria-selected={strategy === 'fixed'}
          className={strategy === 'fixed' ? 'active' : ''}
          onClick={() => setStrategy('fixed')}
        >固定把位</button>
        <button
          role="tab"
          aria-selected={strategy === 'least'}
          className={strategy === 'least' ? 'active' : ''}
          onClick={() => setStrategy('least')}
        >最少移动</button>
      </div>

      {/* 选 fixed 时下方再加把位选择 */}
      {strategy === 'fixed' && (
        <div className="subpage-segmented" role="tablist" style={{ marginBottom: 6 }}>
          <button
            role="tab"
            aria-selected={fixedRangeMode === 'auto'}
            className={fixedRangeMode === 'auto' ? 'active' : ''}
            onClick={() => setFixedRangeMode('auto')}
          >自动</button>
          {FIXED_FRET_RANGES.map((r, idx) => (
            <button
              key={idx}
              role="tab"
              aria-selected={fixedRangeMode === idx}
              className={fixedRangeMode === idx ? 'active' : ''}
              onClick={() => setFixedRangeMode(idx)}
            >{r[0]}-{r[1]} 品</button>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
        {strategy === 'lowest' && '最低把位 — 每个音用最靠近 1 品的位置, 适合初学'}
        {strategy === 'fixed' && activeRange && `固定把位 ${activeRange[0]}-${activeRange[1]} 品${fixedRangeMode === 'auto' ? ' (自动选最优)' : ''} — 同把位练习, 超范围音用最低把位兜底 (虚线圆点)`}
        {strategy === 'least' && '最少手指移动 — 贪心算法, 后续音选距上音最近位置, 适合实战'}
      </div>

      {/* 指板 SVG */}
      <div style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch' }}>
        <svg
          width={totalW}
          height={totalH}
          style={{ display: 'block', minWidth: '100%' }}
          aria-label="主旋律推荐按法指板"
        >
          {/* 指板背景 */}
          <rect
            x={SIDE_PAD} y={HEAD_PAD - 4}
            width={fretAxisLen} height={stringAxisLen + 8}
            fill="var(--bg-soft)"
            rx={2}
          />

          {/* 品丝 */}
          {Array.from({ length: fretCount + 1 }).map((_, i) => (
            <line
              key={`f-${i}`}
              x1={fretLineX(i)} y1={HEAD_PAD - 4}
              x2={fretLineX(i)} y2={HEAD_PAD + stringAxisLen + 4}
              stroke={i === 0 ? 'var(--text-strong)' : 'var(--line-soft)'}
              strokeWidth={i === 0 ? NUT_WIDTH : 1.2}
            />
          ))}

          {/* 品位 inlay (3 5 7 9 12) */}
          {INLAY_FRETS.filter(f => f <= fretCount).map(f => (
            <circle
              key={`inlay-${f}`}
              cx={fretCenterX(f)}
              cy={HEAD_PAD + stringAxisLen / 2}
              r={3}
              fill="var(--line-soft)"
              opacity={0.5}
            />
          ))}
          {DOUBLE_INLAY_FRETS.filter(f => f <= fretCount).map(f => (
            [HEAD_PAD + stringAxisLen / 3, HEAD_PAD + stringAxisLen * 2 / 3].map((cy, i) => (
              <circle
                key={`d-inlay-${f}-${i}`}
                cx={fretCenterX(f)}
                cy={cy}
                r={3}
                fill="var(--line-soft)"
                opacity={0.5}
              />
            ))
          ))}

          {/* 弦 */}
          {Array.from({ length: 6 }).map((_, sIdx) => (
            <line
              key={`s-${sIdx}`}
              x1={SIDE_PAD} y1={stringY(sIdx)}
              x2={SIDE_PAD + fretAxisLen} y2={stringY(sIdx)}
              stroke="var(--text-muted)"
              strokeWidth={0.6 + sIdx * 0.15}  // 低音弦更粗
            />
          ))}

          {/* 弦名 */}
          {STRING_NAMES.map((name, sIdx) => (
            <text
              key={`sn-${sIdx}`}
              x={SIDE_PAD - 16}
              y={stringY(sIdx) + 3}
              fontSize={10}
              fill="var(--text-muted)"
              textAnchor="middle"
            >
              {name}
            </text>
          ))}

          {/* 品位号 (底部) */}
          {Array.from({ length: fretCount + 1 }).map((_, f) => (
            <text
              key={`fnum-${f}`}
              x={f === 0 ? fretCenterX(0) : fretCenterX(f)}
              y={HEAD_PAD + stringAxisLen + 16}
              fontSize={9}
              fill="var(--text-muted)"
              textAnchor="middle"
            >
              {f}
            </text>
          ))}

          {/* 推荐按法 markers */}
          {positions.map((p, i) => {
            const sIdx = p.position.stringNum - 1;  // string 1 → idx 0
            const cx = fretCenterX(p.position.fret);
            const cy = stringY(sIdx);
            // 多个序号: 显示前 3 个, 多了用 "..." 省略
            const idxLabel = p.noteIndexes.slice(0, 3).join(',') + (p.noteIndexes.length > 3 ? '+' : '');
            // Round 54: 当前播放的 note 是否落在此位置 (noteIndexes 是 1-based 序号)
            const isActive = activeNoteIndex > 0 && p.noteIndexes.includes(activeNoteIndex);
            // Round 56: 此位置在策略 b 时是否为兜底音 (超出选定把位范围, 用最低把位补)
            const isFallback = fallbackKeys.has(`${p.position.stringNum}-${p.position.fret}`);
            return (
              <g key={i}>
                <circle
                  cx={cx} cy={cy}
                  r={isActive ? 13 : 11}
                  fill={isActive ? 'var(--accent-cyan, #06b6d4)' : 'var(--brand)'}
                  stroke="#fff"
                  strokeWidth={isActive ? 3 : 1.5}
                  strokeDasharray={isFallback ? '3,2' : undefined}
                  style={{ transition: 'all 0.1s' }}
                />
                <text
                  x={cx} y={cy + 3.5}
                  fontSize={9}
                  fontWeight={700}
                  fill="#fff"
                  textAnchor="middle"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {p.noteName}
                </text>
                {/* 顺序号小角标 */}
                <text
                  x={cx + 12} y={cy - 8}
                  fontSize={8}
                  fill="var(--text-strong)"
                  textAnchor="start"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {idxLabel}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* 范围外音符 */}
      {outOfRange.length > 0 && (
        <div style={{
          marginTop: 10, padding: 8, borderRadius: 6,
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.2)',
          fontSize: 12, color: 'var(--text-body)',
        }}>
          <span style={{ fontWeight: 600 }}>⚠ 以下音超出吉他范围 (E2 - E5):</span>{' '}
          <span style={{ fontFamily: 'ui-monospace, monospace' }}>{outOfRange.join(', ')}</span>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            若是哼唱八度偏高，可尝试下八度重新录制
          </div>
        </div>
      )}

      {/* GIGO 警告 */}
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        💡 按法基于上方主旋律识别结果。若识别有误，按法也会错。<br/>
        建议哼唱<b>单音清晰旋律</b> 验证（带和声/伴奏的歌曲, 识别可能跟到 bass）。
      </div>
    </div>
  );
}
