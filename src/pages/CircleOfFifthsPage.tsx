import { useMemo, useState, useCallback } from 'react';
import SubpageHero from '../components/SubpageHero';
import { SHARP_NAMES, pcToName } from '../theory/notes';
import { synth } from '../audio/synth';
import { CHORDS, chordPlayablePositions } from '../theory/chords';

type ViewMode = 'learn' | 'quiz';

const MODE_META: Record<ViewMode, { label: string; title: string; desc: string }> = {
  learn: {
    label: '📖 学习',
    title: '五度圈',
    desc: '点击圈上调号查看音阶、顺阶和弦与相邻调性',
  },
  quiz: {
    label: '🎯 问答练习',
    title: '五度圈问答',
    desc: '上方五度 / 关系小调 / 调号辨认 三类问题随机抽',
  },
};

// 五度圈顺序（顺时针，从 C 开始，每次 +7 半音）
const FIFTHS_ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]; // C G D A E B F#/Gb Db Ab Eb Bb F
const MAJOR_NAMES = ['C','G','D','A','E','B','F#/Gb','Db','Ab','Eb','Bb','F'];
const MINOR_NAMES = ['Am','Em','Bm','F#m','C#m','G#m','D#m/Ebm','Bbm','Fm','Cm','Gm','Dm'];

// 每个大调的升降号数量
const KEY_SIGS = [0,1,2,3,4,5,6,-5,-4,-3,-2,-1]; // 正=升号，负=降号

// 五度圈上的颜色
const SEGMENT_COLORS = [
  '#ef4444','#f97316','#f59e0b','#eab308','#84cc16','#22c55e',
  '#14b8a6','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#a855f7'
];

interface CircleSvgProps {
  selected: number;        // 0-11 在 FIFTHS_ORDER 中的 index
  onSelect: (idx: number) => void;
  showMinor: boolean;
}

/** SVG 五度圈 */
function CircleSvg({ selected, onSelect, showMinor }: CircleSvgProps) {
  const cx = 200, cy = 200;
  const outerR = 170, innerR = 108, minorR = 70;

  return (
    <svg viewBox="0 0 400 400" style={{ width: '100%', maxWidth: 380, display: 'block', margin: '0 auto', touchAction: 'manipulation' }}>
      {/* 底色 */}
      <circle cx={cx} cy={cy} r={outerR + 8} fill="#1a2128" stroke="#374151" strokeWidth={2} />

      {/* 12 个扇区 */}
      {FIFTHS_ORDER.map((_, idx) => {
        const angle = (idx * 30 - 90) * Math.PI / 180;
        const nextAngle = ((idx + 1) * 30 - 90) * Math.PI / 180;
        const isActive = idx === selected;

        // 外弧
        const x1o = cx + outerR * Math.cos(angle);
        const y1o = cy + outerR * Math.sin(angle);
        const x2o = cx + outerR * Math.cos(nextAngle);
        const y2o = cy + outerR * Math.sin(nextAngle);
        // 内弧
        const x1i = cx + innerR * Math.cos(nextAngle);
        const y1i = cy + innerR * Math.sin(nextAngle);
        const x2i = cx + innerR * Math.cos(angle);
        const y2i = cy + innerR * Math.sin(angle);

        const path = `M ${x1o} ${y1o} A ${outerR} ${outerR} 0 0 1 ${x2o} ${y2o}
                       L ${x1i} ${y1i} A ${innerR} ${innerR} 0 0 0 ${x2i} ${y2i} Z`;

        // 标签位置
        const midAngle = ((idx + 0.5) * 30 - 90) * Math.PI / 180;
        const labelR = (outerR + innerR) / 2;
        const lx = cx + labelR * Math.cos(midAngle);
        const ly = cy + labelR * Math.sin(midAngle);

        return (
          <g key={idx} onClick={() => onSelect(idx)} style={{ cursor: 'pointer' }}>
            <path
              d={path}
              fill={isActive ? SEGMENT_COLORS[idx] : '#2a3540'}
              stroke={isActive ? '#fff' : '#4b5563'}
              strokeWidth={isActive ? 2.5 : 1}
              opacity={isActive ? 1 : 0.85}
            />
            <text
              x={lx} y={ly + 5}
              fontSize={isActive ? 16 : 13}
              fontWeight={isActive ? 700 : 500}
              fill={isActive ? '#fff' : '#d1d5db'}
              textAnchor="middle"
            >
              {MAJOR_NAMES[idx]}
            </text>
          </g>
        );
      })}

      {/* 内圈：关系小调 */}
      {showMinor && FIFTHS_ORDER.map((_, idx) => {
        const angle = (idx * 30 - 90) * Math.PI / 180;
        const nextAngle = ((idx + 1) * 30 - 90) * Math.PI / 180;
        const isActive = idx === selected;

        const x1o = cx + innerR * Math.cos(angle);
        const y1o = cy + innerR * Math.sin(angle);
        const x2o = cx + innerR * Math.cos(nextAngle);
        const y2o = cy + innerR * Math.sin(nextAngle);
        const x1i = cx + minorR * Math.cos(nextAngle);
        const y1i = cy + minorR * Math.sin(nextAngle);
        const x2i = cx + minorR * Math.cos(angle);
        const y2i = cy + minorR * Math.sin(angle);

        const path = `M ${x1o} ${y1o} A ${innerR} ${innerR} 0 0 1 ${x2o} ${y2o}
                       L ${x1i} ${y1i} A ${minorR} ${minorR} 0 0 0 ${x2i} ${y2i} Z`;

        const midAngle = ((idx + 0.5) * 30 - 90) * Math.PI / 180;
        const labelR2 = (innerR + minorR) / 2;
        const lx = cx + labelR2 * Math.cos(midAngle);
        const ly = cy + labelR2 * Math.sin(midAngle);

        return (
          <g key={`m-${idx}`} onClick={() => onSelect(idx)} style={{ cursor: 'pointer' }}>
            <path
              d={path}
              fill={isActive ? SEGMENT_COLORS[idx] + '99' : '#161d24'}
              stroke={isActive ? '#fff' : '#374151'}
              strokeWidth={isActive ? 1.5 : 0.8}
              opacity={isActive ? 1 : 0.7}
            />
            <text
              x={lx} y={ly + 4}
              fontSize={isActive ? 12 : 10}
              fontWeight={isActive ? 700 : 400}
              fill={isActive ? '#fff' : '#9ca3af'}
              textAnchor="middle"
            >
              {MINOR_NAMES[idx]}
            </text>
          </g>
        );
      })}

      {/* 中心装饰 */}
      <circle cx={cx} cy={cy} r={showMinor ? minorR - 2 : innerR - 2} fill="#0f1419" stroke="#374151" strokeWidth={1} />
      <text x={cx} y={cy - 6} fontSize={14} fontWeight={600} fill="#f59e0b" textAnchor="middle">五度圈</text>
      <text x={cx} y={cy + 12} fontSize={10} fill="#9ca3af" textAnchor="middle">Circle of Fifths</text>
    </svg>
  );
}

