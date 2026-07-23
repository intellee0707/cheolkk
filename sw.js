/* 철크크 Service Worker — 푸시 알림 + PWA */
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(clients.claim()); });

/* PWA 설치 요건용 fetch 핸들러 (네트워크 우선, 오프라인 시 캐시) */
const CACHE = 'cheolkk-v7';
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(res => {
      try {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      } catch (err) {}
      return res;
    }).catch(() => caches.match(e.request))
  );
});

/* 푸시 수신 → 알림 표시 */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  const title = d.title || '철크크';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '철학자들이 기다리고 있어요',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'cheolkk',
    data: { url: d.url || '/' }
  }));
});

/* 알림 클릭 → 앱 열기/포커스 */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow((e.notification.data && e.notification.data.url) || '/');
    })
  );
});
