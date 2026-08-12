const DEFAULT = `const fs = require('fs');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { createRequire } = require('module');
const { AsyncLocalStorage } = require('async_hooks');

console.log('cwd =', process.cwd());
fs.writeFileSync('/home/project/hello.txt', 'NodeBrowser VFS OK');
console.log(fs.readFileSync('/home/project/hello.txt'));
console.log('Buffer hex =', Buffer.from('hi').toString('hex'));
console.log('randomBytes =', crypto.randomBytes(8).toString('hex'));
console.log('realpath =', fs.realpathSync('/home/project/hello.txt'));
fs.copyFileSync('/home/project/hello.txt', '/home/project/hello.copy.txt');
console.log('copy ok', fs.existsSync('/home/project/hello.copy.txt'));
const req = createRequire('/home/project/index.js');
console.log('createRequire(fs).F_OK =', req('fs').constants.F_OK);
const als = new AsyncLocalStorage();
als.run({ n: 7 }, function() { console.log('als', als.getStore().n); });
console.log('perf.now =', performance.now());
process.nextTick(function() { console.log('nextTick ok'); });
`;

const HTTP_DEMO = `const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Hello from NodeBrowser</h1><p>Served without a remote server.</p><p>path=' + req.url + '</p>');
});

server.listen(3000, () => {
  console.log('listening on 3000');
});
`;

const BUNDLE_ENTRY = `export function greet(name) {
  return 'Hello, ' + name + ' from esbuild-wasm';
}
console.log(greet('NodeBrowser'));
`;

function $(id) {
  return document.getElementById(id);
}

function appendTerm(text) {
  const term = $('term');
  term.textContent += text;
  term.scrollTop = term.scrollHeight;
}

function dirname(p) {
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i) || '/';
}

function joinPath(dir, name) {
  if (dir === '/') return `/${name}`;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

async function loadApi() {
  // Resolve from this module URL so GitHub Pages `/NodeBrowser/` works without relying on <base>
  const url = new URL('packages/api/dist/index.js', import.meta.url).href;
  try {
    return await import(url);
  } catch (e) {
    try {
      return await import(new URL('packages/api/dist/index.js', document.baseURI).href);
    } catch {
      throw e;
    }
  }
}

const editor = $('editor');
editor.value = DEFAULT;

let bn = null;
let httpProc = null;
let openPath = '/home/project/index.js';
let projectCwd = '/home/project';
let selectedPath = '/home/project';
let dirty = false;
const expanded = new Set(['/', '/home', '/home/project']);

function setDirty(v) {
  dirty = !!v;
  const mark = $('tab-dirty');
  if (mark) mark.hidden = !dirty;
}

editor.addEventListener('input', () => {
  setDirty(true);
});

function basename(path) {
  const i = String(path).lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) || path : path;
}

function setBreadcrumb(path) {
  const el = $('breadcrumb');
  if (!el) return;
  const parts = String(path).split('/').filter(Boolean);
  el.textContent = '';
  parts.forEach((part, idx) => {
    if (idx) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '›';
      el.appendChild(sep);
    }
    const span = document.createElement('span');
    if (idx === parts.length - 1) span.className = 'current';
    span.textContent = part;
    el.appendChild(span);
  });
}

function setEditorPath(path) {
  openPath = path;
  const label = $('editor-path');
  if (label) {
    label.textContent = basename(path);
    label.title = path;
  }
  setBreadcrumb(path);
  const title = document.querySelector('.window-title');
  if (title) title.textContent = `NodeBrowser — ${path}`;
  const tabIcon = document.querySelector('.tab-icon');
  if (tabIcon) {
    if (/\.jsx?$/i.test(path)) tabIcon.textContent = 'JS';
    else if (/\.tsx?$/i.test(path)) tabIcon.textContent = 'TS';
    else if (/\.css$/i.test(path)) tabIcon.textContent = 'CSS';
    else if (/\.json$/i.test(path)) tabIcon.textContent = '{}';
    else if (/\.html?$/i.test(path)) tabIcon.textContent = '<>';
    else tabIcon.textContent = '·';
  }
}

function setCwd(path) {
  projectCwd = path;
  $('cwd-path').textContent = path;
  const st = $('status-cwd');
  if (st) st.textContent = path;
}

