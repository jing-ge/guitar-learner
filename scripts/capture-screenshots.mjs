#!/usr/bin/env node
// 用 Playwright 给 README 截图。先 `npm run build` + `npx vite preview --port 5174`
// 再 `node scripts/capture-screenshots.mjs`。
//
// 输出: docs/screenshots/*.png  (mobile 414×896, 默认深色, 可指定浅色)
//
// SHOT 字段:
//   file        输出文件名
//   url         路由 (HashRouter, 实际是 /#<url>)
//   clicks      可选, 顺序点击的 selector 数组
//   theme       可选, 'light' (默认 'dark')
//   wait        可选, 最后一次操作后再等多少 ms (默认 700)
//   title       仅日志用
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5174';
const OUT  = path.resolve('docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

// 旧批量删, 重新生成 (统一命名)
for (const f of fs.readdirSync(OUT)) {
  if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));
}

const SHOTS = [
  // === 概览 ===
  { file: '01-home.png',                url: '/home',           title: '首页' },
  { file: '02-daily-set.png',           url: '/practice/daily', title: '每日 5 分钟套餐' },

  // === 学习中心 — 5 个 sub-tab ===
  { file: '03-learn-chords.png',        url: '/learn',
    clicks: ['button[role="tab"]:has-text("和弦")'],
    title: '学习 · 和弦库' },
  { file: '04-learn-scales.png',        url: '/learn',
    clicks: ['button[role="tab"]:has-text("音阶")'],
    title: '学习 · 音阶' },
  { file: '05-learn-penta.png',         url: '/learn',
    clicks: ['button[role="tab"]:has-text("五声")'],
    title: '学习 · 五声音阶' },
  { file: '06-learn-fretboard.png',     url: '/learn',
    clicks: ['button[role="tab"]:has-text("指板")'],
    title: '学习 · 指板·自由探索' },
  { file: '07-learn-fretboard-find.png', url: '/learn',
    clicks: ['button[role="tab"]:has-text("指板")', 'button:has-text("找音练习")'],
    title: '学习 · 指板·找音练习' },
  { file: '08-learn-circle.png',        url: '/learn',
    clicks: ['button[role="tab"]:has-text("五度圈")'],
    title: '学习 · 五度圈' },
  { file: '09-learn-circle-quiz.png',   url: '/learn',
    clicks: ['button[role="tab"]:has-text("五度圈")', 'button:has-text("问答练习")'],
    title: '学习 · 五度圈·问答练习' },

  // === 练习中心 — 3 个入口 + 综合训练菜单 ===
  { file: '10-practice-menu.png',       url: '/practice',
    title: '练习中心' },
  { file: '11-practice-tuner.png',      url: '/practice',
    clicks: ['button.practice-entry-card:has-text("调音器")'],
    title: '练习 · 调音器' },
  { file: '12-practice-listen.png',     url: '/practice',
    clicks: ['button.practice-entry-card:has-text("听歌识别")'],
    title: '练习 · 听歌识别 (录音入口)' },
  { file: '13-practice-trainings.png',  url: '/practice',
    clicks: ['button.practice-entry-card:has-text("综合训练")'],
    title: '练习 · 综合训练菜单' },

  // === 伴奏中心 ===
  { file: '14-play-menu.png',           url: '/play',
    title: '伴奏中心' },
  { file: '15-play-drum.png',           url: '/play',
    clicks: ['button:has-text("鼓机节奏")'],
    title: '伴奏 · 鼓机节奏库' },

  // === 主题切换 ===
  { file: '16-home-light.png',          url: '/home',
    theme: 'light',
    title: '首页 (浅色主题)' },
];

async function captureOne(page, s) {
  console.log(`[capture] ${s.file.padEnd(34)} ${s.title}`);
  // 主题: 用 addInitScript 在每次 navigation 前注入 localStorage
  // 否则 HashRouter 下 goto 不会真正重载页面, React state 不会用上新主题
  const theme = s.theme || 'dark';
  await page.context().addInitScript((t) => {
    try { localStorage.setItem('guitar-learner-theme', t); } catch {}
  }, theme);
  await page.goto(BASE + '/#' + s.url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  for (const sel of (s.clicks || [])) {
    try {
      await page.locator(sel).first().click({ timeout: 4000 });
      await page.waitForTimeout(450);
    } catch (e) {
      console.warn(`    ⚠ click failed: ${sel}\n      ${e.message.split('\n')[0]}`);
    }
  }
  await page.waitForTimeout(s.wait ?? 700);
  await page.screenshot({ path: path.join(OUT, s.file), fullPage: false });
}

async function run() {
  const browser = await chromium.launch();
  // 每张截图开一个新 context, 否则 addInitScript 会累积
  for (const s of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: 414, height: 896 },
      deviceScaleFactor: 2,
      locale: 'zh-CN',
    });
    const page = await context.newPage();
    await captureOne(page, s);
    await context.close();
  }
  await browser.close();
  console.log(`\n✓ ${SHOTS.length} screenshots → ${OUT}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
