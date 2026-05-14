import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* HashRouter 兼容 file:// 与 PWA 离线场景 */}
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);

// 注册 Service Worker（PWA 离线缓存），仅在生产构建后生效
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 离线缓存不可用时静默忽略 */
    });
  });
}