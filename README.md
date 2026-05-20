# 🎸 Guitar Learner (吉他学习)

一款 **纯本地运行、无需联网** 的现代吉他学习与辅助应用 —— 离线版瑞士军刀,集 **乐理学习 + 麦克风实时识别 + 音色合成 + 节奏伴奏** 于一身。

- 📦 一份 React + Vite 代码库
- 🌐 Web/PWA 直接打开
- 📱 Expo + WebView 封装为 Android App,完全离线

> 📜 历次迭代过程(60+ 轮)与版本变更见 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

---

## ✨ 它能做什么

<table>
<tr>
<td width="50%" valign="top">

- **🔌 完全离线** — 零后端、零账号、零网络请求
- **🎚️ 自研音频引擎** — 物理建模合成吉他/贝斯/鼓机,零采样包
- **🎧 实时和弦识别** — FFT + 156 模板 + 状态机防抖
- **🧠 离线扒带** — Essentia.js 一键出 BPM + 调性 + 时间线
- **🥁 毫秒级精准节奏** — Lookahead Scheduler 不漂移
- **🌗 深浅双主题** — APK 内 status bar / nav bar 跟随切换

</td>
<td width="50%" valign="top">

<img src="docs/screenshots/01-home.png" alt="首页深色" width="220"/>

</td>
</tr>
</table>

---

## 🧭 应用结构

底部 **4 大 Tab**,每个 Tab 进入后又有自己的子模块,**全部内容均可离线使用**。

| 🏠 首页 | 📚 学习 | 🎯 练习 | 🎼 伴奏 |
|:---:|:---:|:---:|:---:|
| 仪表盘 + 推荐 | 5 个理论模块 | 3 个工具 + 10 子训练 | 5 模式合奏库 |

下面按 4 个 Hub 分别展开,每节配真实截图。

---

## 🏠 首页 — 个人仪表盘

<table>
<tr>
<td width="50%" align="center"><img src="docs/screenshots/01-home.png" alt="首页 · 深色" width="280"/><br><sub>深色主题(默认)</sub></td>
<td width="50%" align="center"><img src="docs/screenshots/16-home-light.png" alt="首页 · 浅色" width="280"/><br><sub>浅色主题</sub></td>
</tr>
</table>

- 练习热力图 + 连续打卡天数 + 今日累计 + 错题 top
- 每日推荐任务 + 4 大模块入口卡片
- 支持 **PWA 一键安装**(检测 `beforeinstallprompt`,iOS 给手动引导)
- 右上角 🌙/☀️ 切主题,APK 端同步驱动 status bar / nav bar 配色

### 🌅 每日 5 分钟套餐 (`/practice/daily`)

<img src="docs/screenshots/02-daily-set.png" alt="每日套餐" width="280"/>

3 步串行,从热身到上手:**调音 → 听音辨认 5 题 → 跟弹 C-Am-F-G × 2**。中途可跳任何一步,完成自动记录。

---

## 📚 学习中心 — 理论与基础

5 个子 tab 切换,聚合所有"理论与基础"类内容。

### 🎵 和弦库

<img src="docs/screenshots/03-learn-chords.png" alt="和弦库" width="280"/>

- **48 个和弦**,4 类(开放 / 横按 / 七和弦 / 挂留),含指法图、手指标注、横按
- 每个和弦标注 **难度 1-5 星** + 文字说明
- 3 模式:**浏览 / 切换练习 / 麦克风弹琴识别**

### 🎼 音阶

<img src="docs/screenshots/04-learn-scales.png" alt="音阶学习" width="280"/>

- **10 种音阶**:自然大调、自然小调、和声/旋律小调、五声、蓝调、Dorian、Mixolydian...
- 4 模式:**学习(指板高亮)/ 听音测试 / 弹琴识别 / 跟弹通关**
- 上下行示范可一键播放,显示组成音与音名/度数

### 🎯 五声音阶

<img src="docs/screenshots/05-learn-penta.png" alt="五声音阶" width="280"/>

- 大调/小调/蓝调 **3 类五声** × **5 个把位(Position 1-5)**
- 推根音切 key,自动列出常配和弦

### 🎸 指板

