// 五声音阶（Pentatonic）学习模块
// - 大调/小调五声 + 蓝调五声
// - 5 个把位指型（Position 1-5）
// - 推根音改 key + 跟弹示范

import { useEffect, useMemo, useRef, useState } from 'react';
import Fretboard from '../components/Fretboard';
import { ALL_ROOTS, pcToName, fretToMidi } from '../theory/notes';
import { synth } from '../audio/synth';
import { vibrate } from '../utils/haptic';

type PentaKind = 'minor' | 'major' | 'blues';

const PENTA_DEFS: Record<PentaKind, { name: string; intervals: number[]; degrees: string[]; desc: string; tip: string }> = {
  minor: {
    name: '小调五声',
    intervals: [0, 3, 5, 7, 10],
    degrees: ['1','b3','4','5','b7'],
    desc: '摇滚 / 蓝调 solo 的基石，五个音怎么弹都不易出错。',
    tip: '常配 Am、Em、Bm 等小调和弦使用。',
  },
  major: {
    name: '大调五声',
    intervals: [0, 2, 4, 7, 9],
    degrees: ['1','2','3','5','6'],
    desc: '民谣 / 流行 / 乡村常用，明亮甜美，避免了大调中的 4 和 7 音不协和点。',
    tip: '常配 C、G、D、A 等大调和弦使用。',
  },
  blues: {
    name: '小调蓝调',
    intervals: [0, 3, 5, 6, 7, 10],
    degrees: ['1','b3','4','b5','5','b7'],
    desc: '在小调五声基础上加入 b5（蓝调音 / Blue Note），充满蓝调味。',
    tip: 'b5 是经过音，作为短暂修饰使用，停在 1/b3/5 上更稳。',
  },
};

const DEGREE_COLOR: Record<string, string> = {
  '1':  '#ef4444', // 根音红色
  '2':  '#f59e0b',
  'b3': '#8b5cf6',
  '3':  '#8b5cf6',
  '4':  '#06b6d4',
  'b5': '#ec4899', // 蓝调音粉色
  '5':  '#22c55e',
  '6':  '#84cc16',
  'b7': '#f97316',
  '7':  '#f97316',
};

/**
 * 五声音阶 5 大把位（Box / Position）—— 以 A 小调五声为例
 * 每个 Position 的 [string6, string5, string4, string3, string2, string1] 弦位起始品（A 根音锚定）
 * 用户改根音时整体平移
 */
interface PentaBox {
  name: string;
  /** 以 A 小调（A=5 弦空弦上方 = 实际 5 弦空弦 A）为锚定时，该把位的最低品和最高品 */
  baseLowFret: number;
  baseHighFret: number;
  /** 中文描述 */
  desc: string;
}

// A 小调五声音阶 5 把位（A 在 6 弦 5 品起，标准小调五声 box 位置）
const PENTA_BOXES: PentaBox[] = [
  { name: 'Box 1', baseLowFret: 5,  baseHighFret: 8,  desc: '最常用的入门把位，根音 6 弦 5 品，整个 box 横跨 5-8 品' },
  { name: 'Box 2', baseLowFret: 7,  baseHighFret: 10, desc: '7-10 品区域，根音在 5 弦' },
  { name: 'Box 3', baseLowFret: 10, baseHighFret: 13, desc: '10-13 品，根音在 4 弦' },
  { name: 'Box 4', baseLowFret: 12, baseHighFret: 15, desc: '12-15 品高把位，根音在 3 弦/2 弦' },
  { name: 'Box 5', baseLowFret: 14, baseHighFret: 17, desc: '14-17 品最高把位，回归 1 弦根音' },
];

