/**
 * Dev server with COOP/COEP headers (required for SharedArrayBuffer / WASM threads later).
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const demoDist = join(root, 'demo', 'dist');
const port = Number(process.env.PORT || 5173);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  const url = new URL(req.url || '/', `http://localhost:${port}`);

  // Fallback only when no controlling Service Worker (SW owns this path in the demo)
  if (url.pathname.startsWith('/__bn_preview/')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<!doctype html><meta charset=utf-8><title>BrowserNode Preview</title>` +
        `<body style="font:14px system-ui;padding:2rem"><h1>Preview fallback</h1>` +
        `<p>Port route: ${url.pathname}</p>` +
        `<p>Service Worker should proxy this into HttpBridge. Hard-refresh if you see this.</p>`,
    );
    return;
  }

  // Serve workspace node_modules (esbuild-wasm) with CORP for COEP pages
  if (url.pathname.startsWith('/node_modules/')) {
    const mapped = join(root, url.pathname.replace(/^\//, ''));
    if (existsSync(mapped)) {
      try {
        const data = await readFile(mapped);
        res.writeHead(200, {
          'Content-Type': mime[extname(mapped)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(data);
        return;
      } catch {
        res.writeHead(500).end('error');
        return;
      }
    }
  }

  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';

  // Serve demo + packages
  const candidates = [
    join(demoDist, path.replace(/^\//, '')),
    join(root, 'packages', 'api', path.replace(/^\//, '')),
    join(root, 'packages', 'api', 'dist', path.replace(/^\/packages\/api\/dist\//, '').replace(/^\//, '')),
    join(root, 'packages', 'api', 'wasm', path.replace(/^\/packages\/api\/wasm\//, '').replace(/^\//, '')),
    join(root, path.replace(/^\//, '')),
  ];

  // Map /packages/api/... explicitly
  if (url.pathname.startsWith('/packages/api/')) {
    const rel = url.pathname.replace(/^\/packages\/api\//, '');
    const mapped = join(root, 'packages', 'api', rel);
    if (existsSync(mapped)) {
      try {
        const data = await readFile(mapped);
        res.writeHead(200, {
          'Content-Type': mime[extname(mapped)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(data);
        return;
      } catch {
        res.writeHead(500).end('error');
        return;
      }
    }
  }

  let file = null;
  for (const c of candidates) {
    const n = normalize(c);
    if (!n.startsWith(root)) continue;
    if (existsSync(n)) {
      file = n;
      break;
    }
  }

  if (!file) {
    res.writeHead(404).end('Not found');
    return;
  }

  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': mime[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(500).end('error');
  }
});

server.listen(port, () => {
  console.log(`BrowserNode demo → http://localhost:${port}`);
  console.log('(COOP/COEP enabled)');
});
