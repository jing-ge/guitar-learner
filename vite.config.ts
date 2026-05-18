import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯本地应用：使用相对路径，构建后可直接打开 dist/index.html
//
// inlineDynamicImports 开关（Round 49.5）：
//   - 默认走 dynamic code-split：essentia (~2.5MB) 懒加载，PWA/Web 首屏只 ~400KB
//   - VITE_INLINE_DYNAMIC=1 时所有 dynamic chunk 合并进主 bundle → 适合 APK 打包
//     避免 file:// 协议下 Android WebView dynamic import 失败的兼容性风险
//   - 已知坑：默认开 code-split 时 HTML ~430KB；强制 inline 后 HTML ~3MB
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