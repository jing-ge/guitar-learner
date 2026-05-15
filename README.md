# 🎸 Guitar Learner (吉他学习)

一款**纯本地运行**、**无需联网**的现代吉他学习与辅助应用。不仅包含丰富的乐理知识（和弦、音阶、五度圈、CAGED），还深度结合了 Web Audio API 和麦克风 FFT 分析，实现了**精准调音器**、**实时和弦识别**、**离线吉他音色合成**以及**毫秒级精准节拍器**。

支持 Web 纯网页访问（PWA），也支持通过 Expo 封装为 Android/iOS 原生 App。

## ✨ 核心功能 (Features)

*   **🎛️ 智能调音器 (Tuner)**：利用设备麦克风和 FFT 算法实时检测音高，支持抗噪防抖。
*   **🎧 听歌识别 (Live Detection)**：实时监听外部音乐或吉他弹奏，智能推算当前演奏的和弦走向（包含防抖过滤）和歌曲调性。
*   **🎹 纯离线吉他合成器 (Guitar Synth)**：无需加载任何巨大的音频采样包，利用 Web Audio API 的振荡器、衰减包络、琴体共振滤波完美物理模拟民谣吉他拨弦、扫弦、闷音音色。
*   **🎯 乐理与指板 (Theory & Fretboard)**：
    *   **动态指板**：找音练习、音阶高亮、横/竖屏动态适配。
    *   **五度圈 (Circle of Fifths)**：可交互的 SVG 动态五度圈，直观展示调号、关系大小调、顺阶和弦及经典和弦走向。
    *   **和弦与音阶**：内置丰富的和弦库指法图及音阶构成，支持“听音辨音”与“麦克风弹琴闯关”测验。
*   **🥁 高精度节拍器与节奏型 (Metronome & Rhythm)**：底层摒弃了不稳定的 `setInterval`，重构使用 Web Audio **Lookahead Scheduler** 算法，即使在手机锁屏或 UI 掉帧时，节拍器与自动伴奏依然毫秒级精准。
*   **📱 沉浸式 App 体验**：使用 Expo / React Native WebView 封装，针对全面屏手势彻底消除了 Android 底部白边，完美适配暗色主题。

## 🛠️ 技术栈 (Tech Stack)

*   **前端框架**：React 18 + Vite + TypeScript
*   **路由与状态**：React Router DOM
*   **音频处理引擎**：Web Audio API, `AnalyserNode` (FFT Pitch/Chord Detection)
*   **跨平台/原生封装**：Expo, React Native WebView, `expo-navigation-bar`, `expo-system-ui`

## 🚀 快速开始 (Getting Started)

### 1. Web 端开发 (Web Development)
推荐在 Web 端进行 UI 和核心业务逻辑的开发：

```bash
# 安装依赖
npm install

# 启动本地开发服务器
npm run dev

# 构建 Web 生产环境产物 (输出到 dist/)
npm run build
```

### 2. Android/iOS App 打包 (Native App via Expo)
项目在 `native/` 目录下提供了一套 Expo 壳，会将 Web 的打包产物拷贝进 Native Asset 进行离线加载。

```bash
# 1. 确保在根目录先完成 Web 构建，并将产物移入 native 目录
npm run build
node native/scripts/copy-web.js

# 2. 进入 Native 目录并安装依赖
cd native
npm install

# 3. 本地运行调试 (需要安装 Android Studio/Xcode)
npx expo run:android
# 或
npx expo run:ios

# 4. 云端构建 APK (需配置 Expo EAS 账号)
npx eas build -p android --profile preview
```

## 📁 目录结构 (Project Structure)

```text
guitar-learner/
├── src/
│   ├── audio/          # 核心音频引擎（合成器、FFT 和弦/音高检测器）
│   ├── components/     # React 复用组件（动态指板、和弦图等）
│   ├── pages/          # 路由页面（主页、练习、五度圈、听歌等）
│   ├── theory/         # 乐理数据模型（音阶库、和弦库、算法）
│   ├── styles/         # 全局 CSS
│   └── utils/          # 辅助工具（振动反馈、进度存储）
├── native/             # Expo React Native 壳工程
│   ├── app/            # WebView 沉浸式全屏容器入口
│   ├── scripts/        # Web -> Native 产物同步脚本
│   └── plugins/        # Android Asset 同步配置插件
└── public/             # PWA Manifest & 图标
```

## 💡 核心实现亮点

