import type { ReactNode } from 'react';

type Props = {
  eyebrow?: string;
  title: string;
  desc?: string;
  rightSlot?: ReactNode;
  children?: ReactNode;
};

export default function SubpageHero({ eyebrow, title, desc, rightSlot, children }: Props) {
  return (
    <div className="subpage-hero">
      {rightSlot && <div className="sh-right">{rightSlot}</div>}
      {eyebrow && <div className="sh-eyebrow">{eyebrow}</div>}
      <div className="sh-title">{title}</div>
      {desc && <div className="sh-desc">{desc}</div>}
      {children}
    </div>
  );
}