<table>
<tr>
<td width="50%" align="center"><img src="docs/screenshots/06-learn-fretboard.png" alt="指板 · 自由探索" width="280"/><br><sub>自由探索 · 点位发声</sub></td>
<td width="50%" align="center"><img src="docs/screenshots/07-learn-fretboard-find.png" alt="指板 · 找音练习" width="280"/><br><sub>找音练习 · 出题闯关</sub></td>
</tr>
</table>

- 12 品全指板,横/竖屏自适应
- 显示标签可切换:**音名 / 唱名 / 度数**
- 自由模式点位发声;找音模式出题计分

### ⭕ 五度圈

<table>
<tr>
<td width="50%" align="center"><img src="docs/screenshots/08-learn-circle.png" alt="五度圈 · 学习" width="280"/><br><sub>学习模式</sub></td>
<td width="50%" align="center"><img src="docs/screenshots/09-learn-circle-quiz.png" alt="五度圈 · 问答" width="280"/><br><sub>问答练习</sub></td>
</tr>
</table>

- 交互式 SVG,**12 调**色块可点击,自动显示调号、关系大小调、顺阶和弦
- 问答模式:**上方五度 / 关系小调 / 调号辨认** 三类问题随机抽

---

## 🎯 练习中心 — 主动技能训练

3 个入口卡片,综合训练再展开 10 个子项。

<img src="docs/screenshots/10-practice-menu.png" alt="练习中心菜单" width="280"/>

### 🎛️ 调音器

<img src="docs/screenshots/11-practice-tuner.png" alt="调音器" width="280"/>

- 麦克风 + **YIN 自相关算法** 实时音高检测
- 6 弦自动识别 / 手动锁定
- ±50 cents 偏差仪表盘,带视觉刻度
- 底部 6 弦标准音参考,点击可试听

### 🎧 听歌识别(Essentia.js)

<img src="docs/screenshots/12-practice-listen.png" alt="听歌识别" width="280"/>

- 录音 **10 / 20 / 30 秒** → Essentia 一次性离线分析
- **和弦/调性模式**:输出 BPM + 调性 + **节拍对齐和弦时间线** + 罗马数字
- **主旋律模式**(≤15s):PitchMelodia → 自动映射 **最低把位指板** 推荐
- 录音用 **IndexedDB 持久化**(20 条上限 ~100MB),可重听 / 重新分析
- 识别出的走向可一键保存到首页

### 🎯 综合训练菜单(10 个子项)

<img src="docs/screenshots/13-practice-trainings.png" alt="综合训练菜单" width="280"/>

| 类别 | 子训练 | 说明 |
|---|---|---|
| 听力 | 听音辨认 | 单音 + 大小三和弦,5 题 |
| 听力 | **音准训练** | 麦克风检测 \|cents\|≤15 持 500ms 命中 |
| 听力 | 和弦听力 | 4 / 6 / 8 选 1 |
| 听力 | 和弦走向 | V→I / IV→I 功能辨认 |
| 乐理 | 五度圈速答 | 调号 / 关系大小调 / 顺阶 |
| 乐理 | CAGED 系统 | 5 形位置连接 |
| 节奏 | 节拍器 | Lookahead 调度 |
| 节奏 | 节奏型库 | 跟弹示范 |
| 演奏 | 歌曲跟弹 | 走向切换练习 |
| 数据 | 练习记录 | 今日/累计统计 |

---

## 🎼 伴奏中心 — 节奏与合奏库

5 大模式,所有 pattern 均可一键克隆为自定义并保存。

<img src="docs/screenshots/14-play-menu.png" alt="伴奏中心" width="280"/>

### 🥁 鼓机节奏库

<img src="docs/screenshots/15-play-drum.png" alt="鼓机节奏库" width="280"/>

**16 种内置**(基础摇滚 / 强力摇滚 / 流行 / 民谣 / 抒情 / 布鲁斯 Shuffle / Funk / Disco / Hip-Hop / Bossa Nova / Reggae / Samba / 华尔兹 / 爵士 Swing 等),可建自定义(16 步 / 12 步)。

### 🎼 和弦走向库

