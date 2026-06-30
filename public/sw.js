// KILL-SWITCH service worker.
// The previous caching SW served a STALE dashboard after refresh ("I don't see my
// update"). A live trading dashboard needs fresh HTML every load, not offline PWA
// caching. This worker takes over immediately, purges ALL caches, unregisters
// itself, and reloads open tabs once so they fetch fresh from the server (which
// already sends Cache-Control: no-store for HTML). After this, no SW remains.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));   // wipe every cached page
      await self.clients.claim();
      await self.registration.unregister();                 // remove this SW
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => { try { c.navigate(c.url); } catch (_) {} }); // one fresh reload
    } catch (_) {}
  })());
});

// No fetch handler → requests go straight to the network (HTML is no-store).
