# 🎸 Guitar Learner (吉他学习)

一款 **纯本地运行、无需联网** 的现代吉他学习与辅助应用。

集 **乐理学习**(和弦 / 音阶 / 五度圈 / CAGED / 指板)、**麦克风实时识别**(调音、和弦走向、调性、主旋律扒带)、**离线音色合成**(吉他 / 贝斯 / 鼓机)与 **毫秒级精准节拍器/伴奏** 于一体。

- 📦 一份 React + Vite 代码库
- 🌐 Web/PWA 可装,也可
- 📱 经 Expo + WebView 封装为 Android App,离线加载,不依赖任何服务端

> 历次迭代过程(60+ 轮)与版本变更见 [docs/CHANGELOG.md](docs/CHANGELOG.md)。

---

## ✨ 核心亮点

- **🔌 完全离线** —— 零后端、零账号、零网络请求。一次加载,处处可用。
- **🎚️ 自研音频引擎** —— Web Audio API 物理建模合成吉他/贝斯/鼓机,零采样包(数十 MB → 0)。
- **🎧 实时和弦识别** —— 麦克风 → FFT → Chroma → **156 个模板** 匹配 + 状态机防抖,经 30+ 轮算法迭代,有评测脚本与 baseline gate。
- **🧠 Essentia.js 离线扒带** —— 录音 10/20/30s 一键分析,输出 BPM + 调性 + 节拍对齐和弦时间线 + 主旋律 MIDI。
- **🥁 毫秒级精准节奏** —— Web Audio **Lookahead Scheduler**,锁屏/掉帧不漂移。
- **📱 沉浸式 App 封装** —— Expo + WebView,主题切换通过 `postMessage` 同步驱动 Android status bar / nav bar / 容器底色,无白边、无遮挡。

---

## 🧭 功能总览

应用底部分 **4 大主区**,共 16 个 page,**全部内容均可离线使用**。

### 🏠 首页 (Home)
- 练习热力图、连续打卡天数、今日累计、错题 top
- 模块卡片入口 + "今日 5 分钟练什么"推荐
- 支持 PWA 安装(检测 `beforeinstallprompt` / iOS 引导)

### 📚 学习中心 (Learn) — 理论与基础
5 个 tab 内 sub-route 切换:

| Tab | 内容细节 |
|---|---|
| 🎵 **和弦** | 48 个和弦库(开放/横按/七和弦/挂留),含指法图、手指标注、横按、难度 1-5 星,3 模式:**浏览 / 切换练习 / 麦克风识别** |
| 🎼 **音阶** | 10 种音阶(自然大调、自然小调、和声/旋律小调、五声、蓝调、Dorian、Mixolydian 等),4 模式:**学习 / 听音测试 / 弹琴识别 / 跟弹通关** |
| 🎯 **五声** | 大调/小调/蓝调五声 + **5 个把位指型**(Position 1-5),配对应和弦提示 |
| 🎸 **指板** | 12 品动态指板,横/竖屏自适应,2 模式:**自由探索(点位发声) / 找音练习** |
| ⭕ **五度圈** | 交互式 SVG 五度圈 —— 调号、关系大小调、顺阶和弦一图通览,带 **3 类问答**(上方五度 / 关系小调 / 调号辨认) |

### 🎯 练习中心 (Practice) — 主动技能训练
- **🎛️ 调音器** —— 麦克风 + **YIN 自相关算法** 实时音高检测,6 弦自动识别 / 手动锁定,cents 偏差仪表
- **🎧 听歌识别**(离线) —— 录音 10/20/30s → 用 Essentia.js 一次性分析:
  - BPM + 调性 + **节拍对齐和弦时间线** + 罗马数字
  - 自动识别经典走向(I-V-vi-IV 等),走向可一键保存
  - **主旋律扒带模式**(≤15s) —— PitchMelodia + 自动映射到 **最低把位指板** 推荐
  - 录音用 **IndexedDB 持久化**(20 条上限 ~100MB),可重听/重新分析
- **🎯 综合训练** —— 10 个子训练菜单:
  - 听音辨认 / 音准训练(`cents≤15` 持 500ms 命中)/ 和弦听力(4-6-8 选 1)
  - 和弦走向听力(V→I / IV→I 功能辨认)
  - 五度圈速答 / CAGED 系统 / 节拍器 / 节奏型库 / 歌曲跟弹 / 练习记录
