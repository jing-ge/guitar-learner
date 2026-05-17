// 多帧/多和弦进行级评测：模拟用户连续弹一个 4-chord 走向
import { synthPcm, pcmToChroma } from './pcm-chroma.mjs';
import { voicingFor } from './synth-chroma.mjs';

/**
 * 评测一个和弦走向
 * @param {Array<{root:number, q:string, name:string}>} progressionChords - 走向里每个 chord 的 root/quality/name
 * @param {(chroma:number[]) => Array<{name:string, score:number}>} matchFn - 匹配函数，返回 top-k 列表
 * @param {{snrDb?:number, rand?:()=>number}} opts
 * @returns {{ progressionTop1: number, perChordTop1: number[], details: Array<{expected:string, predicted:string, score:number}> }}
 */
export function evaluateProgression(progressionChords, matchFn, opts = {}) {
  const snrDb = opts.snrDb ?? 20;
  const rand = opts.rand ?? Math.random;

  const perChordTop1 = [];
  const details = [];
  for (const chord of progressionChords) {
    const notes = voicingFor(chord.root, chord.q);
    const pcm = synthPcm(notes, { snrDb, rand });
    const chroma = pcmToChroma(pcm);
    const top = matchFn(chroma);
    const predicted = top[0]?.name ?? '(none)';
    const hit = predicted === chord.name ? 1 : 0;
    perChordTop1.push(hit);
    details.push({ expected: chord.name, predicted, score: top[0]?.score ?? 0 });
  }

  const allHit = perChordTop1.every(h => h === 1) ? 1 : 0;
  return { progressionTop1: allHit, perChordTop1, details };
}