function setPreviewVisible(show) {
  const wb = $('workbench');
  if (!wb) return;
  wb.classList.toggle('preview-hidden', !show);
  document.querySelectorAll('.activity-btn[data-view="preview"]').forEach((btn) => {
    btn.classList.toggle('active', show);
  });
}

function setPreviewChrome(url) {
  const hidden = $('preview-url');
  if (hidden) hidden.textContent = url || '';
  const input = $('preview-url-input');
  if (input && url) input.value = url;
  const empty = $('preview-empty');
  if (empty) empty.classList.toggle('hidden', !!url || !!$('preview').srcdoc);
  setPreviewVisible(true);
}

async function showPreview(port, url, opts = {}) {
  setPreviewChrome(url || (port != null ? `port ${port}` : ''));
  if (opts.preferUrl && url) {
    $('preview').removeAttribute('srcdoc');
    $('preview').src = url;
    appendTerm(`[preview] iframe → ${url}\n`);
    if (window.matchMedia('(max-width: 760px)').matches) setMobilePane('preview');
    return;
  }
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
          const empty = $('preview-empty');
          if (empty) empty.classList.add('hidden');
          appendTerm(`[preview] rendered port ${port} via HttpBridge (${res.status})\n`);
          if (window.matchMedia('(max-width: 760px)').matches) setMobilePane('preview');
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
    if (window.matchMedia('(max-width: 760px)').matches) setMobilePane('preview');
  }
}

async function refreshTree() {
  if (!bn) return;
  const root = $('file-tree');
  root.textContent = '';
  await renderDir('/', root, 0);
}

async function renderDir(dirPath, container, depth) {
  let names = [];
  try {
    names = await bn.fs.readdir(dirPath);
  } catch {
    return;
  }
  names = [...names].sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    if (name === '.' || name === '..') continue;
    const full = joinPath(dirPath, name);
    let isDirectory = false;
    try {
      const st = await bn.fs.stat(full);
      isDirectory = st.isDirectory();
    } catch {
      continue;
    }
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tree-item' + (isDirectory ? ' dir' : '') + (full === selectedPath || full === openPath ? ' active' : '');
    row.style.paddingLeft = `${0.4 + depth * 0.75}rem`;
    row.dataset.path = full;
    row.setAttribute('role', 'treeitem');
    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = isDirectory ? (expanded.has(full) ? '▾' : '▸') : '·';
    const label = document.createElement('span');
    label.textContent = name;
    row.appendChild(icon);
    row.appendChild(label);
    row.addEventListener('click', () => onTreeClick(full, isDirectory).catch((e) => appendTerm(String(e) + '\n')));
    container.appendChild(row);
    if (isDirectory && expanded.has(full)) {
      await renderDir(full, container, depth + 1);
    }
  }
}

async function onTreeClick(path, isDirectory) {
  selectedPath = path;
  if (isDirectory) {
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
    setCwd(path);
    await refreshTree();
    return;
  }
  if (dirty && openPath !== path) {
    const save = confirm(`Save changes to ${openPath}?\nOK = save, Cancel = stay on current file`);
    if (!save) return;
    await saveFile();
  }
  const text = await bn.fs.readFile(path, 'utf8');
  editor.value = text;
  setDirty(false);
  setEditorPath(path);
  setCwd(dirname(path));
  await refreshTree();
  if (window.matchMedia('(max-width: 760px)').matches) setMobilePane('editor');
}

async function saveFile() {
  if (!bn || !openPath) return;
  await bn.fs.writeFile(openPath, editor.value);
  setDirty(false);
  appendTerm(`[save] ${openPath}\n`);
  await refreshTree();
}

async function newFile() {
  if (!bn) return;
  const name = prompt('New file name', 'untitled.js');
  if (!name) return;
  const base = (await isDirPath(selectedPath)) ? selectedPath : dirname(selectedPath);
  const path = joinPath(base, name);
  await bn.fs.writeFile(path, '');
  expanded.add(base);
  editor.value = '';
  setDirty(false);
  setEditorPath(path);
  selectedPath = path;
  setCwd(base);
  await refreshTree();
  appendTerm(`[new file] ${path}\n`);
}

async function newDir() {
  if (!bn) return;
  const name = prompt('New folder name', 'src');
  if (!name) return;
  const base = (await isDirPath(selectedPath)) ? selectedPath : dirname(selectedPath);
  const path = joinPath(base, name);
  await bn.fs.mkdir(path, { recursive: true });
  expanded.add(base);
  expanded.add(path);
  selectedPath = path;
  setCwd(path);
  await refreshTree();
  appendTerm(`[new dir] ${path}\n`);
}