export default function CircleOfFifthsPage() {
  const [mode, setMode] = useState<ViewMode>('learn');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showMinor, setShowMinor] = useState(true);

  // === 测验状态 ===
  const [quizType, setQuizType] = useState<'next5th' | 'relative' | 'keysig'>('next5th');
  const [quizTarget, setQuizTarget] = useState(() => Math.floor(Math.random() * 12));
  const [quizAnswered, setQuizAnswered] = useState<{ correct: boolean; answer: string } | null>(null);
  const [quizScore, setQuizScore] = useState({ right: 0, total: 0 });

  const selectedPc = FIFTHS_ORDER[selectedIdx];

  // 调内的自然音阶
  const scaleNotes = useMemo(() => {
    const intervals = [0, 2, 4, 5, 7, 9, 11];
    return intervals.map(i => pcToName((selectedPc + i) % 12));
  }, [selectedPc]);

  // 调内顺阶和弦
  const diatonicChords = useMemo(() => {
    const patterns: { degree: string; interval: number; quality: 'major' | 'minor' | 'dim' }[] = [
      { degree: 'I',   interval: 0,  quality: 'major' },
      { degree: 'ii',  interval: 2,  quality: 'minor' },
      { degree: 'iii', interval: 4,  quality: 'minor' },
      { degree: 'IV',  interval: 5,  quality: 'major' },
      { degree: 'V',   interval: 7,  quality: 'major' },
      { degree: 'vi',  interval: 9,  quality: 'minor' },
      { degree: 'vii°',interval: 11, quality: 'dim'   },
    ];
    return patterns.map(p => ({
      ...p,
      root: pcToName((selectedPc + p.interval) % 12),
      name: pcToName((selectedPc + p.interval) % 12) + (p.quality === 'minor' ? 'm' : p.quality === 'dim' ? 'dim' : ''),
    }));
  }, [selectedPc]);

  // 相邻调性
  const neighbors = useMemo(() => ({
    dominant: MAJOR_NAMES[(selectedIdx + 1) % 12],     // 属调（顺时针一步）
    subdominant: MAJOR_NAMES[(selectedIdx + 11) % 12], // 下属调（逆时针一步）
    relativeMinor: MINOR_NAMES[selectedIdx],
  }), [selectedIdx]);

  const keySigText = useMemo(() => {
    const n = KEY_SIGS[selectedIdx];
    if (n === 0) return '无升降号';
    if (n > 0) return `${n} 个升号（#）`;
    return `${Math.abs(n)} 个降号（b）`;
  }, [selectedIdx]);

  // 播放和弦
  const playChordByName = useCallback(async (name: string) => {
    await synth.unlock();
    const chord = CHORDS.find(c => c.id === name || c.name === name);
    if (chord) {
      synth.strum(chordPlayablePositions(chord.shapes[0]));
    } else {
      // 简单播放三和弦根音
      const pc = SHARP_NAMES.indexOf(name.replace(/m$/, '') as any);
      if (pc >= 0) synth.playMidi(48 + pc);
    }
  }, []);

  // === 测验逻辑 ===
  const quizQuestion = useMemo(() => {
    const t = quizTarget;
    switch (quizType) {
      case 'next5th':
        return { prompt: `${MAJOR_NAMES[t]} 的上方纯五度是？`, answer: MAJOR_NAMES[(t + 1) % 12] };
      case 'relative':
        return { prompt: `${MAJOR_NAMES[t]} 大调的关系小调是？`, answer: MINOR_NAMES[t] };
      case 'keysig': {
        const n = KEY_SIGS[t];
        const sig = n === 0 ? '无升降号' : n > 0 ? `${n} 个升号` : `${Math.abs(n)} 个降号`;
        return { prompt: `${sig} 对应什么大调？`, answer: MAJOR_NAMES[t] };
      }
    }
  }, [quizType, quizTarget]);

  const quizOptions = useMemo(() => {
    // 生成 6 个选项（含正确答案）
    const correctIdx = quizTarget;
    const optIdxs = new Set<number>([correctIdx]);
    while (optIdxs.size < Math.min(6, 12)) {
      optIdxs.add(Math.floor(Math.random() * 12));
    }
    const type = quizType;
    return [...optIdxs].sort(() => Math.random() - 0.5).map(idx => {
      switch (type) {
        case 'next5th': return MAJOR_NAMES[(idx + 1) % 12];
        case 'relative': return MINOR_NAMES[idx];
        case 'keysig': return MAJOR_NAMES[idx];
      }
    });
  }, [quizType, quizTarget]);

  const nextQuiz = () => {
    setQuizAnswered(null);
    let n = quizTarget;
    while (n === quizTarget) n = Math.floor(Math.random() * 12);
    setQuizTarget(n);
  };

  const handleQuizAnswer = (ans: string) => {
    if (quizAnswered) return;
    const correct = ans === quizQuestion.answer;
    setQuizAnswered({ correct, answer: ans });
    setQuizScore(s => ({ right: s.right + (correct ? 1 : 0), total: s.total + 1 }));
  };

  return (
    <div>
      <SubpageHero
        eyebrow="LEARN · CIRCLE"
        title={MODE_META[mode].title}
        desc={`${MODE_META[mode].desc} · 当前调：${MAJOR_NAMES[selectedIdx]} / ${MINOR_NAMES[selectedIdx]}`}
        rightSlot={
          <button
            className={'chip' + (showMinor ? ' active' : '')}
            onClick={() => setShowMinor(v => !v)}
            style={{ height: 32 }}
          >
            {showMinor ? '隐藏小调' : '显示小调'}
          </button>
        }
      >
        <div className="subpage-segmented" role="tablist">
          {(['learn', 'quiz'] as ViewMode[]).map(m => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'active' : ''}
              onClick={() => {
                setMode(m);
                if (m === 'quiz') { setQuizAnswered(null); setQuizScore({ right: 0, total: 0 }); }
              }}
            >
              {MODE_META[m].label}
            </button>
          ))}
        </div>
      </SubpageHero>

      {/* 五度圈 SVG */}
      <CircleSvg selected={selectedIdx} onSelect={setSelectedIdx} showMinor={showMinor} />

      {mode === 'learn' && (
        <>
          {/* 选中调性详情 */}
          <div className="card" style={{ marginTop: 12 }}>
            <h2 style={{ color: SEGMENT_COLORS[selectedIdx] }}>
              {MAJOR_NAMES[selectedIdx]} 大调 / {MINOR_NAMES[selectedIdx]}
            </h2>
            <p><b>调号：</b>{keySigText}</p>
            <p><b>音阶组成：</b><span style={{ color: 'var(--primary)', letterSpacing: 1 }}>{scaleNotes.join(' - ')}</span></p>
            <p>
              <b>属调（V）：</b>{neighbors.dominant} &nbsp;|&nbsp;
              <b>下属调（IV）：</b>{neighbors.subdominant} &nbsp;|&nbsp;
              <b>关系小调：</b>{neighbors.relativeMinor}
            </p>
          </div>

          {/* 顺阶和弦 */}
          <div className="section-title">顺阶和弦</div>
          <div className="chip-row">
            {diatonicChords.map(c => (
              <button key={c.degree} className="chip" onClick={() => playChordByName(c.name)} style={{ minWidth: 52 }}>
                <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{c.degree}</span>
                &nbsp;{c.name}
              </button>
            ))}
          </div>

          {/* 常见走向 */}
          <div className="section-title">常用和弦走向（五度圈规律）</div>
          <div className="card">
            <p>五度圈上<b>逆时针移动 = 属→主解决</b>（V→I），是流行/爵士最常见的进行：</p>
            <p style={{ color: 'var(--primary)', fontSize: 15, fontWeight: 600, letterSpacing: 1.5 }}>
              {diatonicChords[1].name} → {diatonicChords[4].name} → {diatonicChords[0].name}
              &nbsp; (ii - V - I)
            </p>
            <p style={{ color: 'var(--accent)', fontSize: 15, fontWeight: 600, letterSpacing: 1.5 }}>
              {diatonicChords[0].name} → {diatonicChords[4].name} → {diatonicChords[5].name} → {diatonicChords[3].name}
              &nbsp; (I - V - vi - IV)
            </p>
          </div>

          {/* 知识讲解 */}
          <div className="section-title">五度圈核心知识</div>
          <div className="card">
            <p><b>什么是五度圈？</b>从 C 开始，每次上行纯五度（+7 半音），经过全部 12 个音回到 C。</p>
            <p><b>顺时针 = 升号增加</b>：C(0) → G(1#) → D(2#) → A(3#) → E(4#) → B(5#)</p>
            <p><b>逆时针 = 降号增加</b>：C(0) → F(1b) → Bb(2b) → Eb(3b) → Ab(4b) → Db(5b)</p>
            <p><b>相邻调性</b>只差一个升/降号，和弦大部分相同，适合转调。</p>
            <p><b>关系大小调</b>（内外圈同一扇区）共享相同的调号和音阶音。</p>
            <p><b>V→I 解决</b>：五度圈上逆时针一步就是属→主的解决，是和声进行最基本的动力。</p>
          </div>
        </>
      )}

      {mode === 'quiz' && (
        <>
          {/* 测验类型 */}
          <div className="subpage-segmented" role="tablist" style={{ margin: '12px 0' }}>
            <button
              role="tab"
              aria-selected={quizType === 'next5th'}
              className={quizType === 'next5th' ? 'active' : ''}
              onClick={() => { setQuizType('next5th'); nextQuiz(); }}
            >上方五度</button>
            <button
              role="tab"
              aria-selected={quizType === 'relative'}
              className={quizType === 'relative' ? 'active' : ''}
              onClick={() => { setQuizType('relative'); nextQuiz(); }}
            >关系小调</button>
            <button
              role="tab"
              aria-selected={quizType === 'keysig'}
              className={quizType === 'keysig' ? 'active' : ''}
              onClick={() => { setQuizType('keysig'); nextQuiz(); }}
            >调号辨认</button>
          </div>

          <div className="quiz-prompt">{quizQuestion.prompt}</div>

          <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>得分：<b>{quizScore.right}</b> / {quizScore.total}</div>
            <button className="btn btn-sm" onClick={nextQuiz}>换一题 →</button>
          </div>

          <div className="chip-row" style={{ marginTop: 10, justifyContent: 'center' }}>
            {quizOptions.map((opt, i) => {
              const isChosen = quizAnswered?.answer === opt;
              const isCorrect = opt === quizQuestion.answer;
              let style: React.CSSProperties | undefined;
              if (quizAnswered) {
                if (isCorrect) style = { background: 'var(--green)', color: '#fff', borderColor: 'var(--green)' };
                else if (isChosen && !quizAnswered.correct) style = { background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' };
              }
              return (
                <button
                  key={`${opt}-${i}`}
                  className="chip"
                  style={{ ...style, minWidth: 56 }}
                  onClick={() => handleQuizAnswer(opt)}
                  disabled={!!quizAnswered}
                >
                  {opt}
                </button>
              );
            })}
          </div>

          {quizAnswered && (
            <div className={'quiz-feedback ' + (quizAnswered.correct ? 'right' : 'wrong')}>
              {quizAnswered.correct
                ? `正确！答案是 ${quizQuestion.answer}`
                : `正确答案是 ${quizQuestion.answer}`}
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-primary btn-sm" onClick={nextQuiz}>下一题 →</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}