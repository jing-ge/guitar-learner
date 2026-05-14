import type { ChordShape } from '../theory/chords';

export interface ChordDiagramProps {
  shape: ChordShape;
  size?: number;
  title?: string;
  showFingers?: boolean;
  /** 颜色模式：'light'=深色线条配浅色背景（和弦库卡片），'dark'=浅色线条配深色背景（转换练习等） */
  colorMode?: 'light' | 'dark';
}

export default function ChordDiagram({ shape, size = 160, title, showFingers = true, colorMode = 'light' }: ChordDiagramProps) {
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

  // 颜色方案
  const fg = colorMode === 'dark' ? '#e5e7eb' : '#1f2937';        // 线条/圆点/标题
  const fgDim = colorMode === 'dark' ? '#9ca3af' : '#6b7280';     // 次要文字（×/品位标注）
  const dotFill = colorMode === 'dark' ? '#f59e0b' : '#1f2937';   // 按弦圆点
  const dotText = colorMode === 'dark' ? '#1f1500' : '#ffffff';    // 圆点上的手指编号
  const barreFill = colorMode === 'dark' ? '#f59e0b' : '#1f2937'; // 横按

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={size} height={h * (size / w)} style={{ display: 'block' }}>
      {/* 标题 */}
      {title && (
        <text x={w / 2} y={size * 0.13} fontSize={size * 0.13} fontWeight={700} textAnchor="middle" fill={fg}>
          {title}
        </text>
      )}

      {/* 起始品位标注 */}
      {!showNutLine && (
        <text x={padLeft - 6} y={padTop + rowSpace * 0.7} fontSize={size * 0.08} textAnchor="end" fill={fgDim}>
          {baseFret}fr
        </text>
      )}

      {/* 琴枕 / 顶部品丝 */}
      <line
        x1={padLeft - 1} y1={padTop}
        x2={padLeft + colSpace * 5 + 1} y2={padTop}
        stroke={fg} strokeWidth={showNutLine ? 4 : 1.5}
      />

      {/* 品丝 */}
      {Array.from({ length: fretsToShow }, (_, i) => (
        <line key={`fret-${i}`}
          x1={padLeft} y1={fretY(i + 1)}
          x2={padLeft + colSpace * 5} y2={fretY(i + 1)}
          stroke={fg} strokeWidth={1.5} opacity={0.5}
        />
      ))}

      {/* 弦（竖线） */}
      {Array.from({ length: 6 }, (_, i) => (
        <line key={`s-${i}`}
          x1={stringX(i)} y1={padTop}
          x2={stringX(i)} y2={padTop + rowSpace * fretsToShow}
          stroke={fg} strokeWidth={1.2} opacity={0.6}
        />
      ))}

      {/* 顶部标记：× / ○ */}
      {shape.frets.map((f, i) => {
        const cx = stringX(i);
        const cy = padTop - size * 0.05;
        if (f === -1) {
          return <text key={`top-${i}`} x={cx} y={cy} fontSize={size * 0.1} fontWeight={700} textAnchor="middle" fill={fgDim}>×</text>;
        }
        if (f === 0) {
          return <circle key={`top-${i}`} cx={cx} cy={cy - size * 0.015} r={size * 0.04} fill="none" stroke={fg} strokeWidth={1.5} />;
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
            x={xLeft - colSpace * 0.3} y={yC - rowSpace * 0.32}
            width={(xRight - xLeft) + colSpace * 0.6} height={rowSpace * 0.64}
            rx={rowSpace * 0.32} fill={barreFill} opacity={0.85}
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
            <circle cx={cx} cy={cy} r={size * 0.058} fill={dotFill} />
            {showFingers && finger && finger > 0 && (
              <text x={cx} y={cy + size * 0.022} fontSize={size * 0.07} fontWeight={700} fill={dotText} textAnchor="middle">{finger}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}