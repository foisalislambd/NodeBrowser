/* Service Worker — routes /__bn_preview/:port/* into the BrowserNode page via MessageChannel */
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
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Prefer the controlling app page, never the preview iframe itself
      const client =
        clients.find((c) => {
          try {
            const u = new URL(c.url);
            return c.frameType === 'top-level' && !u.pathname.startsWith('/__bn_preview');
          } catch {
            return c.frameType === 'top-level';
          }
        }) ||
        clients.find((c) => c.frameType === 'top-level') ||
        clients[0];

      if (!client) {
        return new Response('No BrowserNode client', { status: 503 });
      }

      const port = Number(m[1]);
      const path = m[2] || '/';
      const id = Math.random().toString(36).slice(2);

      let headers = {};
      try {
        headers = Object.fromEntries(event.request.headers.entries());
      } catch {
        /* ignore */
      }
      let body;
      try {
        if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
          body = await event.request.text();
        }
      } catch {
        /* ignore */
      }

      const channel = new MessageChannel();
      const responsePromise = new Promise((resolve) => {
        const timer = setTimeout(() => {
          resolve(
            new Response(`No response from BrowserNode for port ${port}`, {
              status: 504,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            }),
          );
        }, 15000);

        channel.port1.onmessage = (ev) => {
          clearTimeout(timer);
          const data = ev.data || {};
          resolve(
            new Response(data.body ?? '', {
              status: data.status || 200,
              headers: data.headers || { 'Content-Type': 'text/html; charset=utf-8' },
            }),
          );
        };
        channel.port1.start();
      });

      client.postMessage(
        {
          type: 'bn-http-request',
          id,
          port,
          path,
          method: event.request.method,
          headers,
          body,
        },
        [channel.port2],
      );

      return responsePromise;
    })(),
  );
});