*   **吉他物理建模音色**：`src/audio/synth.ts` 中模拟了拨片瞬态噪声，并按 $1f, 2f, 3f...6f$ 比例叠加正弦波谐波，为各次谐波赋予不同的指数衰减（高频衰减快），最后经过 180Hz `peaking` 滤波器模拟木琴箱共鸣。
*   **音频防抖识别**：`src/audio/chord-detector.ts` 的和弦瀑布流采用了帧稳定度检测器，同一和弦需在高置信度下连续存在数帧才会触发 UI 更新，有效防止了环境杂音引起的闪烁。
*   **无感沉浸式打包**：彻底利用 `expo-navigation-bar` 接管安卓系统底栏绘制，使 WebView 和系统手势栏在暗色模式下浑然一体。

## 📄 License
MIT License

## 📝 迭代记录 (Changelog)

### Round 1 — 2026-05-15
**主题**：首页"今日练什么"重构 + 练习中心减负

**改动文件**：
- `src/pages/HomePage.tsx`
- `src/pages/PracticeHub.tsx`
- `src/pages/PracticePage.tsx`
- `src/utils/progress.ts`
- `src/styles/global.css`

**产品要点**：
- 首页改为“今日练什么”首屏，包含 Hero、动态 CTA、推荐任务与 30 天热力信息。
- 首页首屏保留首次引导次 CTA，并将安装提示弱化到非首屏顶部区域。
- 练习中心首屏收敛为调音器、听歌识别、综合训练 3 个一级入口。
- 综合训练改为“训练菜单 → 训练内容”两态切换，并在内容态提供 sticky 返回头。

**开发要点**：
- 首页根据本地练习进度动态切换主 CTA 与推荐文案。
- 练习中心入口卡片与综合训练菜单卡采用移动端大卡布局。
- 综合训练内容态支持返回训练菜单，减少首屏信息负担。
- 全局样式同步适配新首页与浅/深色主题切换。

**测试结果**：
| 用例 | 路径 | 结果 | 备注 |
| --- | --- | --- | --- |
| 首页首屏（无练习记录） | `/#/home` | ✅ | Hero 居中；三联 pill 显示 0；主 CTA 为“从调音开始”；次 CTA、推荐卡存在；安装提示不在首屏顶部。 |
| 首页（有练习记录） | `/#/home` | ✅ | 已修复（progress 数据规范化 + HomeErrorBoundary 兜底）。 |
| 次 CTA 跳转 | `/#/home -> /#/practice?start=newbie` | ✅ | 点击“我是新手，带我开始”后跳转到 `http://localhost:5173/home#/practice?start=newbie`。 |
| 练习中心首屏 | `/#/practice` | ✅ | 首屏仅看到 3 个一级入口：调音器 / 听歌识别 / 综合训练。 |
| 进入综合训练 → 训练菜单 | `/#/practice` | ✅ | 进入后展示 7 个训练项大卡，不是 chip。 |
| 菜单 → 内容 | `/#/practice` | ✅ | 点击“听音辨认”后可见 sticky 返回头“← 返回训练菜单”及训练内容。 |
| 返回菜单 | `/#/practice` | ✅ | 点击“← 返回训练菜单”后返回训练菜单态。 |
| 浅色主题：首页 | `/#/home` | ✅ | 设置 `guitar-learner-theme=light` 后首页正常显示，无明显崩坏。 |
| 浅色主题：练习中心 | `/#/practice` | ✅ | 设置 `guitar-learner-theme=light` 后练习中心正常显示，无明显崩坏。 |

**Hotfix（同轮内修复）**

- 改动文件：`src/utils/progress.ts`、`src/pages/HomePage.tsx`
- 修复点：
  - `loadAll()` 加 schema 校验 + 字段规范化（非数组 / 缺字段 / 错误类型一律降级为安全空数据）
  - `getTodayStats / getPracticeSummary / getHeatmapDays / recordSession` 加 sessions 数组守卫
  - HomePage 新增 `HomeErrorBoundary`，渲染异常时显示“加载首页时出错”，提供“重置进度数据”与“返回练习中心”兜底

**回归测试（8 用例，移动端 390x844 视口）**

