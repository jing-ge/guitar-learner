import type { ChordShape } from '../theory/chords';

type Props = { shape: ChordShape };

const FINGER_NAMES = ['', '食指', '中指', '无名指', '小指'];
const CIRCLED = ['', '①', '②', '③', '④'];

/**
 * 弦号显示约定：
 * - shape.frets 索引 0..5 ←→ 6 弦（最粗）到 1 弦（最细）
 * - 内部 i ←→ 显示弦号 = 6 - i
 * - shape.barre.fromString / toString 已经是 1..6 的弦号（1 高音，6 低音）
 */
function idxToStringNum(i: number) {
  return 6 - i;
}

interface Line {
  finger: number;          // 1..4
  text: string;            // 已格式化文字
}

export default function ChordHowTo({ shape }: Props) {
  const lines: Line[] = [];
  const muted: number[] = [];
  const open: number[] = [];

  // 收集每根弦的状态
  for (let i = 0; i < 6; i++) {
    const f = shape.frets[i];
    const stringNum = idxToStringNum(i);
    if (f === -1) muted.push(stringNum);
    else if (f === 0) open.push(stringNum);
  }

  // 推断 barre 用的手指（取 barre 涵盖弦中第一个 fingers 不为 0 的；约定通常是 1=食指）
  const barreFinger: number | null = (() => {
    if (!shape.barre || !shape.fingers) return null;
    const fromS = Math.min(shape.barre.fromString, shape.barre.toString);
    const toS = Math.max(shape.barre.fromString, shape.barre.toString);
    for (let i = 0; i < 6; i++) {
      const stringNum = idxToStringNum(i);
      if (stringNum >= fromS && stringNum <= toS && shape.frets[i] === shape.barre.fret) {
        const f = shape.fingers[i];
        if (f && f > 0) return f;
      }
    }
    return 1; // 默认食指
  })();

  if (shape.fingers && shape.fingers.length === 6) {
    // 按手指序号聚合
    const byFinger = new Map<number, { stringNum: number; fret: number }[]>();
    for (let i = 0; i < 6; i++) {
      const f = shape.frets[i];
      const finger = shape.fingers[i];
      if (f > 0 && finger > 0) {
        const arr = byFinger.get(finger) || [];
        arr.push({ stringNum: idxToStringNum(i), fret: f });
        byFinger.set(finger, arr);
      }
    }

    const sortedFingers = Array.from(byFinger.keys()).sort((a, b) => a - b);

    for (const finger of sortedFingers) {
      const positions = byFinger.get(finger)!;
      const name = FINGER_NAMES[finger] || `手指${finger}`;
      if (shape.barre && barreFinger === finger) {
        // 横按合并描述
        const fromString = Math.min(shape.barre.fromString, shape.barre.toString);
        const toString = Math.max(shape.barre.fromString, shape.barre.toString);
        const fret = shape.barre.fret;
        const text = `${name} → ${toString}弦 ${fret}品（横按 ${fromString}-${toString} 弦）`;
        lines.push({ finger, text });
        // barre 弦号一般覆盖了同手指的多个 frets，这里直接用 barre 描述替代
      } else if (positions.length === 1) {
        const pos = positions[0];
        lines.push({ finger, text: `${name} → ${pos.stringNum}弦 ${pos.fret}品` });
      } else {
        // 同一手指多个位置（非 barre 但同 finger）
        const fret = positions[0].fret;
        const sameFret = positions.every(p => p.fret === fret);
        const stringList = positions.map(p => `${p.stringNum}弦`).join(' ');
        if (sameFret) {
          lines.push({ finger, text: `${name} → ${stringList} ${fret}品（同时按）` });
        } else {
          const parts = positions.map(p => `${p.stringNum}弦 ${p.fret}品`).join(' / ');
          lines.push({ finger, text: `${name} → ${parts}` });
        }
      }
    }
  } else {
    // 无 fingers 数据：退化为按弦位置列表
    for (let i = 0; i < 6; i++) {
      const f = shape.frets[i];
      if (f > 0) {
        lines.push({ finger: 0, text: `${idxToStringNum(i)}弦 ${f}品` });
      }
    }
  }

  return (
    <div className="chord-howto" aria-label="按弦顺序">
      <div className="chord-howto-title">🎸 按弦顺序</div>
      <div className="chord-howto-list">
        {lines.length === 0 && (
          <div className="chord-howto-row">
            <span className="chord-howto-text">（全空弦/不弹）</span>
          </div>
        )}
        {lines.map((ln, idx) => (
          <div className="chord-howto-row" key={idx}>
            <span className="chord-howto-num">{CIRCLED[idx + 1] || `${idx + 1}.`}</span>
            <span className="chord-howto-text">{ln.text}</span>
          </div>
        ))}
      </div>
      {(muted.length > 0 || open.length > 0) && (
        <div className="chord-howto-misc">
          {muted.length > 0 && (
            <span><b>不弹：</b>{muted.map(s => `${s}弦`).join(' ')}</span>
          )}
          {open.length > 0 && (
            <span><b>空弦：</b>{open.map(s => `${s}弦`).join(' ')}</span>
          )}
        </div>
      )}
    </div>
  );
}
