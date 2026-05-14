/**
 * 把上层 Web 项目的 dist/ 复制到 native/assets/web/
 * EAS Build 在云端构建时也会执行这个脚本（通过 eas-build-pre-install）
 */
const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '../../dist');
const dest = path.resolve(__dirname, '../assets/web');

function copyDir(s, d) {
  if (!fs.existsSync(s)) {
    console.log('[copy-web] 源目录不存在:', s, '跳过');
    return;
  }
  fs.mkdirSync(d, { recursive: true });
  for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
    const sp = path.join(s, entry.name);
    const dp = path.join(d, entry.name);
    if (entry.isDirectory()) copyDir(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

console.log('[copy-web] 复制 dist/ → assets/web/ ...');
copyDir(src, dest);
console.log('[copy-web] 完成');