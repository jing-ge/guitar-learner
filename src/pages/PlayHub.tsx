// 伴奏中心：弹唱/练习的伴奏工具
// 鼓机 + 和弦伴奏（这里直接复用 DrumMachinePage 的全套）

import DrumMachinePage from './DrumMachinePage';

export default function PlayHub() {
  // DrumMachinePage 内部已经有完整子 tab：
  // 单节奏型 / 歌曲编排 / 自定义鼓 / 和弦进行 / 和弦节奏
  // 直接复用即可
  return <DrumMachinePage />;
}