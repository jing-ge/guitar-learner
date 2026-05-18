#!/usr/bin/env node
// 把 dist/index.html 引用的 ./assets/*.js 和 ./assets/*.css 全部 inline 进 HTML
// 解决 Android WebView (file://) 无法加载 type="module" 的问题
// 副产物：清理 dist/assets 里被 inline 后不再需要的 JS/CSS（保留 icon 等）

import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, '..', 'dist');
const htmlPath = join(distDir, 'index.html');

if (!existsSync(htmlPath)) {
  console.error('[inline-dist] dist/index.html not found — run `npm run build` first');
  process.exit(1);
}

let html = readFileSync(htmlPath, 'utf8');

// 收集 inline 后可以删除的资产文件名（仅在 dist/assets/ 下）
const inlinedFiles = new Set();

// 收集 JS 内容（按出现顺序），后面统一插到 </body> 之前
const collectedJs = [];

/**
 * 把 JS 代码转义成可以安全嵌入 <script>...</script> 的形式：
 *   - </script>  --> <\/script>   (否则 HTML parser 会提前结束 script 标签)
 *   - <script    --> <\script     (嵌套 script 防御：React DOM 内部包含 "<script><\/script>"
 *                                  字面量, WebView 会把 <script> 识别为开标签 → 整段 JS 被截断)
 *   - <!--       --> <\!--        (老浏览器把 <!-- 当注释开始；也会破坏后续解析)
 * 这是 W3C/HTML5 规范里 inline JS 的标准做法。
 *
 * Round 50.1 修复: 之前注释提了 <script 嵌套防御但实现里漏了, 导致 Android WebView 黑屏
 *                 (React DOM 18 含 "<script><\/script>" 字面量, Chrome 桌面宽容但 WebView 严格)
 */
function escapeForInlineScript(code) {
  return code
    .replace(/<\/(script\b)/gi, '<\\/$1')
    .replace(/<(script\b)/gi, '<\\$1')
    .replace(/<!--/g, '<\\!--');
}

// 匹配 <script type="module" crossorigin src="./assets/xxx.js"></script>
// 把原标签从 <head> 里删掉，内容留到 body 末尾再 inline，
// 避免 inline 后脚本在 <head> 立即执行时 #root 还不存在。
html = html.replace(
  /<script\b[^>]*\bsrc=["']\.\/assets\/([^"']+\.js)["'][^>]*>\s*<\/script>/g,
  (_, fname) => {
    const fpath = join(distDir, 'assets', fname);
    if (!existsSync(fpath)) {
      console.warn('[inline-dist] missing asset:', fname);
      return _;
    }
    const code = readFileSync(fpath, 'utf8');
    inlinedFiles.add(fname);
    collectedJs.push({ fname, code });
    console.log('[inline-dist] collect JS:', fname, `(${(code.length / 1024).toFixed(1)} kB)`);
    return '';
  }
);

// 匹配 <link rel="stylesheet" crossorigin href="./assets/xxx.css">
// CSS 可以原地 inline 到 <head>（在 <body> 之前应用，不影响 DOM 就绪）
html = html.replace(
  /<link\b[^>]*\bhref=["']\.\/assets\/([^"']+\.css)["'][^>]*>/g,
  (_, fname) => {
    const fpath = join(distDir, 'assets', fname);
    if (!existsSync(fpath)) {
      console.warn('[inline-dist] missing asset:', fname);
      return _;
    }
    const css = readFileSync(fpath, 'utf8');
    inlinedFiles.add(fname);
    console.log('[inline-dist] inline CSS:', fname, `(${(css.length / 1024).toFixed(1)} kB)`);
    return `<style>${css}</style>`;
  }
);

