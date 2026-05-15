import { useMemo } from 'react';
import { fretToMidi, pcToName, pcToSolfege, semitonesToDegree } from '../theory/notes';
import { synth } from '../audio/synth';

export type LabelMode = 'name' | 'solfege' | 'degree' | 'none';

export interface FretboardHighlight {
  pcColors?: Record<number, string>;
  rootPc?: number;
  onlyPcs?: number[];
}

export interface FretboardProps {
  fromFret?: number;
  toFret?: number;
  highlight?: FretboardHighlight;
  labelMode?: LabelMode;
  onClickPosition?: (stringNum: 1|2|3|4|5|6, fret: number) => void;
  showStringNames?: boolean;
  activePosition?: { stringNum: number; fret: number } | null;
  /** 竖屏模式：弦水平排列（6弦在左，1弦在右），品位从上到下 */
  vertical?: boolean;
}

const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E']; // 1 弦到 6 弦
const INLAY_FRETS = [3, 5, 7, 9, 15, 17, 19, 21];
const DOUBLE_INLAY_FRETS = [12, 24];

export default function Fretboard({
  fromFret = 0,
  toFret = 12,
  highlight,
  labelMode = 'name',
  onClickPosition,
  showStringNames = true,
  activePosition = null,
  vertical = false
}: FretboardProps) {
  const fretCount = toFret - fromFret;

  // 几何参数 - 在水平和垂直模式下复用相同逻辑：
  // - 水平模式：fretAxis=X(品位轴), stringAxis=Y(弦轴)
  // - 垂直模式：fretAxis=Y(品位轴, 从上到下), stringAxis=X(弦轴, 6弦在左→1弦在右)
  const fretLen = vertical ? 50 : 60;          // 每品的长度
  const stringSpacing = vertical ? 32 : 28;    // 弦间距
  
  // 留出足够的空间显示 0 品音符和弦名
  const headPad = vertical ? (showStringNames ? 46 : 30) : 26;
  const tailPad = 18;
  const sidePad = vertical ? 14 : (showStringNames ? (fromFret === 0 ? 50 : 36) : 14);
  const otherSidePad = 14;
  const fretAxisLen = fretCount * fretLen + (fromFret === 0 ? 12 : 0);
  const stringAxisLen = 5 * stringSpacing;
  const nutWidth = fromFret === 0 ? 8 : 0;

  // SVG 整体尺寸
  const totalW = vertical
    ? sidePad + stringAxisLen + otherSidePad
    : sidePad + fretAxisLen + otherSidePad;
  const totalH = vertical
    ? headPad + fretAxisLen + tailPad
    : headPad + stringAxisLen + tailPad;

  /**
   * 把 (stringIdx, fretIdx) 转为屏幕坐标
   * stringIdx: 0=1弦(高音e), 5=6弦(低音E)
   * fretIdx: 在 fromFret 到 toFret 范围
   */
  const stringPos = (stringIdx: number) => {
    if (vertical) {
      // 6弦在最左 (stringIdx=5 → x=sidePad), 1弦在最右 (stringIdx=0 → x=sidePad + stringAxisLen)
      return sidePad + (5 - stringIdx) * stringSpacing;
    } else {
      // 1弦在顶部 (stringIdx=0 → y=headPad), 6弦在底部
      return headPad + stringIdx * stringSpacing;
    }
  };

  const fretCenterPos = (fret: number) => {
    // 返回品位中心点（沿 fret 轴）
    if (fret === 0 && fromFret === 0) {
      // 0 品(空弦)：画在琴枕外侧
      return vertical ? headPad - 16 : sidePad - 16;
    }
    const local = (fret - fromFret - 0.5) * fretLen + nutWidth;
    return (vertical ? headPad : sidePad) + local;
  };

  const fretLinePos = (i: number) => {
    // 品丝线的位置（i=0 是琴枕/起始品丝）
    return (vertical ? headPad : sidePad) + nutWidth + i * fretLen;
  };

  // 预计算所有圆点
  const dots = useMemo(() => {
    const list: { stringNum: 1|2|3|4|5|6; fret: number; pc: number; cx: number; cy: number; label: string; color?: string; isRoot: boolean }[] = [];
    for (let s = 1; s <= 6; s++) {
      const stringNum = s as 1|2|3|4|5|6;
      const stringIdx = s - 1;
      for (let f = fromFret; f <= toFret; f++) {
        const midi = fretToMidi(stringNum, f);
        const pc = ((midi % 12) + 12) % 12;
        if (highlight?.onlyPcs && !highlight.onlyPcs.includes(pc)) continue;
        let color = highlight?.pcColors?.[pc];
        const isRoot = highlight?.rootPc === pc;
        if (!highlight) color = '#9ca3af';
        if (!color && isRoot) color = '#FB7185';
        if (!color) continue;

        const fretP = fretCenterPos(f);
        const stringP = stringPos(stringIdx);
        // 在水平/垂直模式下交换坐标
        const cx = vertical ? stringP : fretP;
        const cy = vertical ? fretP : stringP;

        let label = '';
        if (labelMode === 'name') label = pcToName(pc);
        else if (labelMode === 'solfege') label = pcToSolfege(pc);
        else if (labelMode === 'degree' && highlight?.rootPc !== undefined) {
          label = semitonesToDegree(pc - highlight.rootPc);
        }
        list.push({ stringNum, fret: f, pc, cx, cy, label, color, isRoot });
      }
    }
    return list;
  }, [fromFret, toFret, highlight, labelMode, vertical]);

  const handleClick = async (stringNum: 1|2|3|4|5|6, fret: number) => {
    await synth.unlock();
    if (onClickPosition) onClickPosition(stringNum, fret);
    else synth.playFret(stringNum, fret);
  };

  // 指板背景矩形
  const boardX = sidePad;
  const boardY = headPad;
  const boardW = vertical ? stringAxisLen : fretAxisLen;
  const boardH = vertical ? fretAxisLen : stringAxisLen;
  // 让指板背景在弦垂直方向上延伸 12px（更美观）
  const bgX = vertical ? boardX - 6 : boardX;
  const bgY = vertical ? boardY : boardY - 6;
  const bgW = vertical ? boardW + 12 : boardW;
  const bgH = vertical ? boardH : boardH + 12;

  return (
    <svg
      className="fretboard-svg"
      viewBox={`0 0 ${totalW} ${totalH}`}
      width={totalW}
      height={totalH}
      style={{ touchAction: 'manipulation' }}
    >
      {/* 指板底色 */}
      <rect x={bgX} y={bgY} width={bgW} height={bgH} fill="#3a2a1d" rx={3} />
      {/* 指板内描边（增强边界） */}
      <rect x={bgX + 0.5} y={bgY + 0.5} width={bgW - 1} height={bgH - 1} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} rx={3} />

      {/* 琴枕 */}
      {fromFret === 0 && (
        vertical
          ? <rect x={bgX} y={bgY} width={bgW} height={nutWidth} fill="#f3e9d2" />
          : <rect x={bgX} y={bgY} width={nutWidth} height={bgH} fill="#f3e9d2" />
      )}

      {/* 品丝 */}
      {Array.from({ length: fretCount + 1 }, (_, i) => {
        const p = fretLinePos(i);
        const isFirst = i === 0 && fromFret > 0;
        const sw = isFirst ? 4 : 2;
        return vertical
          ? <line key={`fret-${i}`} x1={bgX} y1={p} x2={bgX + bgW} y2={p} stroke="#c0c0c0" strokeWidth={sw} />
          : <line key={`fret-${i}`} x1={p} y1={bgY} x2={p} y2={bgY + bgH} stroke="#c0c0c0" strokeWidth={sw} />;
      })}

      {/* 品位记号点 */}
      {Array.from({ length: fretCount }, (_, i) => {
        const fret = fromFret + i + 1;
        const fretP = fretCenterPos(fret);
        const midStringP = (stringPos(0) + stringPos(5)) / 2;
        if (DOUBLE_INLAY_FRETS.includes(fret)) {
          const p1 = stringPos(1);
          const p4 = stringPos(4);
          return (
            <g key={`inlay-${fret}`} opacity={0.35}>
              {vertical
                ? <>
                    <circle cx={p1} cy={fretP} r={5} fill="#f5f5dc" />
                    <circle cx={p4} cy={fretP} r={5} fill="#f5f5dc" />
                  </>
                : <>
                    <circle cx={fretP} cy={p1} r={5} fill="#f5f5dc" />
                    <circle cx={fretP} cy={p4} r={5} fill="#f5f5dc" />
                  </>}
            </g>
          );
        }
        if (INLAY_FRETS.includes(fret)) {
          return vertical
            ? <circle key={`inlay-${fret}`} cx={midStringP} cy={fretP} r={5} fill="#f5f5dc" opacity={0.35} />
            : <circle key={`inlay-${fret}`} cx={fretP} cy={midStringP} r={5} fill="#f5f5dc" opacity={0.35} />;
        }
        return null;
      })}

      {/* 弦 */}
      {Array.from({ length: 6 }, (_, sIdx) => {
        const stringP = stringPos(sIdx);
        const thickness = 1 + sIdx * 0.4; // 1弦最细，6弦最粗
        const start = vertical ? bgY : bgX;
        const end = vertical ? bgY + bgH : bgX + bgW;
        return vertical
          ? <line key={`str-${sIdx}`} x1={stringP} y1={start} x2={stringP} y2={end} stroke="#e0e0e0" strokeWidth={thickness} />
          : <line key={`str-${sIdx}`} x1={start} y1={stringP} x2={end} y2={stringP} stroke="#e0e0e0" strokeWidth={thickness} />;
      })}

      {/* 弦名标注 */}
      {showStringNames && Array.from({ length: 6 }, (_, sIdx) => {
        const p = stringPos(sIdx);
        // 如果有0品，弦名要画在更外侧以避免和0品圆点重叠
        const offset = fromFret === 0 ? 32 : 14;
        return vertical
          ? <text key={`sn-${sIdx}`} x={p} y={headPad - offset} fontSize={12} fill="#9ca3af" textAnchor="middle">{STRING_NAMES[sIdx]}</text>
          : <text key={`sn-${sIdx}`} x={sidePad - offset + 6} y={p + 4} fontSize={12} fill="#9ca3af" textAnchor="end">{STRING_NAMES[sIdx]}</text>;
      })}

      {/* 品位编号 */}
      {Array.from({ length: fretCount }, (_, i) => {
        const fret = fromFret + i + 1;
        const p = fretCenterPos(fret);
        return vertical
          ? <text key={`fn-${fret}`} x={totalW - 6} y={p + 4} fontSize={10} fill="#9ca3af" textAnchor="end">{fret}</text>
          : <text key={`fn-${fret}`} x={p} y={headPad + stringAxisLen + 14} fontSize={10} fill="#9ca3af" textAnchor="middle">{fret}</text>;
      })}

      {/* 点击热区 */}
      {Array.from({ length: 6 }, (_, sIdx) => {
        const stringNum = (sIdx + 1) as 1|2|3|4|5|6;
        const stringP = stringPos(sIdx);
        return Array.from({ length: fretCount + 1 }, (_, i) => {
          const fret = fromFret + i;
          const fretP = fretCenterPos(fret);
          const cx = vertical ? stringP : fretP;
          const cy = vertical ? fretP : stringP;
          const w = vertical ? stringSpacing : fretLen;
          const h = vertical ? fretLen : stringSpacing;
          return (
            <rect
              key={`hit-${stringNum}-${fret}`}
              x={cx - w / 2} y={cy - h / 2}
              width={w} height={h}
              fill="transparent" style={{ cursor: 'pointer' }}
              onClick={() => handleClick(stringNum, fret)}
            />
          );
        });
      })}

      {/* 高亮圆点 */}
      {dots.map(d => {
        const isActive = activePosition && d.stringNum === activePosition.stringNum && d.fret === activePosition.fret;
        return (
          <g key={`dot-${d.stringNum}-${d.fret}`} pointerEvents="none">
            {isActive && (
              <>
                <circle cx={d.cx} cy={d.cy} r={16} fill="none" stroke="#fff" strokeWidth={2.5} opacity={0.9}>
                  <animate attributeName="r" from="12" to="22" dur="0.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.9" to="0" dur="0.5s" repeatCount="indefinite" />
                </circle>
                <circle cx={d.cx} cy={d.cy} r={13} fill="none" stroke="#fff" strokeWidth={2} opacity={0.7} />
              </>
            )}
            <circle cx={d.cx} cy={d.cy} r={11}
              fill={isActive ? '#FFB938' : d.color}
              stroke={isActive ? '#fff' : d.isRoot ? '#fff' : 'rgba(255,255,255,0.5)'}
              strokeWidth={isActive ? 2.5 : d.isRoot ? 2 : 1}
            />
            {d.label && (
              <text
                x={d.cx} y={d.cy + 4}
                fontSize={12}
                fontWeight={700}
                fill={isActive ? '#1f1500' : '#fff'}
                textAnchor="middle"
                style={{
                  paintOrder: 'stroke',
                  stroke: 'rgba(0,0,0,0.55)',
                  strokeWidth: 2.5,
                  strokeLinejoin: 'round',
                }}
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}