async function isDirPath(path) {
  try {
    return (await bn.fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function deleteSelected() {
  if (!bn || !selectedPath || selectedPath === '/') return;
  if (!confirm(`Delete ${selectedPath}?`)) return;
  await bn.fs.rm(selectedPath, { recursive: true });
  appendTerm(`[rm] ${selectedPath}\n`);
  if (openPath === selectedPath || openPath.startsWith(selectedPath + '/')) {
    openPath = '/home/project/index.js';
    setEditorPath(openPath);
    try {
      editor.value = await bn.fs.readFile(openPath, 'utf8');
    } catch {
      editor.value = '';
    }
    setDirty(false);
  }
  selectedPath = dirname(selectedPath);
  setCwd(selectedPath);
  await refreshTree();
}

async function boot() {
  $('status').textContent = 'booting…';
  const { NodeBrowser } = await loadApi();
  const previewPath = new URL('__bn_preview', import.meta.url).pathname.replace(/\/$/, '');
  const previewBase = new URL('__bn_preview', import.meta.url).href.replace(/\/$/, '');
  // Primary path: C++ kernel via WASM (JS only if WASM fails to load)
  bn = await NodeBrowser.boot({ useWasm: true, previewBase, persist: true });
  appendTerm(`runtime=${bn.runtime}${bn.runtime === 'wasm' ? ' (C++/WASM kernel)' : ' (JS fallback — WASM unavailable)'}\n`);
  bn.attachServiceWorkerBridge(previewPath);
  if (bn.runtime === 'wasm') {
    appendTerm('Note: long-lived HTTP keep-alive is still strongest on JS; preview may use HttpBridge dispatch.\n');
  }
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
  setEditorPath(openPath);
  setCwd(projectCwd);
  await refreshTree();
  $('status').textContent = bn.runtime === 'wasm' ? 'ready · wasm' : 'ready · js';
  appendTerm('NodeBrowser ready — VFS file manager + in-tab install/run.\n');
}

async function runNode() {
  if (!bn) return;
  if (window.matchMedia('(max-width: 760px)').matches) setMobilePane('term');
  if (dirty) await saveFile();
  const script = openPath.endsWith('.js') || openPath.endsWith('.mjs') || openPath.endsWith('.cjs')
    ? openPath
    : '/home/project/index.js';
  if (script !== openPath) {
    await bn.fs.writeFile(script, editor.value);
  }
  const cwd = projectCwd || dirname(script);
  $('term').textContent = '';
  appendTerm(`$ node ${script}\n`);
  const proc = await bn.spawn('node', [script], { cwd });
  const reader = proc.output.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    appendTerm(value);
  }
  const code = await proc.exit;
  appendTerm(`\n[exit ${code}]\n`);
  await refreshTree();
}

async function installPkg() {
  if (!bn) return;
  const spec = prompt('npm package to install into VFS', 'ms');
  if (!spec) return;
  const cwd = projectCwd || '/home/project';
  appendTerm(`npm install ${spec} → ${cwd}/node_modules (in-tab)\n`);
  try {
    await bn.install([spec], cwd);
    appendTerm(`installed ${spec} → ${cwd}/node_modules\n`);
    expanded.add(cwd);
    expanded.add(joinPath(cwd, 'node_modules'));
    await refreshTree();
    if (spec === 'ms' || spec.startsWith('ms@')) {
      const smoke = `const ms = require('ms');\nconsole.log(ms('2 days'));\nconsole.log(ms('1h'));\n`;
      const smokePath = joinPath(cwd, 'index.js');
      await bn.fs.writeFile(smokePath, smoke);
      editor.value = smoke;
      setDirty(false);
      setEditorPath(smokePath);
      selectedPath = smokePath;
    }
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
  setDirty(false);
  const path = joinPath(projectCwd || '/home/project', 'server.js');
  await bn.fs.writeFile(path, HTTP_DEMO);
  setEditorPath(path);
  selectedPath = path;
  $('term').textContent = '';
  httpProc = await bn.spawn('node', [path], { cwd: dirname(path) });
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
  await refreshTree();
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
    setDirty(false);
    setEditorPath('/src/main.js');
    expanded.add('/src');
    expanded.add('/dist');
    await refreshTree();
  } catch (e) {
    appendTerm(String(e) + '\n');
  }
}

async function loadApps() {
  return import('./apps.js');
}

async function viteLoad() {
  if (!bn) return;
  const { loadVite } = await loadApps();
  $('term').textContent = '';
  const { files } = await loadVite(bn, appendTerm);
  try {
    editor.value = await bn.fs.readFile('/apps/vite/src/App.jsx', 'utf8');
    setEditorPath('/apps/vite/src/App.jsx');
    setDirty(false);
  } catch {
    editor.value = files.slice(0, 12).join('\n');
  }
  expanded.add('/apps');
  expanded.add('/apps/vite');
  expanded.add('/apps/vite/src');
  selectedPath = '/apps/vite';
  setCwd('/apps/vite');
  await refreshTree();
}

async function vitePreview() {
  if (!bn) return;
  const { viteStaticPreview } = await loadApps();
  $('term').textContent = '';
  const { url, port } = await viteStaticPreview(bn, appendTerm);
  await showPreview(port, url, { preferUrl: true });
  await refreshTree();
}

async function nextLoad() {
  if (!bn) return;
  const { loadNext } = await loadApps();
  $('term').textContent = '';
  const { files } = await loadNext(bn, appendTerm);
  try {
    editor.value = await bn.fs.readFile('/apps/next/app/page.js', 'utf8');
    setEditorPath('/apps/next/app/page.js');
    setDirty(false);
  } catch {
    editor.value = files.slice(0, 12).join('\n');
  }
  expanded.add('/apps');
  expanded.add('/apps/next');
  expanded.add('/apps/next/app');
  selectedPath = '/apps/next';
  setCwd('/apps/next');
  await refreshTree();
}

async function nextPreview() {
  if (!bn) return;
  const { nextStaticPreview } = await loadApps();
  $('term').textContent = '';
  const { url, port } = await nextStaticPreview(bn, appendTerm);
  await showPreview(port, url, { preferUrl: true });
  await refreshTree();
}

$('btn-save')?.addEventListener('click', () => saveFile().catch((e) => appendTerm(String(e) + '\n')));
$('btn-run').addEventListener('click', () => runNode().catch((e) => appendTerm(String(e) + '\n')));
$('btn-install').addEventListener('click', () => installPkg().catch((e) => appendTerm(String(e) + '\n')));
$('btn-http').addEventListener('click', () => httpDemo().catch((e) => appendTerm(String(e) + '\n')));
$('btn-bundle')?.addEventListener('click', () => bundleDemo().catch((e) => appendTerm(String(e) + '\n')));
$('btn-fs-refresh')?.addEventListener('click', () => refreshTree().catch((e) => appendTerm(String(e) + '\n')));
$('btn-fs-newfile')?.addEventListener('click', () => newFile().catch((e) => appendTerm(String(e) + '\n')));
$('btn-fs-newdir')?.addEventListener('click', () => newDir().catch((e) => appendTerm(String(e) + '\n')));
$('btn-fs-delete')?.addEventListener('click', () => deleteSelected().catch((e) => appendTerm(String(e) + '\n')));
$('btn-fs-clear')?.addEventListener('click', () => {
  (async () => {
    if (!bn) return;
    if (!confirm('Clear /home workspace?')) return;
    await bn.clearWorkspace();
    editor.value = DEFAULT;
    setEditorPath('/home/project/index.js');
    await bn.fs.writeFile('/home/project/index.js', DEFAULT);
    setDirty(false);
    await refreshTree();
    appendTerm('[workspace] cleared\n');
  })().catch((e) => appendTerm(String(e) + '\n'));
});
$('btn-fs-export')?.addEventListener('click', () => {
  (async () => {
    if (!bn) return;
    const bytes = await bn.exportSnapshot();
    const blob = new Blob([bytes], { type: 'application/gzip' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nodebrowser-home.tgz';
    a.click();
    URL.revokeObjectURL(a.href);
    appendTerm(`[workspace] exported ${bytes.length} bytes\n`);
  })().catch((e) => appendTerm(String(e) + '\n'));
});
$('btn-vite-load')?.addEventListener('click', () => viteLoad().catch((e) => appendTerm(String(e) + '\n')));
$('btn-vite-preview')?.addEventListener('click', () => vitePreview().catch((e) => appendTerm(String(e) + '\n')));
$('btn-next-load')?.addEventListener('click', () => nextLoad().catch((e) => appendTerm(String(e) + '\n')));
$('btn-next-preview')?.addEventListener('click', () => nextPreview().catch((e) => appendTerm(String(e) + '\n')));

function setMobilePane(name) {
  const wb = $('workbench');
  if (!wb) return;
  wb.dataset.pane = name;
  document.querySelectorAll('.mobile-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.pane === name);
  });
}

document.querySelectorAll('.mobile-nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => setMobilePane(btn.dataset.pane));
});

document.querySelectorAll('.activity-btn[data-view="explorer"]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const wb = $('workbench');
    if (!wb) return;
    const hide = !wb.classList.contains('sidebar-hidden');
    wb.classList.toggle('sidebar-hidden', hide);
    btn.classList.toggle('active', !hide);
  });
});