- **🌅 每日 5 分钟套餐** —— 3 步串行:热身调音 → 听音 5 题 → 跟弹一段 C-Am-F-G × 2

### 🎼 伴奏中心 (Play) — 合奏与节奏型库
- **🎵 歌曲合奏** —— 鼓 + 和弦扫弦 + 贝斯三轨同步,可按 Intro/Verse/Chorus/Bridge/Outro **分段编排** + Fill-in
- **🥁 节奏型库** —— **16 种内置鼓机节奏**(基础摇滚/流行/民谣/布鲁斯 Shuffle/Funk/Disco/Hip-Hop/Bossa Nova/Reggae/Samba/华尔兹/爵士 Swing 等),可建自定义
- **🎼 和弦走向库** —— **12 种走向**(1-6-4-5 / 1-5-6-4 / 卡农 / 12 小节布鲁斯 / 爵士 2-5-1 / Doo-Wop / 民谣小调 / 摇滚 1-5-6-7 等),可建自定义
- **🎸 吉他节奏库** —— **13 种扫弦/分解**(整音、半拍、DDDD、万能 D-D-U-U-D-U、Travis Picking、Reggae 反拍、Funk 切分、华尔兹...)
- **🎚️ 贝斯节奏库** —— **11 种贝斯**(只根音、根+五度、走动贝斯 R-5-R-p5、根+高八度、Funk 切分、Reggae 反拍...)

> 所有内置 pattern 都可一键克隆为自定义并保存到 localStorage,自定义版本与内置并列展示。

