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

// 匹配 <script type="module" crossorigin src="./assets/xxx.js"></script>
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
    console.log('[inline-dist] inline JS:', fname, `(${(code.length / 1024).toFixed(1)} kB)`);
    // 用 noModule 替代 module，确保 file:// 下能执行
    // 注意：原本是 type="module"，inline 后 React 单文件构建不需要 module 语义
    return `<script>${code}</script>`;
  }
);

// 匹配 <link rel="stylesheet" crossorigin href="./assets/xxx.css">
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

writeFileSync(htmlPath, html);
console.log('[inline-dist] wrote', htmlPath, `(${(html.length / 1024).toFixed(1)} kB total)`);

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
