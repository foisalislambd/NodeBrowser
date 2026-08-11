const DEFAULT = `const fs = require('fs');
const path = require('path');

console.log('cwd =', process.cwd());
fs.writeFileSync('/home/project/hello.txt', 'BrowserNode VFS OK');
console.log(fs.readFileSync('/home/project/hello.txt'));
console.log('2 + 2 =', 2 + 2);
`;

const HTTP_DEMO = `const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h1>Hello from BrowserNode</h1><p>Served without a remote server.</p>');
});

server.listen(3000, () => {
  console.log('listening on 3000');
});
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
  // Served from monorepo paths by serve-demo.mjs
  try {
    return await import('/packages/api/dist/index.js');
  } catch {
    // relative when opened from demo/dist with copied stubs
    return await import('./browsernode-api.js');
  }
}

const editor = $('editor');
editor.value = DEFAULT;

let bn = null;

async function boot() {
  $('status').textContent = 'booting…';
  const { BrowserNode } = await loadApi();
  bn = await BrowserNode.boot();
  await bn.mount({
    'home': {
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
    $('preview-url').textContent = url;
    $('preview').src = url;
    appendTerm(`\n[server-ready] port=${port} url=${url}\n`);
  });
  $('status').textContent = 'ready';
  appendTerm('BrowserNode ready.\n');
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
  editor.value = HTTP_DEMO;
  await bn.fs.writeFile('/home/project/server.js', HTTP_DEMO);
  $('term').textContent = '';
  const proc = await bn.spawn('node', ['/home/project/server.js'], { cwd: '/home/project' });
  const reader = proc.output.getReader();
  (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      appendTerm(value);
    }
  })();
  // Fallback preview page if SW not active
  setTimeout(() => {
    if (!$('preview').src) {
      $('preview').srcdoc =
        '<h1 style="font-family:sans-serif">HTTP server registered in-kernel</h1>' +
        '<p>Full request proxy lands with Service Worker (sw.js).</p>';
      $('preview-url').textContent = '/__bn_preview/3000/';
    }
  }, 200);
}

$('btn-run').addEventListener('click', () => runNode().catch((e) => appendTerm(String(e) + '\n')));
$('btn-install').addEventListener('click', () => installMs().catch((e) => appendTerm(String(e) + '\n')));
$('btn-http').addEventListener('click', () => httpDemo().catch((e) => appendTerm(String(e) + '\n')));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

boot().catch((e) => {
  $('status').textContent = 'boot failed';
  appendTerm(String(e) + '\n');
});
