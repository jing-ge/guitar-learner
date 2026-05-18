/**
 * 和弦走向总结卡片 (Round 46 抽取自 ListenPage)
 *
 * 输入：已识别的和弦序列（按时间顺序）
 * 输出：
 *   - 主要和弦 top 6 (折叠相邻同根 → 频次降序 → 罗马数字)
 *   - 重复出现 ≥ 2 次的 4-chord 走向（如 I→V→vi→IV）
 */

const SHARP_NAMES_LOCAL = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT_TO_SHARP_LOCAL: Record<string,string> = { Bb:'A#', Db:'C#', Eb:'D#', Gb:'F#', Ab:'G#' };

const ROMAN_MAJOR = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
const ROMAN_MINOR = ['i', 'bii', 'ii', 'III', 'iii', 'iv', '#iv', 'v', 'VI', 'vi', 'VII', 'vii'];

export function parseRootPc(id: string): number {
  if (!id) return -1;
  let token = id[0];
  if (id[1] === '#' || id[1] === 'b') token = id.slice(0, 2);
  if (token.length === 2 && token[1] === 'b') {
    const mapped = FLAT_TO_SHARP_LOCAL[token];
    if (!mapped) return -1;
    token = mapped;
  }
  return SHARP_NAMES_LOCAL.indexOf(token);
}

export function simplifyQuality(q: string): 'M' | 'm' | 'd' | 'aug' | 'other' {
  if (q === 'major' || q === 'maj7' || q === 'dom7' || q === 'sus') return 'M';
  if (q === 'minor' || q === 'min7') return 'm';
  if (q === 'dim') return 'd';
  if (q === 'aug') return 'aug';
  return 'other';
}

export function toRoman(rootPc: number, quality: string, keyRoot: number, keyMode: 'major' | 'minor'): string {
  const interval = ((rootPc - keyRoot) % 12 + 12) % 12;
  const sq = simplifyQuality(quality);
  const baseTable = keyMode === 'major' ? ROMAN_MAJOR : ROMAN_MINOR;
  const symbol = baseTable[interval] ?? '?';
  if (sq === 'm') return symbol.toLowerCase();
  if (sq === 'd') return symbol.toLowerCase() + '°';
  return symbol;
}

export interface ChordSummary {
  uniqueChords: { name: string; count: number; roman: string }[];
  progressions: { chords: string[]; romans: string[]; count: number }[];
  totalFolded: number;
}

export function summarizeChords(
  history: { name: string; chordId: string }[],
  keyRoot: number | null,
  keyMode: 'major' | 'minor' | null,
): ChordSummary {
  if (history.length === 0) return { uniqueChords: [], progressions: [], totalFolded: 0 };

  // Step 1: 折叠相邻同根
  const folded: { name: string; rootPc: number; quality: string }[] = [];
  for (const h of history) {
    const rootPc = parseRootPc(h.chordId);
    if (rootPc < 0) continue;
    const id = h.chordId;
    const quality = (id.length >= 2 && (id.endsWith('m') || id === id.slice(0,1) + 'bm') && !id.endsWith('aj'))
      ? 'minor' : 'major';
    const last = folded[folded.length - 1];
    if (last && last.rootPc === rootPc) continue;
    folded.push({ name: h.name, rootPc, quality });
  }

  // Step 2: 频次 top 6
  const countMap = new Map<string, { rootPc: number; quality: string; count: number }>();
  for (const f of folded) {
    const e = countMap.get(f.name);
    if (e) e.count++;
    else countMap.set(f.name, { rootPc: f.rootPc, quality: f.quality, count: 1 });
  }
  const uniqueChords = [...countMap.entries()]
    .map(([name, { rootPc, quality, count }]) => ({
      name,
      count,
      roman: keyRoot !== null && keyMode ? toRoman(rootPc, quality, keyRoot, keyMode) : '',
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Step 3: 4-chord 重复走向
  const progMap = new Map<string, { chords: string[]; rootPcs: number[]; qualities: string[]; count: number }>();
  if (folded.length >= 4) {
    for (let i = 0; i <= folded.length - 4; i++) {
      const window = folded.slice(i, i + 4);
      const key = window.map(w => w.name).join('→');
      const e = progMap.get(key);
      if (e) e.count++;
      else progMap.set(key, {
        chords: window.map(w => w.name),
        rootPcs: window.map(w => w.rootPc),
        qualities: window.map(w => w.quality),
        count: 1,
      });
    }
  }
  const progressions = [...progMap.values()]
    .filter(p => p.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map(p => ({
      chords: p.chords,
      romans: keyRoot !== null && keyMode
        ? p.rootPcs.map((r, i) => toRoman(r, p.qualities[i], keyRoot, keyMode))
        : [],
      count: p.count,
    }));

  return { uniqueChords, progressions, totalFolded: folded.length };
}

export default function ChordSummaryCard({ summary }: { summary: ChordSummary }) {
  if (summary.uniqueChords.length === 0) return null;
  return (
    <div className="card">
      <h2>📊 走向总结</h2>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, marginBottom: 10 }}>
        已合并连续重复 · 折叠后 {summary.totalFolded} 个和弦
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 6 }}>主要和弦</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {summary.uniqueChords.map(c => (
            <div key={c.name} style={{
              display: 'inline-flex', flexDirection: 'column', alignItems: 'center',
              padding: '4px 10px', borderRadius: 8,
              background: 'var(--bg-soft)', border: '1px solid var(--line-soft)',
              minWidth: 50,
            }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--brand)' }}>{c.name}</span>
              {c.roman && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'serif' }}>{c.roman}</span>}
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>×{c.count}</span>
            </div>
          ))}
        </div>
      </div>

      {summary.progressions.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', marginBottom: 6 }}>主要走向（重复出现）</div>
          {summary.progressions.map((p, i) => (
            <div key={i} style={{
              padding: '8px 10px', marginBottom: 6, borderRadius: 8,
              background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-strong)', letterSpacing: 1 }}>
                {p.chords.join(' → ')}
              </div>
              {p.romans.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'serif', letterSpacing: 1 }}>
                  {p.romans.join(' → ')}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>出现 {p.count} 次</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
