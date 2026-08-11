/* Service Worker — routes /__bn_preview/:port/* into the BrowserNode page */
self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const m = url.pathname.match(/^\/__bn_preview\/(\d+)(\/.*)?$/);
  if (!m) return;

  event.respondWith(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window' });
      const client = clients[0];
      if (!client) {
        return new Response('No BrowserNode client', { status: 503 });
      }

      const port = Number(m[1]);
      const path = m[2] || '/';
      const id = Math.random().toString(36).slice(2);
      const responsePromise = new Promise((resolve) => {
        const onMsg = (ev) => {
          if (!ev.data || ev.data.type !== 'bn-http-response' || ev.data.id !== id) return;
          self.removeEventListener('message', onMsg);
          resolve(
            new Response(ev.data.body ?? '', {
              status: ev.data.status || 200,
              headers: ev.data.headers || { 'Content-Type': 'text/plain' },
            }),
          );
        };
        self.addEventListener('message', onMsg);
        setTimeout(() => {
          self.removeEventListener('message', onMsg);
          resolve(
            new Response(
              `<!doctype html><h1>BrowserNode</h1><p>Listening on virtual port ${port}</p><p>${path}</p>`,
              { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            ),
          );
        }, 500);
      });

      client.postMessage({
        type: 'bn-http-request',
        id,
        port,
        path,
        method: event.request.method,
      });

      return responsePromise;
    })(),
  );
});
