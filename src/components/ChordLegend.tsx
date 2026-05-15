export default function ChordLegend() {
  return (
    <div className="chord-legend" aria-label="和弦图图例">
      <span className="cl-item"><span className="cl-dot cl-dot-press" />按弦点</span>
      <span className="cl-item">数字=手指（1食 2中 3无 4小）</span>
      <span className="cl-item"><span className="cl-x">×</span>不弹</span>
      <span className="cl-item"><span className="cl-o">○</span>空弦</span>
      <span className="cl-item"><span className="cl-bar" />横按</span>
    </div>
  );
}
