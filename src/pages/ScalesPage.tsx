import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Fretboard from '../components/Fretboard';
import { ALL_ROOTS, fretToMidi, pcToName, semitonesToDegree } from '../theory/notes';
import { SCALES, scalePitchClasses, type ScaleDef } from '../theory/scales';
import { synth } from '../audio/synth';
import { pitchDetector, type PitchResult } from '../audio/pitch-detector';
import { vibrate } from '../utils/haptic';
import { recordSession } from '../utils/progress';

type PageMode = 'learn' | 'earTest' | 'playTest' | 'followAlong';

export default function ScalesPage() {
  const [rootPc, setRootPc] = useState(0);
  const [scaleId, setScaleId] = useState<string>('major');
  const [labelMode, setLabelMode] = useState<'name' | 'degree' | 'none'>('degree');
  const [pageMode, setPageMode] = useState<PageMode>('learn');
  const [activePos, setActivePos] = useState<{ stringNum: number; fret: number } | null>(null);
  const activePosTimers = useRef<number[]>([]);
  const [scaleSpeed, setScaleSpeed] = useState(220); // ms per note

  const scale = useMemo<ScaleDef>(() => SCALES.find(s => s.id === scaleId) || SCALES[0], [scaleId]);
  const pcs = useMemo(() => scalePitchClasses(rootPc, scale), [rootPc, scale]);

  const highlight = useMemo(() => {
    const colors: Record<number, string> = {};
    pcs.forEach((pc, idx) => { colors[pc] = idx === 0 ? '#ef4444' : '#06b6d4'; });
    return { pcColors: colors, rootPc, onlyPcs: pcs };
  }, [pcs, rootPc]);

  const playScale = async (asc = true) => {
    await synth.unlock();
    // 清理之前的定时器
    activePosTimers.current.forEach(t => clearTimeout(t));
    activePosTimers.current = [];

    const positions: { stringNum: 1|2|3|4|5|6; fret: number }[] = [];
    for (let s = 6 as 1|2|3|4|5|6; s >= 1; s = (s - 1) as any) {
      for (let f = 0; f <= 4; f++) {
        const pc = ((fretToMidi(s, f) % 12) + 12) % 12;
        if (pcs.includes(pc)) positions.push({ stringNum: s, fret: f });
      }
      if (s === 1) break;
    }
    positions.sort((a, b) => fretToMidi(a.stringNum, a.fret) - fretToMidi(b.stringNum, b.fret));
    const seq = asc ? positions : [...positions].reverse();

    const interval = scaleSpeed;
    seq.forEach((p, i) => {
      synth.playFret(p.stringNum, p.fret, 1.6, i * (interval / 1000));
      // 同步高亮
      const tid = window.setTimeout(() => {
        setActivePos({ stringNum: p.stringNum, fret: p.fret });
      }, i * interval);
      activePosTimers.current.push(tid);
    });
    // 播放结束后清除高亮
    const endTid = window.setTimeout(() => {
      setActivePos(null);
    }, seq.length * interval + 800);
    activePosTimers.current.push(endTid);
  };

  // 切换模式时停止检测
  useEffect(() => {
    if (pageMode !== 'playTest' && pageMode !== 'followAlong') pitchDetector.stop();
  }, [pageMode]);

  return (
    <div>
      {/* 模式切换 */}
      <div className="chip-row" style={{ marginBottom: 10 }}>
        <button className={'chip' + (pageMode === 'learn' ? ' active' : '')} onClick={() => setPageMode('learn')}>📖 学习</button>
        <button className={'chip' + (pageMode === 'earTest' ? ' active' : '')} onClick={() => setPageMode('earTest')}>👂 听音测试</button>
        <button className={'chip' + (pageMode === 'playTest' ? ' active' : '')} onClick={() => setPageMode('playTest')}>🎸 弹琴识别</button>
        <button className={'chip' + (pageMode === 'followAlong' ? ' active' : '')} onClick={() => setPageMode('followAlong')}>🏃 跟弹通关</button>
      </div>

      {/* 调性/音阶选择（所有模式共用） */}
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="field">
          <label className="field-label">主音</label>
          <select className="select" value={rootPc} onChange={e => setRootPc(+e.target.value)}>
            {ALL_ROOTS.map(r => (<option key={r.pc} value={r.pc}>{r.sharp}{r.sharp !== r.flat ? ` / ${r.flat}` : ''}</option>))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">音阶</label>
          <select className="select" value={scaleId} onChange={e => setScaleId(e.target.value)}>
            {SCALES.map(s => (<option key={s.id} value={s.id}>{s.name}</option>))}
          </select>
        </div>
        {pageMode === 'learn' && (
          <div className="field">
            <label className="field-label">标签</label>
            <select className="select" value={labelMode} onChange={e => setLabelMode(e.target.value as any)}>
              <option value="degree">度数</option>
              <option value="name">音名</option>
              <option value="none">不显示</option>
            </select>
          </div>
        )}
      </div>

      {/* === 学习模式 === */}
      {pageMode === 'learn' && (
        <>
          <div className="card">
            <h2>{pcToName(rootPc)} {scale.name}</h2>
            <p>{scale.desc}</p>
            <div style={{ marginTop: 8 }}><b>组成音：</b><span style={{ color: 'var(--primary)', letterSpacing: 1 }}>{pcs.map(pc => pcToName(pc)).join(' - ')}</span></div>
            <div style={{ marginTop: 4 }}><b>度数：</b><span style={{ color: 'var(--text-dim)' }}>{pcs.map(pc => semitonesToDegree(pc - rootPc)).join(' - ')}</span></div>
            <div className="btn-row" style={{ marginTop: 12, alignItems: 'center' }}>
              <button className="btn btn-primary btn-sm" onClick={() => playScale(true)}>▶ 上行</button>
              <button className="btn btn-sm" onClick={() => playScale(false)}>◀ 下行</button>
              <span style={{ fontSize: 12, color: 'var(--text-dim)', marginLeft: 4 }}>速度</span>
              {([['慢',400],['中',220],['快',120]] as [string,number][]).map(([l,v]) => (
                <button key={l} className={'chip' + (scaleSpeed === v ? ' active' : '')} style={{ height: 28, fontSize: 12 }}
                  onClick={() => setScaleSpeed(v)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="fretboard-wrap">
            <Fretboard fromFret={0} toFret={12} highlight={highlight} labelMode={labelMode} activePosition={activePos} />
          </div>
          <p className="fretboard-hint">🔴 红色 = 主音；点击可试听。播放时会逐个高亮经过的音。</p>
        </>
      )}

      {/* === 听音测试：app 播放音阶中一个音，你来选 === */}
      {pageMode === 'earTest' && <EarTest pcs={pcs} rootPc={rootPc} scaleName={scale.name} />}

      {/* === 弹琴识别：app 出题，你弹给麦克风听 === */}
      {pageMode === 'playTest' && <PlayTest pcs={pcs} rootPc={rootPc} scaleName={scale.name} />}

      {/* === 跟弹通关：按顺序弹完整条音阶 === */}
      {pageMode === 'followAlong' && <FollowAlong pcs={pcs} rootPc={rootPc} scaleName={scale.name} />}
    </div>
  );
}

/* =========== 听音测试 =========== */
function EarTest({ pcs, rootPc, scaleName }: { pcs: number[]; rootPc: number; scaleName: string }) {
  const [targetIdx, setTargetIdx] = useState(() => Math.floor(Math.random() * pcs.length));
  const [answered, setAnswered] = useState<{ pc: number; correct: boolean } | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });

  const targetPc = pcs[targetIdx];

  const playTarget = async () => {
    await synth.unlock();
    synth.playMidi(60 + targetPc, 2.5);  // 在中央 C 附近的八度内播放
  };

  const choose = (pc: number) => {
    if (answered) return;
    const correct = pc === targetPc;
    setAnswered({ pc, correct });
    setScore(s => ({ right: s.right + (correct ? 1 : 0), total: s.total + 1 }));
  };

  const next = () => {
    setAnswered(null);
    let n = targetIdx;
    while (n === targetIdx && pcs.length > 1) n = Math.floor(Math.random() * pcs.length);
    setTargetIdx(n);
  };

  return (
    <>
      <div className="quiz-prompt">
        在 {pcToName(rootPc)} {scaleName} 中听音辨认
      </div>
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <button className="btn btn-primary" onClick={playTarget}>▶ 播放一个音</button>
        <button className="btn" style={{ marginLeft: 8 }} onClick={next}>↻ 换一题</button>
      </div>
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>得分：<b>{score.right}</b> / {score.total}</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>选出你听到的音名</div>
      </div>
      <div className="chip-row" style={{ marginTop: 8, justifyContent: 'center' }}>
        {pcs.map((pc, i) => {
          const isChosen = answered?.pc === pc;
          const isRight = answered?.correct && isChosen;
          const isWrong = answered && !answered.correct && isChosen;
          const isAnswer = answered && pc === targetPc;
          let style: React.CSSProperties | undefined;
          if (isAnswer) style = { background: 'var(--green)', color: '#fff', borderColor: 'var(--green)' };
          else if (isWrong) style = { background: 'var(--danger)', color: '#fff', borderColor: 'var(--danger)' };
          return (
            <button key={`${pc}-${i}`} className={'chip' + (isRight ? ' active' : '')} style={{ minWidth: 48, ...style }}
              onClick={() => choose(pc)} disabled={!!answered}>
              {pcToName(pc)}
            </button>
          );
        })}
      </div>
      {answered && (
        <div className={'quiz-feedback ' + (answered.correct ? 'right' : 'wrong')}>
          {answered.correct ? `正确！这是 ${pcToName(targetPc)}` : `正确答案是 ${pcToName(targetPc)}`}
          <div style={{ marginTop: 8 }}><button className="btn btn-primary btn-sm" onClick={next}>下一题 →</button></div>
        </div>
      )}
    </>
  );
}

/* =========== 弹琴识别练习 =========== */
function PlayTest({ pcs, rootPc, scaleName }: { pcs: number[]; rootPc: number; scaleName: string }) {
  const [targetIdx, setTargetIdx] = useState(() => Math.floor(Math.random() * pcs.length));
  const [listening, setListening] = useState(false);
  const [detected, setDetected] = useState<PitchResult | null>(null);
  const [result, setResult] = useState<'right' | 'wrong' | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0 });
  const stableCountRef = useRef(0);
  const lastPcRef = useRef(-1);

  const targetPc = pcs[targetIdx];

  const startListening = useCallback(async () => {
    setResult(null);
    setDetected(null);
    stableCountRef.current = 0;
    lastPcRef.current = -1;
    try {
      await pitchDetector.start((p) => {
        setDetected(p);
        if (!p) { stableCountRef.current = 0; return; }
        // 需要同一个音连续稳定 ~8 帧才判定（防止噪声误判）
        if (p.pc === lastPcRef.current && Math.abs(p.cents) < 40) {
          stableCountRef.current++;
        } else {
          lastPcRef.current = p.pc;
          stableCountRef.current = 1;
        }
        if (stableCountRef.current >= 8) {
          const correct = p.pc === targetPc;
          setResult(correct ? 'right' : 'wrong');
          setScore(s => ({ right: s.right + (correct ? 1 : 0), total: s.total + 1 }));
          pitchDetector.stop();
          setListening(false);
        }
      });
      setListening(true);
    } catch {
      setResult(null);
    }
  }, [targetPc]);

  const next = () => {
    pitchDetector.stop();
    setListening(false);
    setResult(null);
    setDetected(null);
    let n = targetIdx;
    while (n === targetIdx && pcs.length > 1) n = Math.floor(Math.random() * pcs.length);
    setTargetIdx(n);
  };

  // 页面卸载停止
  useEffect(() => () => { pitchDetector.stop(); }, []);

  return (
    <>
      <div className="quiz-prompt">
        请弹出：<span style={{ color: 'var(--primary)', fontSize: 28 }}>{pcToName(targetPc)}</span>
        <div style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-dim)', marginTop: 4 }}>
          {pcToName(rootPc)} {scaleName} 中的音
        </div>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        {!listening && !result && (
          <button className="btn btn-primary" onClick={startListening}>🎤 开始听我弹</button>
        )}
        {listening && (
          <button className="btn" onClick={() => { pitchDetector.stop(); setListening(false); }}>■ 停止</button>
        )}
      </div>

      {/* 实时显示 */}
      {listening && (
        <div className="tuner-result" style={{ marginBottom: 10 }}>
          {detected ? (
            <>
              <div className="tuner-note">{detected.noteOnly}<span className="tuner-octave">{detected.noteName.replace(detected.noteOnly, '')}</span></div>
              <div className="tuner-freq">{detected.freq.toFixed(1)} Hz</div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>稳定检测中…请保持弹奏</div>
            </>
          ) : (
            <div className="tuner-note" style={{ color: 'var(--text-dim)', fontSize: 16 }}>正在听…请弹一个音</div>
          )}
        </div>
      )}

      {/* 结果 */}
      {result && (
        <div className={'quiz-feedback ' + result} style={{ fontSize: 16 }}>
          {result === 'right' ? `正确！你弹的是 ${pcToName(targetPc)}` : `你弹的是 ${detected ? pcToName(detected.pc) : '?'}，目标是 ${pcToName(targetPc)}`}
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={next}>下一题 →</button>
          </div>
        </div>
      )}

      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
        <div>得分：<b>{score.right}</b> / {score.total}</div>
        <button className="btn btn-sm" onClick={next}>换一题 →</button>
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <p style={{ fontSize: 13 }}>💡 <b>提示</b>：先用「🎛 调音器」把琴调准，识别会更准确。弹奏时让音清晰响亮，避免同时弹多根弦。</p>
      </div>
    </>
  );
}

