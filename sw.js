/* Deep End Service Worker — 푸시 알림 + PWA */
self.addEventListener('install', e => { self.skipWaiting(); });

/* 캐시 이름을 바꿀 때마다 옛 캐시를 자동으로 지운다 */
const CACHE = 'deepend-v8';
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await clients.claim();
  })());
});

/* PWA 설치 요건용 fetch 핸들러 (네트워크 우선, 오프라인 시 캐시) */
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

/* 푸시 수신 → 알림 표시
   서버(send-push)가 구독자의 lang에 맞춰 title/body를 보내는 것이 정상 경로다.
   아래 기본값은 payload가 비었을 때만 쓰이므로, 앱 기본 언어인 영어로 둔다. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  const title = d.title || 'Deep End';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'The philosophers are waiting.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'deepend',
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
