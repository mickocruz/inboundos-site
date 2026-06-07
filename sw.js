const CACHE = 'inboundos-v2';
const PRECACHE = [
  '/dashboard/pipeline.html',
  '/dashboard/crm.html',
  '/dashboard/performance.html',
  '/NHGDisplay95Black.otf'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});

// Feature E: Follow-up push notifications
// Called from CRM page via postMessage
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'FOLLOWUP_CHECK') {
    const { overdue, today } = e.data;
    const total = (overdue || 0) + (today || 0);
    if (total > 0 && Notification.permission === 'granted') {
      self.registration.showNotification('InboundOS — Follow-ups Due', {
        body: `${overdue > 0 ? `${overdue} overdue` : ''}${overdue > 0 && today > 0 ? ' · ' : ''}${today > 0 ? `${today} due today` : ''}`,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: 'followup',
        renotify: false,
        data: { url: '/crm' }
      });
    }
  }
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(clients.matchAll({ type: 'window' }).then(wins => {
    const existing = wins.find(w => w.url.includes(url));
    if (existing) return existing.focus();
    return clients.openWindow(url);
  }));
});
