// Service worker for admin booking alerts (Web Push).
// It only shows notifications; it does not cache or intercept any requests,
// so it never affects the public website.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'New booking', body: event.data?.text() }; }
  const url = typeof data.url === 'string' && data.url.startsWith(self.location.origin) ? data.url : `${self.location.origin}/admin`;
  event.waitUntil(
    self.registration.showNotification(data.title || 'New booking', {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.renotify),
      requireInteraction: true,
      icon: '/admin-icon-192.png',
      badge: '/admin-icon-192.png',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/admin';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).pathname === '/admin') { await c.focus(); return c.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
