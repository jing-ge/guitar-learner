/** 触觉反馈：答对/答错/节拍重拍 等场景调用 */
export function vibrate(ms = 20) {
  try { navigator?.vibrate?.(ms); } catch {}
}
export function vibratePattern(pattern: number[]) {
  try { navigator?.vibrate?.(pattern); } catch {}
}