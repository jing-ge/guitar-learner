# Native (Expo) 端 Essentia.js 可行性手动验证清单

> Round 48 留给后续真机验证的 5 步清单。AI agent 无法替你跑真机，但能保证：
> - 不支持 WebAssembly 的环境会显示降级提示，**不会白屏崩溃**
> - 支持的环境（包括 Android WebView Chrome 80+ / iOS WebKit）按 Web 端流程跑

## 背景

Round 47 引入了 essentia.js (~2.5 MB WASM)，在浏览器端走 Vite 的 dynamic import 分包。
但 native/ 是 Expo + react-native-webview，构建后走 `file://` 协议加载本地 HTML 资产。

**潜在风险**：
1. `file://` 协议下 dynamic `import('./assets/essentia-wasm.es.js')` 是否成功
2. Android WebView 各 OEM 版本（小米/华为/三星/原生）行为差异
3. iOS WKWebView 是否能跑 WASM（理论上 14+ 都行）
4. 旧设备 WASM heap 上限 / 兼容性

## 验证步骤

### 1. Web 端先确认基线（已通过 ✅）

```bash
npm run dev
# 浏览器开 http://localhost:5173/listen
# 浏览器 DevTools console 应该看到：
#   [round48] essentia chunk loaded
#   [round48] MediaRecorder mimeType: audio/webm;codecs=opus (Chrome 视情况)
# 录 10s → 出现调性 / BPM / 时间线 / 走向总结
```

### 2. 构建产物

```bash
npm run build
# dist/index.html (~430 KB)
# dist/assets/essentia-wasm.es-*.js (~2.5 MB)
# dist/assets/essentia.js-core.es-*.js (~42 KB)
```

### 3. 复制到 native/ 并启动 Expo

```bash
cd native
node scripts/copy-web.js     # 复制 ../dist → assets/web/
npx expo start
# 用 Expo Go 扫码进 App，或 dev-client 打 dev build
```

### 4. 真机测试 Listen 页

打开「听歌识别」tab：

**A. Android 真机（Pixel 6 / 小米 / 华为）**

- ✅ 页面渲染正常 + 看到「🎧 听歌识别 (Essentia)」标题
- ❓ 如果显示「当前环境不支持离线识别」降级提示 → 说明 WebAssembly 或 BigInt 检测失败，需打开 WebView remote debugging 进一步排查
- ❓ 点 🎤 录音按钮 → 麦克风权限弹窗（如果是 Expo Go 需在 app.json 里申明 RECORD_AUDIO 权限）
- ❓ 录 10s → 进入 analyzing 状态。**冷启动加载 WASM 耗时记录**：__ s
- ❓ 出结果 → 调性 ___ ___（实测填入）

**B. iOS 真机（iPhone 13+ iOS 17+）**

- 同上 4 步
- 重点观察 `MediaRecorder.mimeType` 是否落到 `audio/mp4`
- 重点观察 `AudioContext({ sampleRate: 44100 })` 是否生效（iOS 部分版本会忽略采样率）

### 5. 如果失败，降级路径

- 不支持环境：UI 自动显示降级提示，用户可在系统浏览器中打开（推荐 PWA 路径）
- 性能不足：dist/index.html 的 PWA 模式比 WebView 套壳更快（更多原生优化）

## 已知设计取舍

1. **不再用 UA 字符串判断**：Round 47 PRD 想 `userAgent.includes('Expo')` 走降级，Round 48 改为纯能力检测 `typeof WebAssembly !== 'undefined' && typeof BigInt !== 'undefined'`。让真实功能决定，而不是字符串匹配。
2. **降级 UI 只在 Listen 页面**：调音器、和弦练习、节拍器都不依赖 Essentia，不受影响。
3. **如果未来需要彻底解决 file:// 加载**：把 essentia-wasm.es.js 也 inline 进 HTML（修改 scripts/inline-dist.mjs 把 dynamic chunk 也 inline）。代价是 HTML 从 430 KB 暴涨到 3 MB，仅对 native 端有意义。

## 反馈渠道

测试结果请填入此文档底部，或在 README round 49+ 段落记录 native 实测数据。
