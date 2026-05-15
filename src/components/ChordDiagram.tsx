import { useId } from 'react';
import type { ChordShape } from '../theory/chords';

export interface ChordDiagramProps {
  shape: ChordShape;
  size?: number;
  title?: string;
  showFingers?: boolean;
  /**
   * 颜色模式：
   * - 'dark'（默认）：深色卡片背景上的高对比配色（暖木色指板 + 米色弦 + 橙色按弦点）
   * - 'light'：浅色背景上的深色线条
   */
  colorMode?: 'light' | 'dark';
}

/** dark / light 两套配色 */
function getPalette(mode: 'light' | 'dark') {
  if (mode === 'dark') {
    return {
      fretboard: '#2A2118',       // 暖木色指板
      fretboardOpacity: 0.85,
      string: '#E7DBC7',          // 米色弦
      stringWidth: 1.4,
      fret: '#9CA3AF',
      fretWidth: 1.2,
      fretOpacity: 0.6,
      nut: '#E7DBC7',
      nutWidth: 4,
      dotFill: '#F59E0B',
      dotStroke: '#FFB938',
      dotStrokeWidth: 1.5,
      dotText: '#1F1500',
      barreFill: '#F59E0B',
      barreStroke: '#FFB938',
      barreStrokeWidth: 1.5,
      muted: '#FB7185',           // ×
      open: '#34D399',            // ○
      title: '#F3F4F6',
      label: '#C7CEDB',
    };
  }
  return {
    fretboard: '#F8FAFC',
    fretboardOpacity: 1,
    string: '#1F2937',
    stringWidth: 1.2,
    fret: '#1F2937',
    fretWidth: 1.2,
    fretOpacity: 0.5,
    nut: '#1F2937',
    nutWidth: 4,
    dotFill: '#1F2937',
    dotStroke: '#374151',
    dotStrokeWidth: 1.2,
    dotText: '#FFFFFF',
    barreFill: '#1F2937',
    barreStroke: '#374151',
    barreStrokeWidth: 1.2,
    muted: '#9CA3AF',
    open: '#374151',
    title: '#111827',
    label: '#6B7280',
  };
}

