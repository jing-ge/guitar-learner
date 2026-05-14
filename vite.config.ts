import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯本地应用：使用相对路径，构建后可直接打开 dist/index.html
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', sourcemap: false },
  server: { host: true, port: 5173, open: true }
});