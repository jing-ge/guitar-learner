#!/usr/bin/env node
// 用 Playwright 给 README 截图。先 `npm run build` + `npx vite preview --port 5174`
// 再 `node scripts/capture-screenshots.mjs`。
//
// 输出: docs/screenshots/*.png (mobile viewport, dark theme)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5174';
const OUT = path.resolve('docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

// 每张截图: 路由 + 可选 selector 用于点击进入 sub-tab + 文件名 + 标题
const SHOTS = [
  { file: '01-home.png',       url: '/home',           title: '首页' },
  { file: '02-learn-chords.png', url: '/learn',        title: '学习 · 和弦库',
    click: 'button:has-text("和弦")' },
  { file: '03-learn-circle.png', url: '/learn',        title: '学习 · 五度圈',
    click: 'button:has-text("五度圈")' },
  { file: '04-learn-fretboard.png', url: '/learn',     title: '学习 · 指板',
    click: 'button:has-text("指板")' },
  { file: '05-learn-penta.png', url: '/learn',         title: '学习 · 五声音阶',
    click: 'button:has-text("五声")' },
  { file: '06-practice-menu.png', url: '/practice',    title: '练习中心' },
  { file: '07-practice-daily.png', url: '/practice/daily', title: '每日 5 分钟' },
  { file: '08-play-menu.png',   url: '/play',          title: '伴奏中心' },
];

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 414, height: 896 },        // iPhone 11-ish
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    locale: 'zh-CN',
  });
  const page = await context.newPage();

  for (const s of SHOTS) {
    // 项目用 HashRouter, 路由全部走 /#/path
    const fullUrl = BASE + '/#' + s.url;
    console.log(`[capture] ${s.file}  ←  /#${s.url}`);
    await page.goto(fullUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400); // 等 hash 路由切换
    if (s.click) {
      try {
        await page.locator(s.click).first().click({ timeout: 3000 });
        await page.waitForTimeout(500);
      } catch (e) {
        console.warn(`  ⚠ click failed (${s.click}): ${e.message}`);
      }
    }
    // 关掉可能弹出的 PWA install 横幅 / 任何模态
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(OUT, s.file),
      fullPage: false,
    });
  }

  await browser.close();
  console.log(`\n✓ ${SHOTS.length} screenshots → ${OUT}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