export default function PentatonicPage() {
  const [kind, setKind] = useState<PentaKind>('minor');
  const [rootPc, setRootPc] = useState(9); // 默认 A（pc=9）
  const [boxIdx, setBoxIdx] = useState(0);
  const [showAll, setShowAll] = useState(false);  // 是否显示所有把位 vs 仅当前 box

  const def = PENTA_DEFS[kind];

  // 计算音阶 pitch class 集合
  const pcs = useMemo(
    () => def.intervals.map(i => ((rootPc + i) % 12 + 12) % 12),
    [def.intervals, rootPc]
  );

  // pc → 度数 label 映射
  const pcToDegree = useMemo(() => {
    const m: Record<number, string> = {};
    def.intervals.forEach((iv, idx) => {
      const pc = ((rootPc + iv) % 12 + 12) % 12;
      m[pc] = def.degrees[idx];
    });
    return m;
  }, [def.intervals, def.degrees, rootPc]);

  const pcColors = useMemo(() => {
    const m: Record<number, string> = {};
    Object.entries(pcToDegree).forEach(([pcStr, deg]) => {
      m[+pcStr] = DEGREE_COLOR[deg] || 'var(--primary)';
    });
    return m;
  }, [pcToDegree]);

  // 当前 box 的品位范围（根据根音平移：A pc=9 → box1 base=5；移到 C pc=0 时整体下移）
  // 6 弦上的根音品：(rootPc - 4 + 12) % 12 = 6弦从 E(pc=4) 算的相对品
  // A 根音在 6 弦 5 品 → box1 base=5，所以 baseLowFret 相对 A 偏移 = 0
  // 当用户切到 G (pc=7) 时，所有 box 的品位整体上移 -2（往左移）
  const rootShift = useMemo(() => {
    // A=9 → 5 品；E=4 → 12 品（按 7-fret 间距 wrap）。取最接近 A 的偏移
    // 用 mod 12 的最小绝对差
    let diff = (rootPc - 9 + 12) % 12; // 0..11
    if (diff > 6) diff -= 12; // 让范围在 -5..6，最近的方向移动
    return diff;
  }, [rootPc]);

  const currentBox = PENTA_BOXES[boxIdx];
  const boxLowFret = Math.max(0, Math.min(15, currentBox.baseLowFret + rootShift));
  const boxHighFret = Math.max(boxLowFret + 4, Math.min(20, currentBox.baseHighFret + rootShift));

  const highlight = useMemo(() => {
    return {
      pcColors,
      rootPc,
      onlyPcs: pcs,
    };
  }, [pcColors, rootPc, pcs]);

  // 跟弹示范：从根音开始向上弹一遍音阶
  const [playing, setPlaying] = useState(false);
  const playTimerRef = useRef<number | null>(null);
  const [activePos, setActivePos] = useState<{ stringNum: number; fret: number } | null>(null);

  useEffect(() => {
    if (!playing) {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
      setActivePos(null);
      return;
    }
    // 收集当前 box 内所有 pc 命中的弦位（从 6 弦低到 1 弦高、品位升序）
    const positions: { stringNum: 1|2|3|4|5|6; fret: number; midi: number }[] = [];
    for (let s = 6; s >= 1; s--) {
      for (let f = boxLowFret; f <= boxHighFret; f++) {
        const midi = fretToMidi(s as 1|2|3|4|5|6, f);
        const pc = ((midi % 12) + 12) % 12;
        if (pcs.includes(pc)) {
          positions.push({ stringNum: s as 1|2|3|4|5|6, fret: f, midi });
        }
      }
    }
    // 按 midi 升序
    positions.sort((a, b) => a.midi - b.midi);
    if (positions.length === 0) { setPlaying(false); return; }

    let i = 0;
    const playOne = async () => {
      await synth.unlock();
      const p = positions[i % positions.length];
      synth.playFret(p.stringNum, p.fret, 2.0);
      setActivePos({ stringNum: p.stringNum, fret: p.fret });
      vibrate(8);
      i++;
      if (i >= positions.length * 2) { // 上行 + 下行各一次后停止
        if (playTimerRef.current) clearInterval(playTimerRef.current);
        setPlaying(false);
      } else if (i >= positions.length) {
        // 转为下行
      }
    };
    playOne();
    playTimerRef.current = window.setInterval(playOne, 380);
    return () => { if (playTimerRef.current) clearInterval(playTimerRef.current); };
  }, [playing, boxLowFret, boxHighFret, pcs]);

  return (
    <div>
      <div className="card">
        <h2>🎯 五声音阶</h2>
        <p>五声音阶是最实用的 solo 工具：只有 5 个音，怎么弹都好听。先掌握 Box 1，再扩展到其它 4 个把位。</p>
      </div>

      {/* 选择音阶类型 */}
      <div className="section-title">音阶类型</div>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        {(['minor', 'major', 'blues'] as PentaKind[]).map(k => (
          <button key={k} className={'chip' + (kind === k ? ' active' : '')} onClick={() => setKind(k)}>
            {PENTA_DEFS[k].name}
          </button>
        ))}
      </div>
      <div className="card" style={{ background: 'var(--bg-soft)' }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          <b>{def.name}</b>：{def.desc}<br />
          💡 {def.tip}
        </p>
        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {def.degrees.map((d, i) => {
            const pc = ((rootPc + def.intervals[i]) % 12 + 12) % 12;
            return (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 50, height: 36, padding: '0 10px',
                borderRadius: 8, fontWeight: 700, fontSize: 14,
                background: DEGREE_COLOR[d] || 'var(--primary)',
                color: '#fff',
              }}>
                {d} = {pcToName(pc)}
              </span>
            );
          })}
        </div>
      </div>

      {/* 根音选择 */}
      <div className="section-title">根音 / Key</div>
      <div className="chip-row" style={{ marginBottom: 10 }}>
        {ALL_ROOTS.map(r => (
          <button key={r.pc} className={'chip' + (rootPc === r.pc ? ' active' : '')} onClick={() => setRootPc(r.pc)}>
            {r.sharp}
          </button>
        ))}
      </div>

      {/* 把位选择 */}
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>把位（Position / Box）</span>
        <label style={{ fontSize: 12, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontWeight: 400 }}>
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          显示全指板
        </label>
      </div>
      {!showAll && (
        <div className="chip-row" style={{ marginBottom: 10 }}>
          {PENTA_BOXES.map((b, i) => (
            <button key={i} className={'chip' + (boxIdx === i ? ' active' : '')} onClick={() => setBoxIdx(i)}>
              {b.name}
            </button>
          ))}
        </div>
      )}
      {!showAll && (
        <div className="card" style={{ fontSize: 13 }}>
          <b>{currentBox.name}</b>（{boxLowFret} - {boxHighFret} 品）：{currentBox.desc}
        </div>
      )}

      {/* 指板 */}
      <div className="fretboard-wrap">
        {showAll ? (
          <Fretboard fromFret={0} toFret={15} highlight={highlight} labelMode="degree" activePosition={activePos} />
        ) : (
          <Fretboard
            fromFret={Math.max(0, boxLowFret - 1)}
            toFret={Math.min(20, boxHighFret + 1)}
            highlight={highlight}
            labelMode="degree"
            activePosition={activePos}
          />
        )}
      </div>

      {/* 播放控制 */}
      <div className="card" style={{ textAlign: 'center' }}>
        <button className={'btn ' + (playing ? '' : 'btn-primary')} style={{ width: 200 }}
          onClick={async () => { await synth.unlock(); setPlaying(p => !p); }}>
          {playing ? '■ 停止' : '▶ 上下行示范'}
        </button>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-dim)' }}>从最低音上行 → 下行回到起点</div>
      </div>

      {/* 学习要点 */}
      <div className="section-title">学习要点</div>
      <div className="card">
        <p><b>🎯 第一步</b>：先死磕 <b>Box 1</b>。{pcToName(rootPc)} {def.name} 的 Box 1 起始根音在 6 弦 {boxLowFret} 品。
          反复来回弹这个 box，熟到能闭着眼弹。</p>
        <p><b>🎯 第二步</b>：用这个 box 在小调和弦背景下即兴。停在标红（根音 1）和绿色（5 度）上听感最稳。</p>
        <p><b>🎯 第三步</b>：学完 Box 1 再练 Box 2，注意两个 box 间的"连接音"——这是流畅 solo 的关键。</p>
        <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>💡 大调五声 = 同根音的小调五声往左数 3 个半音。例如 C 大调五声 = A 小调五声同样 5 个音。</p>
      </div>
    </div>
  );
}