**12 种内置**:`1-6-4-5` / `1-5-6-4` / `卡农` / `12 小节布鲁斯` / `爵士 2-5-1` / `Doo-Wop` / `民谣小调 Em` / `摇滚 1-5-6-7` 等。

### 🎸 吉他节奏库

**13 种扫弦/分解**:整音 / 半拍 / DDDD / 万能 D-D-U-U-D-U / Travis Picking / Reggae 反拍 / Funk 切分 / 华尔兹 等。

### 🎚️ 贝斯节奏库

**11 种贝斯**:只根音 / 根+五度 / 走动贝斯 R-5-R-p5 / 根+高八度 / Funk 切分 / Reggae 反拍 等。

### 🎵 歌曲合奏

按 **Intro / Verse / Chorus / Bridge / Outro 分段编排**,鼓 + 和弦扫弦 + 贝斯三轨同步,可加 Fill-in 过门。

---

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite 5 + TypeScript 5 |
| 路由 | React Router DOM v6 (HashRouter, 兼容 `file://`) |
| 实时音频 | Web Audio API + `AnalyserNode` (FFT) + 自研 YIN / 模板匹配 |
| 离线分析 | [Essentia.js](https://essentia.upf.edu/essentiajs.html) (WASM, 懒加载 ~2.5MB) |
| 录音持久化 | IndexedDB(Float32Array → Blob,20 条上限) |
| 跨平台壳 | Expo 52 + Expo Router + React Native WebView |
| Android 适配 | `expo-navigation-bar` / `expo-system-ui` / `expo-status-bar` / `react-native-safe-area-context` |

---

## 🚀 快速开始

### Web 端开发

```bash
npm install
npm run dev               # 本地开发服务器
npm run build             # 构建 Web 产物 → dist/
npm run build:apk         # APK 用产物(动态 chunk 内联,WebView 离线加载兼容)
```

### Android App 打包

`native/` 是一套 Expo 壳,通过 [Config Plugin](native/plugins/copy-web-assets.js) 把 Web 产物拷进 `android/app/src/main/assets/web/`,WebView 通过 `file:///android_asset/web/index.html` 离线加载。

```bash
npm run build:apk                              # 1. 根目录构 Web
node native/scripts/copy-web.js                # 2. 同步到 native
cd native && npm install                       # 3. 进 native 装依赖
npx expo run:android                           # 4. 本地调试
npx eas build -p android --profile preview     # 4'. 云端打 APK
```

云端 EAS 构建自动跑 `eas-build-pre-install` 钩子(`build:apk` + `copy-web.js`),无需手动同步。

### 算法回归评测

```bash
npm run eval          # 离线合成 chroma → 模板匹配, 108 chord × 4 场景, top-1/top-3
npm run eval:check    # 对比 baseline (CI gate)
npm run eval:update   # 更新基线(谨慎)
npm run eval:song     # 真实歌曲 fixture: vi-IV-I-V × 4 端到端
npm run eval:canon    # D 大调卡农真实 wav 完整管线
```

### 重新生成截图

```bash
npm run build && npx vite preview --port 5174 &
node scripts/capture-screenshots.mjs    # → docs/screenshots/
```

---

## 📁 目录结构

```text
guitar-learner/
├── src/
│   ├── audio/          # 音频引擎(17 个模块)
│   │   ├── synth.ts             # 吉他物理建模合成
│   │   ├── bass-synth.ts        # 贝斯合成(80Hz 加厚)
│   │   ├── drum-machine.ts      # 10 种鼓声纯合成
│   │   ├── pitch-detector.ts    # YIN 自相关音高检测
│   │   ├── chord-detector.ts    # FFT + Chroma + 156 模板 + 状态机
│   │   ├── essentia-engine.ts   # Essentia.js 离线扒带封装
│   │   ├── melodyToFretboard.ts # MIDI → 最低把位推荐
│   │   ├── recordingStore.ts    # IndexedDB 录音持久化
│   │   └── *-patterns.ts        # 鼓 / 和弦走向 / 扫弦 / 贝斯 pattern 库
│   ├── components/     # React 复用组件(指板、和弦图、训练器)
│   ├── pages/          # 16 个路由页面(按 4 大 Hub 组织)
│   ├── theory/         # 乐理数据(48 和弦、10 音阶、音名转换)
│   ├── data/           # 经典走向数据
│   ├── styles/         # 全局 CSS 与 design token
│   └── utils/          # 振动、进度、主题、自定义库存储
├── native/             # Expo + React Native WebView 壳
│   ├── app/            # 沉浸式全屏容器入口
│   ├── plugins/        # Android Asset 同步 config plugin
│   └── scripts/        # dist → native/assets/web 同步脚本
├── scripts/            # 5 个评测脚本 + baseline + 截图脚本
├── docs/
│   ├── CHANGELOG.md    # 60+ 轮迭代日志
│   └── screenshots/    # README 截图(自动生成)
└── public/             # PWA manifest / sw.js / icon
```

---

## 💡 核心实现亮点

### 🎚️ 音频引擎(零采样,纯合成)
- **吉他物理建模** —— [`synth.ts`](src/audio/synth.ts) 加法合成:基频 + 多次谐波,各谐波独立衰减率(高频快),经 220Hz peaking 滤波模拟琴体共鸣 + 1200Hz 中频在场感 + 4500Hz 高频低通去刺,DynamicsCompressor 限制器防爆音
- **10 种鼓声零采样** —— [`drum-machine.ts`](src/audio/drum-machine.ts) kick/snare/hihat/clap/ride/crash/3 tom 全用振荡器 + 预生成白噪声 + 滤波器
- **Lookahead 节拍调度** —— 摒弃 `setInterval`,用 Web Audio 时间戳 + 滚动调度,锁屏/掉帧不漂移

### 🎧 识别算法(每一步都有迭代)
- **和弦检测**([`chord-detector.ts`](src/audio/chord-detector.ts), 796 行) —— FFT 峰值 → 12 维 Chroma + 低频 bassChroma + HPS 抑制谐波 + **156 个模板** 余弦匹配 + 状态机(`idle→candidate→confirmed→committed`)+ hysteresis + 速率限制(≤2 chord/s) + 同根三度族投票(`F#m/F#m7/F#sus2` 视为一族)
- **3 档敏感度** —— `strict` ~3s / `normal` ~1.7s / `loose` ~0.9s commit 阈值
- **自适应处理** —— 全局调音偏移自适应(±50 cents)、自适应噪声地板(p10 估计)、onset 门控(防长按拖尾)、key-aware diatonic 模板先验、top-K 候选 chip
- **音高检测** —— [`pitch-detector.ts`](src/audio/pitch-detector.ts) **YIN 自相关算法**,适合吉他单音
- **离线扒带** —— [`essentia-engine.ts`](src/audio/essentia-engine.ts) 封装 Essentia.js 的 `RhythmExtractor2013` + `ChordsDetectionBeats` + `KeyExtractor` + `PitchMelodia`,beat-aligned 不盲猜

### 🧪 工程纪律
- **算法可回归评测** —— `scripts/` 内 5 个评测脚本,从合成 chroma 到真实 wav 4 个层级,[`eval-baseline.json`](scripts/eval-baseline.json) 锁死 156 模板 × 20 走向 × 4 场景 ABCD,改算法必须过 baseline gate
- **录音持久化** —— [`recordingStore.ts`](src/audio/recordingStore.ts) IndexedDB Float32Array→Blob 存 PCM + analysis JSON,跨 session 重听免重算
- **Essentia WASM 懒加载** —— ~2.5MB 单例,显式 `.delete()` C++ vector 防 mobile Safari 二次崩

### 📱 Native 沉浸式封装
- **主题双向同步** —— Web 端 `setStoredTheme()` 通过 `ReactNativeWebView.postMessage` 推给壳,壳同步驱动 `SystemUI` / `NavigationBar` / `StatusBar`,无白边
- **Android 系统 UI** —— `expo-navigation-bar` 接管底栏,`paddingTop = insets.top` 避开刘海,硬件返回键 → WebView `goBack()`
- **EAS 一键** —— `eas-build-pre-install` 钩子在云端自动跑根目录 `build:apk` + `copy-web.js`

---

## 📄 License

MIT