// 把收集到的 JS 在 </body> 前 inline，此时 DOM 已完整，#root 一定存在
// 注意：JS 字面量里可能含 "</body>" 字符串（例如 React/Router 内部），
// 必须用 lastIndexOf 替换最后一个（真正的 HTML 闭合标签），不能用 .replace 替换第一个。
//
// Round 50.2 修复 APK 黑屏:
//   inlineDynamicImports 模式下 Vite 编译 import() 生成 import.meta.url 引用,
//   classic <script> 不允许 import.meta, 整个 bundle 语法错误 → React app 不启动 → 黑屏
//
//   实际上 PWA 模式 (默认 code-split) 主 bundle 也含 import.meta.url
//   (Vite 编译 import('./essentia-wasm.es.js') 时也会用 import.meta.url 来解析路径)
//   只是浏览器宽容 + chunk 是 module 加载, 没爆出来。
//
//   解法: 一律用 <script type="module">
//     · 现代 Android WebView (Chrome 80+) inline module script 合法
//     · Vite 5 prod 目标默认 Chrome 87+, EAS Android minSdk 23 ⇒ WebView ≥ 80
//     · 注释 7fe20ab "noModule 替代 module" 的历史决定基于 file:// 加载外部 .js,
//       inline 模式下 module/classic 行为一致 (代码已经在 HTML 里, 不走 file:// 网络请求)
const scriptOpen = '<script type="module">';

if (collectedJs.length > 0) {
  const scripts = collectedJs.map(({ code }) => `${scriptOpen}${escapeForInlineScript(code)}</script>`).join('\n');
  const closeIdx = html.lastIndexOf('</body>');
  if (closeIdx >= 0) {
    html = html.slice(0, closeIdx) + scripts + '\n  ' + html.slice(closeIdx);
  } else {
    // 兜底：如果模板没有 </body>，追加到末尾
    html += scripts;
  }
}

writeFileSync(htmlPath, html);
console.log('[inline-dist] wrote', htmlPath, `(${(html.length / 1024).toFixed(1)} kB total)`);

// Round 50.1 回归保护: 检查 <script>/</script> 配对, 防止 inline JS 里漏转义的字面量
//                    把 HTML parser 截断 (Android WebView 黑屏的元凶)
const scriptOpenCount = (html.match(/<script(?:\s[^>]*)?>/g) ?? []).length;
const scriptCloseCount = (html.match(/<\/script>/g) ?? []).length;
if (scriptOpenCount !== scriptCloseCount) {
  console.error(
    `[inline-dist] ❌ <script> 标签配对失败: open=${scriptOpenCount}, close=${scriptCloseCount}`
  );
  console.error('       这通常意味着 inline JS 里有未转义的 <script> 或 </script> 字面量');
  console.error('       检查 escapeForInlineScript() 是否覆盖了 React/库代码里的字符串字面量');
  process.exit(1);
}
console.log(`[inline-dist] script tag pairing OK (${scriptOpenCount} pairs)`);

// Round 50.2 回归保护: 如果 inline JS 含 import.meta, 必须是 module script
// (classic <script> 含 import.meta 会语法错误 → 整个 bundle 不执行 → 黑屏)
const hasImportMeta = /\bimport\.meta\b/.test(html);
const hasModuleScript = /<script\s+type=["']module["']/.test(html);
if (hasImportMeta && !hasModuleScript) {
  console.error('[inline-dist] ❌ inline JS 含 import.meta 但 <script> 不是 module 类型');
  console.error('       classic script 不允许 import.meta → 整个 bundle 语法错误 → APK 黑屏');
  console.error('       修复: 设置 VITE_INLINE_DYNAMIC=1 让 inline-dist 用 <script type="module">');
  process.exit(1);
}
console.log(`[inline-dist] import.meta check: ${hasImportMeta ? 'present (module script ✓)' : 'absent ✓'}`);

// 删除 dist/assets 下被 inline 的 js/css（保留 icon 等其它资产）
const assetsDir = join(distDir, 'assets');
if (existsSync(assetsDir)) {
  for (const name of readdirSync(assetsDir)) {
    if (inlinedFiles.has(name)) {
      unlinkSync(join(assetsDir, name));
      console.log('[inline-dist] removed', name);
    }
  }
}

console.log('[inline-dist] done.');