---

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite 5 + TypeScript 5 |
| 路由 | React Router DOM v6 |
| 实时音频 | Web Audio API + `AnalyserNode` (FFT) + 自研 YIN / 模板匹配引擎 |
| 离线分析 | [Essentia.js](https://essentia.upf.edu/essentiajs.html) (WASM, 懒加载 ~2.5MB) |
| 录音持久化 | IndexedDB(单 store,20 条上限) |
| 跨平台壳 | Expo 52 + Expo Router + React Native WebView |
| Android 适配 | `expo-navigation-bar` / `expo-system-ui` / `expo-status-bar` / `react-native-safe-area-context` |

---

## 🚀 快速开始

### 1. Web 端开发

```bash
npm install       # 安装依赖
npm run dev       # 启动本地开发服务器
npm run build     # 构建 Web 产物 (输出到 dist/, 含 inline 处理)
npm run build:apk # 构建 APK 用产物 (内联动态 chunk, 适合 WebView 离线加载)
```

### 2. Android App 打包

`native/` 是一套 Expo 壳,通过 [Config Plugin](./native/plugins/copy-web-assets.js) 把 Web 构建产物拷贝进 `android/app/src/main/assets/web/`,WebView 通过 `file:///android_asset/web/index.html` 离线加载。

```bash
# 1. 根目录先构建 Web,并同步到 native 目录
npm run build:apk
node native/scripts/copy-web.js

# 2. 进入 native 安装依赖
cd native && npm install

# 3. 本地调试 (需要 Android Studio)
npx expo run:android

# 4. 云端打包 APK (需要 Expo EAS 账号, projectId 已配在 native/app.json)
npx eas build -p android --profile preview
```

云端 EAS 构建会自动跑 `eas-build-pre-install` 钩子(根目录 `npm ci` + `build:apk` + `copy-web.js`),无需手动同步。

### 3. 算法回归评测

和弦检测 / 调性推断有专门的评测脚本,改完算法跑一遍防回归:

```bash
npm run eval          # 离线合成 chroma → 模板匹配, 108 chord × 4 场景, top-1/top-3
npm run eval:check    # 对比 scripts/eval-baseline.json, 差异即报错(CI gate)
npm run eval:update   # 更新基线(谨慎)
npm run eval:song     # 真实歌曲 fixture: vi-IV-I-V × 4 端到端
npm run eval:canon    # D 大调卡农真实 wav 跑完整管线
```

`scripts/eval-baseline.json` 持久化当前基线(156 模板 × 20 走向 × 4 场景 ABCD)。

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
│   ├── components/     # React 复用组件(指板、和弦图、训练器等)
│   ├── pages/          # 16 个路由页面(按 4 大 Hub 组织)
│   ├── theory/         # 乐理数据(48 和弦、10 音阶、音名转换)
│   ├── data/           # 经典走向数据
│   ├── styles/         # 全局 CSS 与 design token
│   └── utils/          # 振动、进度、主题、自定义库存储
├── native/             # Expo + React Native WebView 壳
│   ├── app/            # 沉浸式全屏容器入口
│   ├── plugins/        # Android Asset 同步 config plugin
│   └── scripts/        # dist → native/assets/web 同步脚本
├── scripts/            # 5 个评测脚本 + baseline + 合成工具
├── docs/               # CHANGELOG 与设计文档
└── public/             # PWA manifest / sw.js / icon
```

---

## 💡 核心实现亮点

### 🎚️ 音频引擎
- **吉他物理建模音色** —— `src/audio/synth.ts` 加法合成基频 + 多次谐波,各谐波独立衰减率(高频衰减快),经 220Hz peaking 滤波器模拟琴体共鸣 + 1200Hz 中频在场感 + 4500Hz 高频低通去刺,DynamicsCompressor 限制器防爆音。
- **10 种鼓声零采样** —— `src/audio/drum-machine.ts` kick/snare/hihat/clap/ride/crash/3 种 tom 全用振荡器 + 预生成白噪声 buffer + 滤波器合成,无任何采样文件。
- **Lookahead 节拍调度** —— 摒弃 `setInterval`,改用 Web Audio 时间戳 + 滚动调度,锁屏/掉帧不漂移。

### 🎧 识别算法
- **和弦检测**(`chord-detector.ts`,796 行) —— FFT 峰值 → 12 维 Chroma + 低频 bassChroma + HPS 抑制谐波 + **156 个模板** 余弦匹配 + 状态机(`idle→candidate→confirmed→committed`)+ hysteresis + 速率限制(每秒≤2 chord)+ 同根三度族投票(`F#m/F#m7/F#sus2` 视为一族)。
- **3 档敏感度** —— `strict / normal / loose` 对应 ~3s / ~1.7s / ~0.9s commit 阈值。
- **自适应处理** —— 全局调音偏移自适应(±50 cents)、自适应噪声地板(p10 估计)、onset 门控(防长按拖尾)、key-aware diatonic 模板先验、top-K 候选 chip。
- **音高检测**(`pitch-detector.ts`) —— YIN 自相关算法,适合吉他单音域,自带累积均值归一化差分函数。
- **离线扒带**(`essentia-engine.ts`,Essentia.js 封装) —— `RhythmExtractor2013` + `ChordsDetectionBeats` + `KeyExtractor` + `PitchMelodia`,beat-aligned 不盲猜。

### 🧪 工程纪律
- **算法可回归评测** —— `scripts/` 内 5 个评测脚本,从合成 chroma 到真实 wav 4 个层级,`eval-baseline.json` 锁死当前准确率,改算法必须过 baseline gate。
- **录音持久化** —— `recordingStore.ts` IndexedDB Float32Array→Blob 存 PCM + analysis JSON,跨 session 可重听免重算。
- **离线优先** —— 麦克风/振动权限按需申请;Essentia WASM 懒加载(~2.5MB)、单例、显式 `.delete()` C++ vector 防 mobile Safari 二次崩。

### 📱 Native 沉浸式封装
- **主题双向同步** —— Web 端 `setStoredTheme()` 通过 `window.ReactNativeWebView.postMessage` 推主题给壳,壳同步驱动 `SystemUI.setBackgroundColorAsync` / `NavigationBar.setBackgroundColorAsync` / `StatusBar` 颜色,无白边、无突兀边框。
- **Android 系统 UI** —— `expo-navigation-bar` 接管底栏绘制,`paddingTop = insets.top` 避开刘海/挖孔,硬件返回键 → WebView `goBack()`。
- **构建链路** —— EAS 一行 `eas-build-pre-install` 钩子在云端自动跑根目录 `build:apk` + `copy-web.js`,本地零额外操作。

---

## 📄 License

MIT