$('activity-preview')?.addEventListener('click', () => {
  const wb = $('workbench');
  if (!wb) return;
  setPreviewVisible(wb.classList.contains('preview-hidden'));
});

$('activity-run')?.addEventListener('click', () => {
  runNode().catch((e) => appendTerm(String(e) + '\n'));
});

$('btn-preview-close')?.addEventListener('click', () => setPreviewVisible(false));

$('btn-preview-reload')?.addEventListener('click', () => {
  const iframe = $('preview');
  const input = $('preview-url-input');
  if (iframe.srcdoc) {
    const html = iframe.srcdoc;
    iframe.srcdoc = '';
    iframe.srcdoc = html;
    return;
  }
  const url = (input && input.value) || iframe.src;
  if (url) {
    iframe.removeAttribute('srcdoc');
    iframe.src = 'about:blank';
    iframe.src = url;
  }
});

$('btn-preview-open')?.addEventListener('click', () => {
  const url = ($('preview-url-input') && $('preview-url-input').value) || $('preview-url')?.textContent;
  if (url && /^https?:/i.test(url)) window.open(url, '_blank', 'noopener');
});

$('preview-url-input')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const url = e.currentTarget.value.trim();
  if (!url) return;
  const iframe = $('preview');
  iframe.removeAttribute('srcdoc');
  iframe.src = url;
  const empty = $('preview-empty');
  if (empty) empty.classList.add('hidden');
  setPreviewVisible(true);
});

