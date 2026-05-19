/**
 * Round 63: 共享 UI 组件
 *
 * 抽出 R47-62 累积 6+ 组件中重复的 inline style 模式:
 *   - 卡片容器 (Card normal/highlight/weak/danger)
 *   - 徽章 (Badge brand/muted/warn/success)
 *   - 和弦链 (ChordChain - 走向卡片里的 D → A → Bm → G)
 *   - Stat 块 (label + value + sub)
 *
 * 设计原则:
 *   - 纯 styled wrapper, 不引入新 state
 *   - 视觉 token 化: 用 CSS var (--brand / --text-strong / --bg-soft 等)
 *   - 不引入 styled-components / emotion (项目零运行时 CSS-in-JS)
 *   - 不替换 className="card" 的全局样式 (那是 global.css 已有的, 留)
 *
 * R63 任务 1: 全量替换 ChordSummaryCard / FretboardMap / RhythmScoreTrainer / ProgressionEarTrainer
 *           / MelodyTimeline / PlaybackControls 的 inline style 卡片
 */

import type { CSSProperties, ReactNode } from 'react';

// ============ Card ============

export type CardVariant = 'normal' | 'highlight' | 'weak' | 'danger';

const CARD_VARIANTS: Record<CardVariant, { background: string; borderColor: string }> = {
  normal: {
    background: 'var(--bg-soft)',
    borderColor: 'var(--line-soft)',
  },
  highlight: {
    background: 'rgba(245,158,11,0.10)',
    borderColor: 'rgba(245,158,11,0.30)',
  },
  weak: {
    background: 'rgba(245,158,11,0.05)',
    borderColor: 'rgba(245,158,11,0.18)',
  },
  danger: {
    background: 'rgba(239,68,68,0.06)',
    borderColor: 'rgba(239,68,68,0.18)',
  },
};

interface CardProps {
  variant?: CardVariant;
  padding?: number | string;
  marginBottom?: number;
  children: ReactNode;
  /** 额外样式覆盖 */
  style?: CSSProperties;
  onClick?: () => void;
}

/** 通用卡片容器 — 替代散落的 padding/borderRadius/background inline style */
export function Card({ variant = 'normal', padding = '10px 12px', marginBottom = 8, children, style, onClick }: CardProps) {
  const v = CARD_VARIANTS[variant];
  return (
    <div
      onClick={onClick}
      style={{
        padding,
        marginBottom,
        borderRadius: 8,
        background: v.background,
        border: `1px solid ${v.borderColor}`,
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ============ Badge ============

export type BadgeTone = 'brand' | 'muted' | 'warn' | 'success' | 'danger';

const BADGE_TONES: Record<BadgeTone, { background: string; color: string; borderColor: string }> = {
  brand: {
    background: 'rgba(245,158,11,0.18)',
    color: 'var(--text-muted)',
    borderColor: 'rgba(245,158,11,0.30)',
  },
  muted: {
    background: 'var(--bg-soft)',
    color: 'var(--text-muted)',
    borderColor: 'var(--line-soft)',
  },
  warn: {
    background: 'rgba(245,158,11,0.18)',
    color: 'var(--text-strong)',
    borderColor: 'rgba(245,158,11,0.30)',
  },
  success: {
    background: 'rgba(16,185,129,0.12)',
    color: 'var(--success, #10b981)',
    borderColor: 'rgba(16,185,129,0.30)',
  },
  danger: {
    background: 'rgba(239,68,68,0.12)',
    color: 'var(--danger, #ef4444)',
    borderColor: 'rgba(239,68,68,0.30)',
  },
};

/** 小徽章 — 例: 弱匹配标签 "近似" / 强度 "高" */
export function Badge({ tone = 'muted', children, marginLeft = 6 }: {
  tone?: BadgeTone;
  children: ReactNode;
  marginLeft?: number;
}) {
  const t = BADGE_TONES[tone];
  return (
    <span style={{
      display: 'inline-block',
      fontSize: 10, padding: '1px 6px', borderRadius: 4,
      background: t.background, color: t.color, border: `1px solid ${t.borderColor}`,
      marginLeft, fontWeight: 500,
    }}>
      {children}
    </span>
  );
}

// ============ ChordChain ============

/** 和弦链 — D → A → Bm → G, 每个 chord 可点击 */
export function ChordChain({ chords, onClick, fontSize = 15 }: {
  chords: string[];
  onClick?: (chord: string) => void;
  fontSize?: number;
}) {
  return (
    <div style={{ fontSize, fontWeight: 700, color: 'var(--text-strong)', letterSpacing: 1 }}>
      {chords.map((ch, idx) => (
        <span key={idx}>
          {onClick ? (
            <button
              onClick={() => onClick(ch)}
              style={{
                background: 'transparent', border: 'none', padding: 0,
                font: 'inherit', color: 'inherit', cursor: 'pointer',
                textDecoration: 'underline', textDecorationStyle: 'dotted',
                textDecorationColor: 'var(--text-muted)',
              }}
            >{ch}</button>
          ) : (
            <span>{ch}</span>
          )}
          {idx < chords.length - 1 && <span style={{ color: 'var(--text-muted)' }}> → </span>}
        </span>
      ))}
    </div>
  );
}

// ============ Stat ============

/** Stat 块 — 大数字 + 上方 label + 下方 sub */
export function Stat({ label, value, sub, color }: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div style={{ textAlign: 'center', minWidth: 70 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? 'var(--text-strong)', lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ============ SectionTitle ============

/** 区块小标题 — 14px 加粗 + 下方 6px 间距 */
export function SectionTitle({ children, marginBottom = 6 }: { children: ReactNode; marginBottom?: number }) {
  return (
    <div style={{
      fontSize: 13, fontWeight: 600, color: 'var(--text-strong)', marginBottom,
    }}>
      {children}
    </div>
  );
}