| 用例 | 数据形态 | 结果 | 备注 |
| --- | --- | --- | --- |
| R01 | `sessions={}`（对象而非数组） | ✅ | 被规范化为合法记录，首页正常渲染（分钟 2 / 答对 0 / 连续天数 1），控制台无 error。 |
| R02 | 仅 `date` 字段，缺 `sessions` 与 `totalSeconds` | ✅ | 被规范化为空记录，首页空状态显示（0 / 0 / 0），CTA “从调音开始”，控制台无 error。 |
| R03 | `sessions=null` | ✅ | sessions 守卫生效，首页正常渲染（分钟 2 / 答对 0 / 连续天数 1），控制台无 error。 |
| R04 | 顶层为对象 `{ "2026-05-15": {} }`（非数组） | ✅ | `loadAll()` 降级为 `[]`，首页空状态正常，控制台无 error。 |
| R05 | 顶层为字符串 `"garbage"` | ✅ | `loadAll()` 降级为 `[]`，首页空状态正常，控制台无 error。 |
| R06 | `localStorage.clear()` 全新用户 | ✅ | 新手空状态：分钟 0 / 答对 0 / 连续 0，CTA 为“从调音开始”，控制台无 error。 |
| R07 | 当日合法记录（300s + ear-training 3/5） | ✅ | 首页显示分钟 5 / 答对 3 / 连续天数 1，主 CTA 切换为“继续今天练习”，控制台无 error。 |
| R08 | 连续 3 天合法记录（含今日） | ✅ | 连续天数 = 3，30 天热力图最后 3 格为 active 绿色（`rgb(52,211,153)`），其余 27 格空态；控制台无 error。 |

**已知遗留**：
- 无。本轮异常数据用例（R01–R05）全部命中规范化路径，未触发 `HomeErrorBoundary` fallback；正常数据用例（R06–R08）统计与 CTA 切换均符合预期。Round 1 关单。

### Round 2 — 2026-05-15
**主题**：进度闭环 + 学习中心视觉对齐 / 麦克风权限统一组件

**改动文件**：
- 新增：`src/components/ProgressToast.tsx`、`src/components/MicPermissionState.tsx`
- 修改：`src/utils/progress.ts`、`src/App.tsx`、`src/pages/HomePage.tsx`、`src/pages/LearnHub.tsx`、`src/pages/TunerPage.tsx`、`src/pages/ListenPage.tsx`、`src/pages/ChordsPage.tsx`、`src/pages/ScalesPage.tsx`、`src/pages/PentatonicPage.tsx`、`src/pages/FretboardPage.tsx`、`src/pages/CircleOfFifthsPage.tsx`、`src/styles/global.css`

**产品要点**：
- 5 个练习入口（调音 / 听歌识别×2 / 和弦检测 / 找音）都能记进 progress，首页今日推荐真正反映用户行为
- LearnHub 增加 learn-subtitle 替代各子页冗余介绍卡，首屏内容密度提升
- 麦克风权限失败统一为 MicPermissionState 组件（denied/error + UA 分支恢复指引）
- ProgressToast 全局反馈"已记录"，1.8s 自动消失，带触觉反馈
- 空态文案统一为"正在听… 弹一下吧"

**开发要点**：
- recordSessionThrottled 新函数：30s 内同 module 合并写入，避免反复触发
- normalizeSession 兼容新增 t 字段，旧数据无影响
- tunedToday 判定从模糊 `/tuner/i` 改为精确 `=== 'tuner'`
- MicPermissionState 五态组件（idle/requesting/granted/denied/error）

**测试结果**（12 用例，移动端 390x844 视口，dark/light 双主题，麦克风通过 monkey-patch 模拟 success/denied/error）

