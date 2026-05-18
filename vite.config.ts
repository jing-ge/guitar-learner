import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯本地应用：使用相对路径，构建后可直接打开 dist/index.html
//
// inlineDynamicImports 开关（Round 49.5 + 50.2 修复）：
//   - 默认走 dynamic code-split：essentia (~2.5MB) 懒加载，PWA/Web 首屏只 ~400KB
//   - VITE_INLINE_DYNAMIC=1 时所有 dynamic chunk 合并进主 bundle → 适合 APK 打包
//     避免 file:// 协议下 Android WebView dynamic import 失败
//   - Round 50.2 关键修复: inline-dist.mjs 在该模式下输出 <script type="module">
//     原因: inlineDynamicImports 后主 bundle 含 import.meta (Vite 编译 import() 时引用),
//          classic <script> 不允许 import.meta → 整个 bundle 语法错误 → APK 黑屏
//     现代 Android WebView (Chrome 80+) inline module script 合法
//   - 已知坑（历史复盘）:
//     · Round 50.1: React DOM 含 "<script><\/script>" 字面量, escape 漏 <script
//     · Round 50.2: import.meta 在 classic script 不允许 (本次修复)
const inlineDynamic = (globalThis as any).process?.env?.VITE_INLINE_DYNAMIC === '1';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: inlineDynamic ? {
      output: { inlineDynamicImports: true },
    } : undefined,
  },
  server: { host: true, port: 5173, open: true }
});