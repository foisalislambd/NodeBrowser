const DEFAULT = `const fs = require('fs');
const crypto = require('crypto');
const { performance } = require('perf_hooks');

console.log('cwd =', process.cwd());
fs.writeFileSync('/home/project/hello.txt', 'BrowserNode VFS OK');
console.log(fs.readFileSync('/home/project/hello.txt'));
console.log('Buffer hex =', Buffer.from('hi').toString('hex'));
console.log('randomBytes =', crypto.randomBytes(8).toString('hex'));
console.log('sha256 =', crypto.createHash('sha256').update('browsernode').digest('hex').slice(0, 16) + '…');
console.log('perf.now =', performance.now());
process.nextTick(function() { console.log('nextTick ok'); });
console.log('2 + 2 =', 2 + 2);
`;

const HTTP_DEMO = `const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Hello from BrowserNode</h1><p>Served without a remote server.</p><p>path=' + req.url + '</p>');
});

server.listen(3000, () => {
  console.log('listening on 3000');
});
`;

const BUNDLE_ENTRY = `export function greet(name) {
  return 'Hello, ' + name + ' from esbuild-wasm';
}
console.log(greet('BrowserNode'));
`;

function $(id) {
  return document.getElementById(id);
}

function appendTerm(text) {
  const term = $('term');
  term.textContent += text;
  term.scrollTop = term.scrollHeight;
}

async function loadApi() {
  try {
    return await import('/packages/api/dist/index.js');
  } catch {
    return await import('./browsernode-api.js');
  }
}

const editor = $('editor');
editor.value = DEFAULT;

let bn = null;
let httpProc = null;

async function showPreview(port, url) {
  $('preview-url').textContent = url || '';
  // Always paint via handleHttp → srcdoc so preview works even if SW/iframe fetch fails
  if (bn && port != null) {
    try {
      const res = await bn.handleHttp({
        id: 'preview-' + Math.random().toString(36).slice(2),
        port,
        method: 'GET',
        path: '/',
      });
      if (res.status >= 200 && res.status < 400 && res.body) {
        const type = (res.headers && res.headers['Content-Type']) || 'text/html';
        if (String(type).includes('html') || res.body.trimStart().startsWith('<')) {
          $('preview').removeAttribute('src');
          $('preview').srcdoc = res.body;
          appendTerm(`[preview] rendered port ${port} via HttpBridge (${res.status})\n`);
          return;
        }
      }
      appendTerm(`[preview] handleHttp ${res.status}: ${String(res.body).slice(0, 120)}\n`);
    } catch (e) {
      appendTerm(`[preview] handleHttp failed: ${e}\n`);
    }
  }
  if (url) {
    $('preview').removeAttribute('srcdoc');
    $('preview').src = url;
  }
}

async function boot() {
  $('status').textContent = 'booting…';
  const { BrowserNode } = await loadApi();
  bn = await BrowserNode.boot();
  bn.attachServiceWorkerBridge('/__bn_preview');
  await bn.mount({
    home: {
      directory: {
        project: {
          directory: {
            'index.js': { file: { contents: editor.value } },
          },
        },
      },
    },
  });
  bn.on('server-ready', (port, url) => {
    appendTerm(`\n[server-ready] port=${port} url=${url}\n`);
    showPreview(port, url).catch((e) => appendTerm(String(e) + '\n'));
  });
  bn.on('install-progress', (p) => {
    appendTerm(`[install] ${p.phase} ${p.name}${p.version ? '@' + p.version : ''}${p.message ? ' — ' + p.message : ''}\n`);
  });
  $('status').textContent = 'ready';
  appendTerm('BrowserNode ready (JS runtime + HttpBridge).\n');
}

async function runNode() {
  if (!bn) return;
  $('term').textContent = '';
  await bn.fs.writeFile('/home/project/index.js', editor.value);
  const proc = await bn.spawn('node', ['/home/project/index.js'], { cwd: '/home/project' });
  const reader = proc.output.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    appendTerm(value);
  }
  const code = await proc.exit;
  appendTerm(`\n[exit ${code}]\n`);
}

async function installMs() {
  if (!bn) return;
  appendTerm('npm install ms …\n');
  try {
    await bn.install(['ms'], '/home/project');
    appendTerm('installed ms → /home/project/node_modules/ms\n');
    editor.value = `const ms = require('ms');
console.log(ms('2 days'));
console.log(ms('1h'));
`;
  } catch (e) {
    appendTerm(String(e) + '\n');
  }
}

async function httpDemo() {
  if (!bn) return;
  if (httpProc) {
    try {
      httpProc.kill();
    } catch {
      /* ignore */
    }
    httpProc = null;
  }
  editor.value = HTTP_DEMO;
  await bn.fs.writeFile('/home/project/server.js', HTTP_DEMO);
  $('term').textContent = '';
  httpProc = await bn.spawn('node', ['/home/project/server.js'], { cwd: '/home/project' });
  const reader = httpProc.output.getReader();
  (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      appendTerm(value);
    }
    appendTerm('\n[http process ended]\n');
  })();
  appendTerm('(server keep-alive — preview via Service Worker)\n');
}

async function bundleDemo() {
  if (!bn) return;
  $('term').textContent = '';
  appendTerm('esbuild-wasm bundle …\n');
  try {
    await bn.fs.mkdir('/src', { recursive: true });
    await bn.fs.writeFile('/src/main.js', BUNDLE_ENTRY);
    await bn.fs.writeFile(
      '/dist/index.html',
      '<!doctype html><meta charset=utf-8><title>bundle</title><body><pre id=o>bundled</pre><script src="./bundle.js"></script></body>',
    );
    const { outfile } = await bn.bundle({ entry: '/src/main.js', outfile: '/dist/bundle.js', format: 'iife' });
    appendTerm(`wrote ${outfile}\n`);
    editor.value = BUNDLE_ENTRY;
  } catch (e) {
    appendTerm(String(e) + '\n');
  }
}

$('btn-run').addEventListener('click', () => runNode().catch((e) => appendTerm(String(e) + '\n')));
$('btn-install').addEventListener('click', () => installMs().catch((e) => appendTerm(String(e) + '\n')));
$('btn-http').addEventListener('click', () => httpDemo().catch((e) => appendTerm(String(e) + '\n')));
$('btn-bundle')?.addEventListener('click', () => bundleDemo().catch((e) => appendTerm(String(e) + '\n')));

async function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    await reg.update().catch(() => {});
    await navigator.serviceWorker.ready;
    // Wait until this page is controlled (needed for preview iframe fetches)
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 1500);
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });
    }
    appendTerm(
      `service worker ready (${reg.scope}) controller=${!!navigator.serviceWorker.controller}\n`,
    );
  } catch (e) {
    appendTerm('SW register failed: ' + e + '\n');
  }
}

registerSw()
  .then(() => boot())
  .catch((e) => {
    $('status').textContent = 'boot failed';
    appendTerm(String(e) + '\n');
  });
