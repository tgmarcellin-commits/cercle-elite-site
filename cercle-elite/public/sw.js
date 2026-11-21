// Service worker de Cercle Élite : notifications push + installation de l'application.
// Aucune mise en cache des pages ni des appels /api : le site reste toujours à jour.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = {}; }
  const title = data.title || 'Cercle Élite';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'Vous avez un nouveau message.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'cercle-message',
      renotify: true,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  const targetPath = new URL(target, self.location.origin).pathname;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const samePage = clients.find((client) => new URL(client.url).pathname === targetPath && 'focus' in client);
      if (samePage) return samePage.focus();
      return self.clients.openWindow(target);
    }),
  );
});