| 用例 | 描述 | 结果 | 备注 |
| --- | --- | --- | --- |
| R2-01 | LearnHub 5 个 tab 都有 `.learn-subtitle` 一行 | ✅ | 和弦"🎵 和弦 · 47 个 / 标准调弦"、音阶"🎼 音阶 · 9 种"、五声"🎯 五声 · 3 类 / 5 把位"、指板"🎸 指板"、五度圈"⭕ 五度圈 · 12 调"；毛玻璃背景 `rgba(24,32,51,.72)` + `backdrop-filter:blur(12px)` + 1px 半透白边框，切换有入场动效。 |
| R2-02 | 学习子页无冗余介绍卡 | ✅ | 5/5 通过：ScalesPage、PentatonicPage、FretboardPage、CircleOfFifthsPage 在初次测试时已对齐；ChordsPage 由 hotfix 补删 `<div class="card"><h2>🎵 和弦学习</h2>...</div>` 块。 |
| R2-03 | ChordsPage 颜色 token 化 | ✅ | `--text-muted = #8A94A7`（dark 主题）；ChordsPage.tsx grep `#475569` 0 命中；和弦详情页 DOM 内联样式扫描无 `#475569` 残留。 |
| R2-04 | 浅色主题不崩 | ✅ | `data-theme="light"` 切换后 `/#/home /#/learn /#/practice` 三页面均正常渲染，body 背景 `rgb(246,248,251)`、文字 `rgb(31,41,55)`，无大块白底白字。 |
| R2-05 | Toast 手动触发（`progress-recorded` CustomEvent）| ✅ | 触发后 0.3s 内出现 `.progress-toast.show`，绿色边框 `1px solid rgba(52,211,153,.32)`，文字"✓ 已记录 · 测试"，2.5s 后类名变 `.progress-toast`（去掉 show），`opacity:0` 自动消失。 |
| R2-06 | Toast 不遮挡底部导航 | ✅ | Toast bottom=764, 底部 `.bottom-nav` top=780，16px 间距，无重叠。 |
| R2-07 | listen-chord 记录 | ✅ | `localStorage.clear()` 后启动监听 12s 再停止，progress 出现 `{module:'listen-chord', score:0, total:0, seconds:21, t:1778829575339}`；带 `t` 字段；控制台无 error。（mock 110Hz 单音 score=0 属正常，无可识别和弦。）|
| R2-08 | listen-key 记录 | ✅ | 切到"听曲定调"再监听 12s 停止，progress 追加 `{module:'listen-key', score:0, total:1, seconds:23, t:1778829640139}`。 |
| R2-09 | chord-detect throttle 合并 | ✅ | 通过 `import('/src/utils/progress.ts')` 直接 3 次 rapid 调用 `recordSessionThrottled('chord-detect', ...)`：localStorage 中只有 **1 条** chord-detect session，`score:2, total:3, seconds:15`，证明 30s 内合并写入。（UI 路径下 mock 单音无法触发真实和弦判定，故走直接函数验证。）|
| R2-10 | fretboard-find 记录 | ✅ | 进入找音模式点击 5 个指板格子后自动出现 `{module:'fretboard-find', score:1, total:5, seconds:15, t:...}`，Toast"✓ 已记录 · 找音 1/5"在底部短暂可见。 |
| R2-11 | 首页"已调音 ✓"分支 | ✅ | 手动塞入 `{module:'tuner', total:1}` 后访问 `/#/home`，今日推荐区文案为"已调音 ✓，再来一次听歌识别或听音辨认。"，命中 tunedToday 精确匹配分支。 |
| R2-12 | MicPermissionState denied → retry → granted | ✅ | `__mockMicDenied()` + 点击"开始调音" → 红色 `.mic-perm.denied` 卡片渲染：🚫 + "麦克风权限被拒绝" + "点击地址栏的 🔒 → 网站设置 → 麦克风 → 允许。" + "再试一次"按钮；切到 `__mockMicSuccess()` 再点重试 → `.mic-perm` 完全卸载，控制台无未捕获错误。 |

**控制台 errors 汇总**：全 12 用例均无 error，只有两条 React Router v7 future flag warning（与 Round 1 一致，与本轮改动无关）。

**已知遗留**：
- 测试环境无法弹真实麦克风权限，R2-07/08/09/10 的进度记录通过 `getUserMedia` monkey-patch + 110Hz 合成音验证；其中 R2-09 throttle 因合成音无法触发真实和弦匹配，改用 `import('/src/utils/progress.ts')` 直接调函数证明 throttle 合并语义生效。
- 截图目录：`/tmp/guitar-test/round2/`（22 张，含 5 个 tab 各 1 张、2 张 toast 时序、2 张明暗对照、麦克风 denied/retry 等）。

**Hotfix（同轮内修复）**

- 改动文件：`src/pages/ChordsPage.tsx`
- 修复点：补删 ChordBrowser 子组件内残留的"🎵 和弦学习 / 点击和弦卡片查看指法图…" 介绍卡，使学习中心 5 个子页规范一致。
- 验证：`npm run build` 通过；R2-02 由 ⚠️ 转为 ✅。

**结论**：Round 2 通过率 **12/12 ✅**。MicPermissionState、ProgressToast、recordSessionThrottled、首页 tunedToday 分支、5 处进度记录入口、learn-subtitle 视觉对齐均工作正常。Round 2 关单，进入 Round 3。