function bindSash(sashId, { axis, onDelta }) {
  const sash = $(sashId);
  if (!sash) return;
  let last = 0;
  const onMove = (e) => {
    const point = e.touches ? e.touches[0] : e;
    const pos = axis === 'x' ? point.clientX : point.clientY;
    const delta = pos - last;
    last = pos;
    onDelta(delta);
    e.preventDefault();
  };
  const onUp = () => {
    sash.classList.remove('dragging');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onUp);
  };
  const onDown = (e) => {
    const point = e.touches ? e.touches[0] : e;
    last = axis === 'x' ? point.clientX : point.clientY;
    sash.classList.add('dragging');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    e.preventDefault();
  };
  sash.addEventListener('mousedown', onDown);
  sash.addEventListener('touchstart', onDown, { passive: false });
}

bindSash('sash-sidebar', {
  axis: 'x',
  onDelta: (dx) => {
    const side = $('sidebar');
    if (!side || side.classList.contains('collapsed')) return;
    const next = Math.min(420, Math.max(140, side.getBoundingClientRect().width + dx));
    document.documentElement.style.setProperty('--sidebar-w', `${next}px`);
  },
});

bindSash('sash-preview', {
  axis: 'x',
  onDelta: (dx) => {
    const pane = $('preview-pane');
    if (!pane) return;
    // dragging left sash of preview: moving right shrinks preview
    const next = Math.min(window.innerWidth * 0.7, Math.max(240, pane.getBoundingClientRect().width - dx));
    document.documentElement.style.setProperty('--preview-w', `${next}px`);
  },
});

bindSash('sash-panel', {
  axis: 'y',
  onDelta: (dy) => {
    const panel = document.querySelector('.panel');
    if (!panel) return;
    const next = Math.min(window.innerHeight * 0.55, Math.max(100, panel.getBoundingClientRect().height - dy));
    document.documentElement.style.setProperty('--panel-h', `${next}px`);
  },
});

async function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    await reg.update().catch(() => {});
    await navigator.serviceWorker.ready;
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
