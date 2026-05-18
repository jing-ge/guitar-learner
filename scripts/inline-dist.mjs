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
if (collectedJs.length > 0) {
  const scripts = collectedJs.map(({ code }) => `<script>${escapeForInlineScript(code)}</script>`).join('\n');
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
