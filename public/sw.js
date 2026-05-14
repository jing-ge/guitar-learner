/* 简易 Service Worker：app shell 缓存优先 + 离线运行
   原理：第一次打开会缓存所有同源资源；之后再访问优先走缓存，没有再走网络。
   纯静态 SPA 即可完全离线使用。
*/
const CACHE_NAME = 'guitar-learner-v1';

self.addEventListener('install', (event) => {
  // 立即激活新版本
  self.skipWaiting();
  // 预缓存核心入口（其他资源在首次访问时按需缓存）
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(['./', './index.html', './manifest.webmanifest', './icon.svg']).catch(() => {})
    )
  );
});

self.addEventListener('activate', (event) => {
  // 清理旧版本缓存
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // 仅处理 GET
  if (req.method !== 'GET') return;
  // 同源资源：cache-first，否则透传
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // 把成功响应也放进缓存（按需缓存）
          if (res && res.status === 200 && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          // 完全离线时如果是 HTML 导航，回退到首页
          if (req.mode === 'navigate') return caches.match('./index.html');
          throw new Error('offline');
        });
    })
  );
});