export default function ChordDiagram({
  shape,
  size = 160,
  title,
  showFingers = true,
  colorMode = 'dark',
}: ChordDiagramProps) {
  const uid = useId().replace(/[:]/g, '');
  const shadowId = `cd-shadow-${uid}`;

  const fretsToShow = 5;
  const colSpace = size * 0.14;
  const rowSpace = size * 0.13;
  const padLeft = size * 0.16;
  const padTop = size * 0.22;
  const w = padLeft * 2 + colSpace * 5;
  const h = padTop + rowSpace * fretsToShow + size * 0.15;

  const pressedFrets = shape.frets.filter(f => f > 0);
  const minFret = pressedFrets.length ? Math.min(...pressedFrets) : 1;
  const maxFret = pressedFrets.length ? Math.max(...pressedFrets) : 1;
  const baseFret = maxFret <= fretsToShow ? 1 : minFret;
  const showNutLine = baseFret === 1;

  const stringX = (stringIdx: number) => padLeft + stringIdx * colSpace;
  const fretY = (fretLine: number) => padTop + fretLine * rowSpace;

  const p = getPalette(colorMode);
  const dotR = size * 0.072;
  const fingerFont = size * 0.085;
  const titleFont = size * 0.14;

  // 指板矩形
  const boardX = padLeft - colSpace * 0.18;
  const boardY = padTop - rowSpace * 0.18;
  const boardW = colSpace * 5 + colSpace * 0.36;
  const boardH = rowSpace * fretsToShow + rowSpace * 0.36;
  const boardR = size * 0.04;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={size}
      height={h * (size / w)}
      style={{ display: 'block', fontFeatureSettings: '"tnum"' }}
    >
      <defs>
        <filter id={shadowId} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.2" floodColor="#000" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* 指板木纹底（最底层） */}
      <rect
        x={boardX}
        y={boardY}
        width={boardW}
        height={boardH}
        rx={boardR}
        fill={p.fretboard}
        opacity={p.fretboardOpacity}
      />

      {/* 标题 */}
      {title && (
        <text
          x={w / 2}
          y={size * 0.13}
          fontSize={titleFont}
          fontWeight={800}
          textAnchor="middle"
          fill={p.title}
          style={{ fontFeatureSettings: '"tnum"' }}
        >
          {title}
        </text>
      )}

      {/* 起始品位标注 */}
      {!showNutLine && (
        <text
          x={padLeft - 6}
          y={padTop + rowSpace * 0.7}
          fontSize={size * 0.08}
          textAnchor="end"
          fill={p.label}
        >
          {baseFret}fr
        </text>
      )}

      {/* 琴枕 / 顶部品丝 */}
      <line
        x1={padLeft - 1}
        y1={padTop}
        x2={padLeft + colSpace * 5 + 1}
        y2={padTop}
        stroke={showNutLine ? p.nut : p.fret}
        strokeWidth={showNutLine ? p.nutWidth : p.fretWidth}
        strokeLinecap="round"
        opacity={showNutLine ? 1 : p.fretOpacity}
      />

      {/* 品丝 */}
      {Array.from({ length: fretsToShow }, (_, i) => (
        <line
          key={`fret-${i}`}
          x1={padLeft}
          y1={fretY(i + 1)}
          x2={padLeft + colSpace * 5}
          y2={fretY(i + 1)}
          stroke={p.fret}
          strokeWidth={p.fretWidth}
          opacity={p.fretOpacity}
        />
      ))}

      {/* 弦（竖线） */}
      {Array.from({ length: 6 }, (_, i) => (
        <line
          key={`s-${i}`}
          x1={stringX(i)}
          y1={padTop}
          x2={stringX(i)}
          y2={padTop + rowSpace * fretsToShow}
          stroke={p.string}
          strokeWidth={p.stringWidth}
          opacity={0.9}
        />
      ))}

      {/* 顶部标记：× / ○ */}
      {shape.frets.map((f, i) => {
        const cx = stringX(i);
        const cy = padTop - size * 0.05;
        if (f === -1) {
          return (
            <text
              key={`top-${i}`}
              x={cx}
              y={cy}
              fontSize={size * 0.13}
              fontWeight={800}
              textAnchor="middle"
              fill={p.muted}
            >
              ×
            </text>
          );
        }
        if (f === 0) {
          // 双圈：外圈实线 + 内圈虚线
          return (
            <g key={`top-${i}`}>
              <circle
                cx={cx}
                cy={cy - size * 0.015}
                r={size * 0.045}
                fill="none"
                stroke={p.open}
                strokeWidth={1.5}
              />
              <circle
                cx={cx}
                cy={cy - size * 0.015}
                r={size * 0.028}
                fill="none"
                stroke={p.open}
                strokeWidth={0.8}
                strokeDasharray="1.2 1.2"
              />
            </g>
          );
        }
        return null;
      })}

      {/* 横按 */}
      {shape.barre && (() => {
        const fretIdxOnDiagram = shape.barre.fret - baseFret + 1;
        if (fretIdxOnDiagram < 1 || fretIdxOnDiagram > fretsToShow) return null;
        const yC = fretY(fretIdxOnDiagram) - rowSpace / 2;
        const xLeft = stringX(6 - shape.barre.toString);
        const xRight = stringX(6 - shape.barre.fromString);
        return (
          <rect
            x={xLeft - colSpace * 0.32}
            y={yC - rowSpace * 0.34}
            width={(xRight - xLeft) + colSpace * 0.64}
            height={rowSpace * 0.68}
            rx={rowSpace * 0.34}
            fill={p.barreFill}
            stroke={p.barreStroke}
            strokeWidth={p.barreStrokeWidth}
            filter={`url(#${shadowId})`}
          />
        );
      })()}

      {/* 按弦圆点 + 手指编号 */}
      {shape.frets.map((f, i) => {
        if (f <= 0) return null;
        const fretIdxOnDiagram = f - baseFret + 1;
        if (fretIdxOnDiagram < 1 || fretIdxOnDiagram > fretsToShow) return null;
        const cx = stringX(i);
        const cy = fretY(fretIdxOnDiagram) - rowSpace / 2;
        const finger = shape.fingers?.[i];
        return (
          <g key={`dot-${i}`}>
            <circle
              cx={cx}
              cy={cy}
              r={dotR}
              fill={p.dotFill}
              stroke={p.dotStroke}
              strokeWidth={p.dotStrokeWidth}
              filter={`url(#${shadowId})`}
            />
            {showFingers && finger && finger > 0 && (
              <text
                x={cx}
                y={cy + fingerFont * 0.34}
                fontSize={fingerFont}
                fontWeight={800}
                fill={p.dotText}
                textAnchor="middle"
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                {finger}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