/* =========== 跟弹通关 =========== */
function FollowAlong({ pcs, rootPc, scaleName }: { pcs: number[]; rootPc: number; scaleName: string }) {
  const [step, setStep] = useState(0);
  const [listening, setListening] = useState(false);
  const [detected, setDetected] = useState<PitchResult | null>(null);
  const [finished, setFinished] = useState(false);
  const stableRef = useRef(0);
  const lastPcRef = useRef(-1);
  const stepRef = useRef(0);
  const startTimeRef = useRef(0);

  // 上行 + 下行 = 完整一轮
  const fullSequence = useMemo(() => [...pcs, ...[...pcs].reverse().slice(1)], [pcs]);
  const currentTarget = fullSequence[step];

  const start = useCallback(async () => {
    setStep(0); stepRef.current = 0;
    setFinished(false);
    stableRef.current = 0;
    lastPcRef.current = -1;
    startTimeRef.current = Date.now();
    try {
      await pitchDetector.start((p) => {
        setDetected(p);
        if (!p) { stableRef.current = 0; return; }
        if (p.pc === lastPcRef.current && Math.abs(p.cents) < 40) {
          stableRef.current++;
        } else {
          lastPcRef.current = p.pc;
          stableRef.current = 1;
        }
        if (stableRef.current >= 6) {
          const target = fullSequence[stepRef.current];
          if (p.pc === target) {
            vibrate(15);
            const next = stepRef.current + 1;
            if (next >= fullSequence.length) {
              pitchDetector.stop();
              setFinished(true);
              setListening(false);
              const secs = Math.round((Date.now() - startTimeRef.current) / 1000);
              recordSession('scale-follow', fullSequence.length, fullSequence.length, secs);
            } else {
              stepRef.current = next;
              setStep(next);
            }
            stableRef.current = 0;
            lastPcRef.current = -1;
          }
        }
      });
      setListening(true);
    } catch {}
  }, [fullSequence]);

  useEffect(() => () => { pitchDetector.stop(); }, []);

  return (
    <>
      <div className="quiz-prompt">
        {finished ? (
          <span style={{ color: 'var(--green)' }}>通关！{pcToName(rootPc)} {scaleName} 完整上下行</span>
        ) : (
          <>
            弹出：<span style={{ color: 'var(--primary)', fontSize: 28 }}>{pcToName(currentTarget)}</span>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
              {step + 1} / {fullSequence.length} · {step < pcs.length ? '上行' : '下行'}
            </div>
          </>
        )}
      </div>

      {/* 进度条 */}
      <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', margin: '0 0 12px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(step / fullSequence.length) * 100}%`, background: finished ? 'var(--green)' : 'var(--primary)', transition: 'width .2s' }} />
      </div>

      {/* 音阶音展示 */}
      <div className="chip-row" style={{ justifyContent: 'center', marginBottom: 10 }}>
        {fullSequence.map((pc, i) => (
          <span key={i} style={{
            display: 'inline-block', width: 28, height: 28, lineHeight: '28px', borderRadius: '50%',
            textAlign: 'center', fontSize: 11, fontWeight: 600,
            background: i < step ? 'var(--green)' : i === step ? 'var(--primary)' : 'var(--bg-soft)',
            color: i <= step ? '#fff' : 'var(--text-dim)',
            border: i === step ? '2px solid #fff' : '1px solid var(--border)',
          }}>
            {pcToName(pc).charAt(0)}{pcToName(pc).includes('#') ? '#' : ''}
          </span>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        {!listening && !finished && <button className="btn btn-primary" onClick={start}>🎤 开始跟弹</button>}
        {listening && <button className="btn" onClick={() => { pitchDetector.stop(); setListening(false); }}>■ 停止</button>}
        {finished && <button className="btn btn-primary" onClick={start}>🔄 再来一轮</button>}
      </div>

      {listening && detected && (
        <div className="tuner-result">
          <div className="tuner-note">{detected.noteOnly}<span className="tuner-octave">{detected.noteName.replace(detected.noteOnly, '')}</span></div>
          <div className="tuner-freq">{detected.freq.toFixed(1)} Hz</div>
        </div>
      )}

      <div className="card">
        <p style={{ fontSize: 13 }}>💡 从音阶的第一个音弹到最高音再弹回来。弹对一个自动跳到下一个。练习完整的肌肉记忆路径。</p>
      </div>
    </>
  );
}