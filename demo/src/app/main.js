import { mountXterm, getTerm, fitAllTerms } from './term.js';
import { fileIconEl, langFromPath, tabBadge } from './icons.js';
import { publicBase, publicHref, publicPath } from './paths.js';
import { hideSplash, toast } from './ui.js';
import '@xterm/xterm/css/xterm.css';
import '../index.css';

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

function appendTerm(text, which) {
  const id = which || window.__bn_active_term || 'term';
  const api = getTerm(id);
  if (api) {
    api.write(text);
    return;
  }
  const term = $(id) || $('term');
  if (!term) return;
  term.textContent += text;
  term.scrollTop = term.scrollHeight;
}

function clearTerm(which) {
  const id = which || window.__bn_active_term || 'term';
  const api = getTerm(id);
  if (api) {
    api.clear();
    return;
  }
  const term = $(id) || $('term');
  if (term) term.textContent = '';
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
  const url = publicHref('packages/api/dist/index.js');
  return import(/* @vite-ignore */ url);
}

const editor = $('editor');
editor.value = DEFAULT;

let bn = null;
let httpProc = null;
let openPath = '/home/project/index.js';
let projectCwd = '/home/project';
let lastPreview = { port: null, url: '' };
let selectedPath = '/home/project';
let dirty = false;
const expanded = new Set(['/', '/home', '/home/project']);

function setDirty(v) {
  dirty = !!v;
  const mark = $('tab-dirty');
  if (mark) mark.hidden = !dirty;
}

function updateGutter() {
  const gutter = $('gutter');
  if (!gutter || !editor) return;
  const n = Math.max(1, editor.value.split('\n').length);
  let s = '';
  for (let i = 1; i <= n; i++) s += i + '\n';
  gutter.textContent = s;
}

function updateCursorStatus() {
  const el = $('status-cursor');
  if (!el || !editor) return;
  const pos = editor.selectionStart || 0;
  const upto = editor.value.slice(0, pos);
  const lines = upto.split('\n');
  el.textContent = `Ln ${lines.length}, Col ${lines[lines.length - 1].length + 1}`;
}

editor.addEventListener('input', () => {
  setDirty(true);
  updateGutter();
  updateCursorStatus();
});
editor.addEventListener('click', updateCursorStatus);
editor.addEventListener('keyup', updateCursorStatus);
editor.addEventListener('scroll', () => {
  const gutter = $('gutter');
  if (gutter) gutter.scrollTop = editor.scrollTop;
});
editor.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab' || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  const start = editor.selectionStart;
  editor.setRangeText('  ', start, editor.selectionEnd, 'end');
  setDirty(true);
  updateGutter();
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
  document.querySelectorAll('.window-title').forEach((title) => {
    title.textContent = `NodeBrowser — ${path}`;
  });
  const tabIcon = $('tab-icon') || document.querySelector('.tab-icon');
  if (tabIcon) {
    const b = tabBadge(path);
    tabIcon.textContent = b.text;
    tabIcon.className = 'tab-icon ' + b.cls;
  }
  const lang = $('status-lang');
  if (lang) lang.textContent = langFromPath(path);
  updateGutter();
  updateCursorStatus();
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

function previewAssetPath(src) {
  if (!src || /^(https?:|data:|blob:|javascript:|#)/i.test(src)) return null;
  const u = String(src).split('#')[0].split('?')[0];
  if (u.startsWith('/')) return u;
  return '/' + u.replace(/^\.\//, '');
}

async function fetchPreviewPath(port, path) {
  return bn.handleHttp({
    id: 'pv-' + Math.random().toString(36).slice(2),
    port,
    method: 'GET',
    path,
  });
}

async function replaceAsync(input, re, fn) {
  const matches = [...input.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
  if (!matches.length) return input;
  let out = '';
  let last = 0;
  for (const m of matches) {
    out += input.slice(last, m.index);
    out += await fn(m);
    last = m.index + m[0].length;
  }
  return out + input.slice(last);
}

/** iframe src=__bn_preview is often blank under COEP; srcdoc + inlined assets always paints. */
async function htmlForSimpleBrowser(port, html) {
  const cache = new Map();
  const load = async (path) => {
    const p = path.startsWith('/') ? path : '/' + path;
    if (cache.has(p)) return cache.get(p);
    const r = await fetchPreviewPath(port, p);
    cache.set(p, r);
    return r;
  };

  html = await replaceAsync(html, /<script\b([^>]*)>([\s\S]*?)<\/script>/gi, async (m) => {
    const attrs = m[1] || '';
    const srcM = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcM) return m[0];
    const path = previewAssetPath(srcM[1]);
    if (!path) return m[0];
    const r = await load(path);
    if (r.status >= 400 || r.body == null) return m[0];
    const rest = attrs.replace(/\s*src=["'][^"']+["']/i, '').replace(/\s*type=["']module["']/i, '');
    return `<script${rest}>\n${r.body}\n</script>`;
  });

  html = await replaceAsync(html, /<link\b[^>]*>/gi, async (m) => {
    const tag = m[0];
    if (!/rel=["']?stylesheet["']?/i.test(tag) && !/\.css/i.test(tag)) return tag;
    const hrefM = tag.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefM) return tag;
    const path = previewAssetPath(hrefM[1]);
    if (!path) return tag;
    const r = await load(path);
    if (r.status >= 400) return tag;
    return `<style>\n${r.body || ''}\n</style>`;
  });

  html = await replaceAsync(html, /\bsrc=["']([^"']+)["']/gi, async (m) => {
    const path = previewAssetPath(m[1]);
    if (!path || /\.(js|mjs)(\?|$)/i.test(path)) return m[0];
    const r = await load(path);
    if (r.status >= 400 || r.body == null) return m[0];
    const mime = (r.headers && (r.headers['Content-Type'] || r.headers['content-type'])) || '';
    if (String(mime).includes('svg') || /\.svg$/i.test(path)) {
      return `src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.body)}"`;
    }
    return m[0];
  });

  return html;
}

function setPreviewChrome(url) {
  const hidden = $('preview-url');
  if (hidden) hidden.textContent = url || '';
  const input = $('preview-url-input');
  if (input && url) input.value = url;
  const empty = $('preview-empty');
  if (empty) empty.classList.toggle('hidden', !!(url || lastPreview.port != null));
  setPreviewVisible(true);
}

async function showPreview(port, url, opts = {}) {
  lastPreview = { port: port ?? lastPreview.port, url: url || lastPreview.url };
  setPreviewChrome(url || (port != null ? `port ${port}` : ''));
  const iframe = $('preview');
  const empty = $('preview-empty');

  if (bn && port != null) {
    try {
      const page = await fetchPreviewPath(port, '/');
      if (page.status >= 200 && page.status < 400 && page.body) {
        const html = await htmlForSimpleBrowser(port, page.body);
        iframe.removeAttribute('src');
        iframe.srcdoc = html;
        if (empty) empty.classList.add('hidden');
        appendTerm(`[preview] Simple Browser ← port ${port} (inlined)\n`);
        if (window.matchMedia('(max-width: 760px)').matches) setMobilePane('preview');
        return;
      }
      appendTerm(`[preview] handleHttp ${page.status}: ${String(page.body).slice(0, 120)}\n`);
    } catch (e) {
      appendTerm(`[preview] Simple Browser inline failed: ${e}\n`);
    }
  }

  if (url) {
    iframe.removeAttribute('srcdoc');
    iframe.src = url;
    if (empty) empty.classList.add('hidden');
    appendTerm(`[preview] iframe → ${url}\n`);
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
    const icon = fileIconEl(name, isDirectory, expanded.has(full));
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
  const previewPath = publicPath('__bn_preview').replace(/\/$/, '');
  const previewBase = publicHref('__bn_preview').replace(/\/$/, '');
  const wasmUrl = publicHref('packages/api/wasm/browsernode_kernel.js');
  // Primary path: C++ kernel via WASM (JS only if WASM fails to load)
  try {
    bn = await NodeBrowser.boot({ useWasm: true, previewBase, persist: true, wasmUrl });
  } catch (e) {
    appendTerm(String(e) + '\nWASM kernel required — npm run build:wasm\n');
    $('status').textContent = 'wasm missing';
    hideSplash();
    throw e;
  }
  await mountXterm($('term'));
  await mountXterm($('term-2'));
  appendTerm(
    `runtime=${bn.runtime}${bn.runtime === 'wasm' ? ' (C++/WASM kernel)' : ' (JS fallback — WASM unavailable)'}` +
      `${bn.worker ? ' worker=true (WASM off UI thread)' : bn.runtime === 'wasm' ? ' worker=false (same-thread WASM)' : ''}` +
      `${bn.sabStdio ? ' sab-stdio=true' : ''}\n`,
  );
  bn.attachServiceWorkerBridge(previewPath);
  await loadTailwindBrowser();
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
  bn.on('http-log', (e) => {
    const log = $('net-log');
    if (log) {
      log.textContent += `${e.method} :${e.port}${e.path} → ${e.status}\n`;
      log.scrollTop = log.scrollHeight;
    }
  });
  bn.on('server-ready', (port, url) => {
    appendTerm(`\n[server-ready] port=${port} url=${url}\n`);
    const portsEl = $('status-ports');
    if (portsEl && bn) {
      const ports = bn.ports();
      portsEl.textContent = ports.length ? 'ports ' + ports.join(',') : 'ports —';
    }
    showPreview(port, url).catch((e) => appendTerm(String(e) + '\n'));
  });
  bn.on('install-progress', (p) => {
    appendTerm(`[install] ${p.phase} ${p.name}${p.version ? '@' + p.version : ''}${p.message ? ' — ' + p.message : ''}\n`);
  });
  setEditorPath(openPath);
  setCwd(projectCwd);
  await refreshTree();
  $('status').textContent =
    bn.runtime === 'wasm'
      ? bn.worker
        ? bn.sabStdio
          ? 'ready · wasm · worker · sab'
          : 'ready · wasm · worker'
        : 'ready · wasm'
      : 'ready · js';
  const sr = $('set-runtime');
  if (sr) sr.textContent = bn.runtime;
  const sw = $('set-worker');
  if (sw) sw.textContent = bn.worker ? 'on' : 'off';
  const ss = $('set-sab');
  if (ss) ss.textContent = bn.sabStdio ? 'on' : 'off';
  const sp = $('set-persist');
  if (sp) sp.textContent = bn.persistEnabled ? 'OPFS /home' : 'off';
  appendTerm('NodeBrowser ready — VFS file manager + in-tab install/run.\n');
  appendTerm('Drop a ZIP or a project folder — it replaces /home/project and opens preview.\n');
  appendTerm('Type a command below (runs as sh -c in the C++/WASM kernel).\n');
  hideSplash();
  const termInput = $('term-input');
  if (termInput) {
    termInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const line = termInput.value.trim();
      if (!line) return;
      termInput.value = '';
      runShellLine(line).catch((err) => appendTerm(String(err) + '\n'));
    });
  }
}

async function runShellLine(line) {
  if (!bn) return;
  const cwd = projectCwd || '/home/project';
  appendTerm(`$ ${line}\n`);
  const proc = await bn.spawn('sh', ['-c', line], { cwd });
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
  getTerm('term')?.clear();
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
  clearTerm('term');
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
  clearTerm('term');
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

async function loadTailwindBrowser() {
  if (!bn) return;
  try {
    const res = await fetch(publicHref('vendor/tailwind-browser.js'), { cache: 'force-cache' });
    if (!res.ok) return;
    const text = await res.text();
    await bn.fs.mkdir('/usr/share/nodebrowser', { recursive: true });
    await bn.fs.writeFile('/usr/share/nodebrowser/tailwind-browser.js', text);
  } catch {
    /* preview still works; utilities may be missing */
  }
}

async function loadApps() {
  return import('./apps.js');
}

async function viteLoad() {
  if (!bn) return;
  const { loadVite } = await loadApps();
  clearTerm('term');
  await loadVite(bn, appendTerm);
  await openBestProjectFile('/home/project');
  expandProjectTree('/home/project');
  selectedPath = '/home/project';
  setCwd('/home/project');
  await refreshTree();
}

async function vitePreview() {
  if (!bn) return;
  const { viteStaticPreview } = await loadApps();
  clearTerm('term');
  const { url, port } = await viteStaticPreview(bn, appendTerm);
  await showPreview(port, url, { preferUrl: true });
  await refreshTree();
}

async function nextLoad() {
  if (!bn) return;
  const { loadNext } = await loadApps();
  clearTerm('term');
  await loadNext(bn, appendTerm);
  await openBestProjectFile('/home/project');
  expandProjectTree('/home/project');
  selectedPath = '/home/project';
  setCwd('/home/project');
  await refreshTree();
}

async function nextPreview() {
  if (!bn) return;
  const { nextStaticPreview } = await loadApps();
  clearTerm('term');
  const { url, port } = await nextStaticPreview(bn, appendTerm);
  await showPreview(port, url, { preferUrl: true });
  await refreshTree();
}

function sanitizeStem(name) {
  const base = String(name || 'upload').replace(/\.(zip|tgz|tar\.gz)$/i, '');
  const stem = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'upload';
  return stem.slice(0, 64);
}

const OPEN_CANDIDATES = [
  '/src/app/page.tsx',
  '/src/app/page.jsx',
  '/src/app/page.ts',
  '/src/app/page.js',
  '/app/page.tsx',
  '/app/page.jsx',
  '/app/page.ts',
  '/app/page.js',
  '/src/pages/index.tsx',
  '/src/pages/index.jsx',
  '/pages/index.tsx',
  '/pages/index.js',
  '/src/main.tsx',
  '/src/main.jsx',
  '/index.html',
  '/package.json',
];

async function openBestProjectFile(root) {
  if (!bn) return;
  for (const rel of OPEN_CANDIDATES) {
    const p = root + rel;
    try {
      const text = await bn.fs.readFile(p, 'utf8');
      editor.value = text;
      setEditorPath(p);
      setDirty(false);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

function expandProjectTree(root) {
  const parts = root.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc += '/' + part;
    expanded.add(acc);
  }
  expanded.add(root + '/src');
  expanded.add(root + '/src/app');
  expanded.add(root + '/app');
  expanded.add(root + '/pages');
}

const SKIP_UPLOAD = new Set(['node_modules', '.git', 'dist', '.next', '.turbo', 'coverage', '.ds_store', '__macosx']);

async function flattenIntoHomeProject(dest = '/home/project') {
  const root = await bn.resolveProjectRoot(dest);
  if (root === '/home/project') return '/home/project';
  await bn.fs.mkdir('/tmp', { recursive: true });
  try {
    await bn.fs.rm('/tmp/incoming-project', { recursive: true });
  } catch {
    /* */
  }
  await bn.fs.rename(root, '/tmp/incoming-project');
  await bn.fs.rm('/home/project', { recursive: true });
  await bn.fs.rename('/tmp/incoming-project', '/home/project');
  return '/home/project';
}

async function activateWorkspaceAndPreview(label) {
  const root = await flattenIntoHomeProject('/home/project');
  expandProjectTree(root);
  selectedPath = root;
  setCwd(root);
  await openBestProjectFile(root);
  await refreshTree();
  appendTerm('starting in-tab preview …\n');
  $('status').textContent = 'preview…';
  try {
    const result = await bn.previewProject(root);
    setCwd(result.root || root);
    expandProjectTree(result.root || root);
    appendTerm(`[${result.kind}] ${result.message}${result.url ? ' → ' + result.url : ''}\n`);
    if (result.port != null && result.url) {
      await showPreview(result.port, result.url, { preferUrl: true });
      toast(`${result.kind} preview ready`, 'ok');
      $('status').textContent = result.kind + ' preview';
    } else {
      toast(result.message, result.kind === 'unknown' ? 'info' : 'ok');
      $('status').textContent = result.kind;
    }
    await refreshTree();
  } catch (err) {
    const msg = String(err?.message || err);
    appendTerm('preview failed: ' + msg + '\n');
    toast(msg, 'err');
    $('status').textContent = 'preview failed';
    throw err;
  }
}

async function ingestArchiveBytes(bytes, label) {
  if (!bn) return;
  appendTerm(`replace workspace with ${label} …\n`);
  $('status').textContent = 'unpacking…';
  toast('Loading project…', 'info');
  await bn.clearWorkspace();
  const { files } = await bn.importZip(bytes, '/home/project');
  appendTerm(`unpacked ${files} files → /home/project\n`);
  await activateWorkspaceAndPreview(label);
}

async function ingestArchiveFile(file) {
  const ab = new Uint8Array(await file.arrayBuffer());
  await ingestArchiveBytes(ab, file.name);
}

function shouldSkipUploadPath(rel) {
  return rel.split('/').some((p) => SKIP_UPLOAD.has(p.toLowerCase()));
}

function stripSharedRoot(paths) {
  if (paths.length === 0) return paths;
  const first = paths[0].split('/');
  if (first.length < 2) return paths;
  const top = first[0];
  if (paths.every((p) => p === top || p.startsWith(top + '/'))) {
    return paths.map((p) => (p === top ? '' : p.slice(top.length + 1)));
  }
  return paths;
}

async function ingestLooseFiles(entries) {
  if (!bn) return;
  const usable = entries.filter((e) => e.path && !shouldSkipUploadPath(e.path));
  if (!usable.length) throw new Error('folder is empty');
  const stripped = stripSharedRoot(usable.map((e) => e.path));
  appendTerm(`replace workspace with folder (${usable.length} files) …\n`);
  $('status').textContent = 'copying…';
  toast('Loading folder…', 'info');
  await bn.clearWorkspace();
  for (let i = 0; i < usable.length; i++) {
    const rel = stripped[i] || usable[i].path.split('/').slice(1).join('/');
    if (!rel) continue;
    const dest = `/home/project/${rel}`.replace(/\/+/g, '/');
    const dir = dest.slice(0, dest.lastIndexOf('/'));
    if (dir && dir !== '/') await bn.fs.mkdir(dir, { recursive: true });
    const buf = new Uint8Array(await usable[i].file.arrayBuffer());
    await bn.fs.writeFile(dest, buf);
  }
  await activateWorkspaceAndPreview('folder');
}

function openZipPicker() {
  $('zip-file')?.click();
}

function openFolderPicker() {
  $('folder-pick')?.click();
}

async function walkDirectoryEntry(entry, prefix, out) {
  if (SKIP_UPLOAD.has(entry.name.toLowerCase())) return;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    out.push({ path: prefix ? `${prefix}/${entry.name}` : entry.name, file });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = entry.createReader();
  const kids = [];
  for (;;) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    kids.push(...batch);
  }
  const next = prefix ? `${prefix}/${entry.name}` : entry.name;
  for (const child of kids) await walkDirectoryEntry(child, next, out);
}

async function runCurrentProject() {
  if (!bn) return;
  const guess =
    selectedPath && !/\.[a-z0-9]+$/i.test(selectedPath.split('/').pop() || '')
      ? selectedPath
      : projectCwd || '/home/project';
  const cwd = await bn.resolveProjectRoot(guess);
  appendTerm(`previewProject ${cwd} …\n`);
  $('status').textContent = 'preview…';
  try {
    const result = await bn.previewProject(cwd);
    setCwd(result.root || cwd);
    appendTerm(`[${result.kind}] ${result.message}${result.url ? ' → ' + result.url : ''}\n`);
    if (result.port != null && result.url) {
      await showPreview(result.port, result.url, { preferUrl: true });
      toast(`${result.kind} preview ready`, 'ok');
    }
    $('status').textContent = result.kind + (result.url ? ' preview' : '');
  } catch (err) {
    const msg = String(err?.message || err);
    appendTerm('preview failed: ' + msg + '\n');
    toast(msg, 'err');
    $('status').textContent = 'preview failed';
    throw err;
  }
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
$('btn-express-load')?.addEventListener('click', () => {
  (async () => {
    if (!bn) return;
    const { loadExpress } = await loadApps();
    await loadExpress(bn, appendTerm);
    await refreshTree();
  })().catch((e) => appendTerm(String(e) + '\n'));
});

$('activity-search')?.addEventListener('click', () => setSidebarView('search'));

$('fs-search')?.addEventListener('input', () => {
  searchFiles($('fs-search').value).catch((e) => appendTerm(String(e) + '\n'));
});

async function searchFiles(q) {
  const box = $('search-results');
  if (!box || !bn) return;
  box.textContent = '';
  const needle = String(q || '').toLowerCase();
  if (needle.length < 2) return;
  const hits = [];
  async function walk(dir) {
    let names = [];
    try {
      names = await bn.fs.readdir(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const full = joinPath(dir, n);
      if (n.toLowerCase().includes(needle)) hits.push(full);
      try {
        if ((await bn.fs.stat(full)).isDirectory()) await walk(full);
      } catch {
        /* skip */
      }
      if (hits.length > 80) return;
    }
  }
  await walk('/');
  for (const p of hits) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tree-item';
    b.textContent = p;
    b.addEventListener('click', () => onTreeClick(p, false).catch((e) => appendTerm(String(e) + '\n')));
    box.appendChild(b);
  }
}

function setTermTab(which) {
  window.__bn_active_term = which === 2 ? 'term-2' : 'term';
  const w1 = $('term-wrap-1');
  const w2 = $('term-wrap-2');
  const log = $('net-log');
  if (w1) w1.hidden = which === 2;
  if (w2) w2.hidden = which !== 2;
  if (log) log.hidden = true;
  $('tab-term-1')?.classList.toggle('active', which === 1);
  $('tab-term-2')?.classList.toggle('active', which === 2);
  $('tab-output')?.classList.remove('active');
}

$('tab-term-1')?.addEventListener('click', () => setTermTab(1));
$('tab-term-2')?.addEventListener('click', () => setTermTab(2));
$('tab-output')?.addEventListener('click', () => {
  const w1 = $('term-wrap-1');
  const w2 = $('term-wrap-2');
  const log = $('net-log');
  if (w1) w1.hidden = true;
  if (w2) w2.hidden = true;
  if (log) log.hidden = false;
  $('tab-term-1')?.classList.remove('active');
  $('tab-term-2')?.classList.remove('active');
  $('tab-output')?.classList.add('active');
});

$('term-input-2')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const line = $('term-input-2').value.trim();
  if (!line) return;
  $('term-input-2').value = '';
  window.__bn_active_term = 'term-2';
  runShellLine(line).catch((err) => appendTerm(String(err) + '\n', 'term-2'));
});

const PALETTE = [
  ['Run File', 'F5', () => runNode()],
  ['Save', 'Ctrl+S', () => saveFile()],
  ['Install Package…', '', () => installPkg()],
  ['HTTP Demo', '', () => httpDemo()],
  ['Vite Preview', '', () => vitePreview()],
  ['Next Preview', '', () => nextPreview()],
  ['Preview Project', '', () => runCurrentProject()],
  ['Upload ZIP…', '', () => openZipPicker()],
  ['Open Folder…', '', () => openFolderPicker()],
  ['Export Snapshot', '', () => $('btn-fs-export')?.click()],
  ['New File', 'Ctrl+N', () => newFile()],
  ['Toggle Terminal', 'Ctrl+J', () => togglePanel()],
  ['Command Palette', 'Ctrl+K', () => openPalette()],
];

function openPalette() {
  const d = $('palette');
  const list = $('palette-list');
  const input = $('palette-input');
  if (!d || !list) return;
  list.textContent = '';
  for (const [label, keys, fn] of PALETTE) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'palette-item';
    b.appendChild(document.createTextNode(label));
    if (keys) {
      const kbd = document.createElement('kbd');
      kbd.textContent = keys;
      b.appendChild(kbd);
    }
    b.addEventListener('click', () => {
      d.close();
      Promise.resolve(fn()).catch((e) => appendTerm(String(e) + '\n'));
    });
    list.appendChild(b);
  }
  d.showModal();
  input.value = '';
  input.focus();
  input.oninput = () => {
    const q = input.value.toLowerCase();
    list.querySelectorAll('.palette-item').forEach((item) => {
      item.hidden = q.length > 0 && !item.textContent.toLowerCase().includes(q);
    });
  };
}

function closeMenus() {
  document.querySelectorAll('.menu-dropdown').forEach((el) => {
    el.hidden = true;
  });
  document.querySelectorAll('.menu-item.open').forEach((el) => el.classList.remove('open'));
}

function setSidebarView(name) {
  const wb = $('workbench');
  if (!wb) return;
  wb.classList.remove('sidebar-hidden');
  wb.dataset.sidebar = name;
  ['explorer', 'search', 'run', 'extensions', 'settings'].forEach((v) => {
    const panel = $('view-' + v);
    if (panel) panel.hidden = v !== name;
  });
  document.querySelectorAll('.activity-btn[data-view]').forEach((btn) => {
    if (btn.dataset.view === 'preview') return;
    btn.classList.toggle('active', btn.dataset.view === name);
  });
  if (name === 'search') $('fs-search')?.focus();
  if (name === 'files' || name === 'explorer') setMobilePane('files');
}

function togglePanel() {
  const wb = $('workbench');
  if (!wb) return;
  wb.classList.toggle('panel-hidden');
  requestAnimationFrame(() => fitAllTerms());
}

function toggleSidebar() {
  const wb = $('workbench');
  if (!wb) return;
  wb.classList.toggle('sidebar-hidden');
  document.querySelectorAll('.activity-btn[data-view="explorer"]').forEach((btn) => {
    btn.classList.toggle('active', !wb.classList.contains('sidebar-hidden') && wb.dataset.sidebar === 'explorer');
  });
}

function runCmd(cmd) {
  const map = {
    newfile: () => newFile(),
    newdir: () => newDir(),
    save: () => saveFile(),
    zip: () => openZipPicker(),
    folder: () => openFolderPicker(),
    export: () => $('btn-fs-export')?.click(),
    clear: () => $('btn-fs-clear')?.click(),
    palette: () => openPalette(),
    'view-explorer': () => setSidebarView('explorer'),
    'view-search': () => setSidebarView('search'),
    'view-run': () => setSidebarView('run'),
    'toggle-preview': () => {
      const wb = $('workbench');
      setPreviewVisible(wb.classList.contains('preview-hidden'));
    },
    'toggle-sidebar': () => toggleSidebar(),
    'toggle-panel': () => togglePanel(),
    run: () => runNode(),
    install: () => installPkg(),
    http: () => httpDemo(),
    bundle: () => bundleDemo(),
    'preview-project': () => runCurrentProject(),
    'focus-term': () => {
      $('workbench')?.classList.remove('panel-hidden');
      setTermTab(1);
      $('term-input')?.focus();
    },
    'clear-term': () => clearTerm(),
    'term-2': () => {
      $('workbench')?.classList.remove('panel-hidden');
      setTermTab(2);
      $('term-input-2')?.focus();
    },
  };
  const fn = map[cmd];
  if (fn) Promise.resolve(fn()).catch((e) => appendTerm(String(e) + '\n'));
}

$('btn-palette')?.addEventListener('click', () => openPalette());
$('btn-command-center')?.addEventListener('click', () => openPalette());
$('btn-term-clear')?.addEventListener('click', () => clearTerm());
$('btn-layout-sidebar')?.addEventListener('click', () => toggleSidebar());
$('btn-layout-panel')?.addEventListener('click', () => togglePanel());
$('btn-layout-preview')?.addEventListener('click', () => {
  const wb = $('workbench');
  setPreviewVisible(wb.classList.contains('preview-hidden'));
});

document.querySelectorAll('.menu-item[data-menu]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = 'menu-' + btn.dataset.menu;
    const dd = $(id);
    const open = dd && !dd.hidden;
    closeMenus();
    if (dd && !open) {
      dd.hidden = false;
      btn.classList.add('open');
    }
  });
});
document.querySelectorAll('.menu-cmd[data-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => {
    closeMenus();
    runCmd(btn.dataset.cmd);
  });
});
document.addEventListener('click', () => closeMenus());

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openPalette();
    return;
  }
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveFile().catch((err) => appendTerm(String(err) + '\n'));
    return;
  }
  if (mod && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    newFile().catch((err) => appendTerm(String(err) + '\n'));
    return;
  }
  if (mod && e.key === '`') {
    e.preventDefault();
    runCmd('focus-term');
    return;
  }
  if (mod && e.key.toLowerCase() === 'j') {
    e.preventDefault();
    togglePanel();
    return;
  }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    setSidebarView('explorer');
    return;
  }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    setSidebarView('search');
    return;
  }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    setSidebarView('run');
    return;
  }
  if (e.key === 'F5') {
    e.preventDefault();
    runNode().catch((err) => appendTerm(String(err) + '\n'));
  }
});
$('btn-zip-upload')?.addEventListener('click', () => openZipPicker());
$('btn-folder-open')?.addEventListener('click', () => openFolderPicker());
$('btn-fs-import')?.addEventListener('click', () => openZipPicker());
$('btn-zip-run')?.addEventListener('click', () => runCurrentProject().catch((e) => appendTerm(String(e) + '\n')));
$('zip-file')?.addEventListener('change', (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  ingestArchiveFile(files[0]).catch((err) => appendTerm(String(err) + '\n'));
});
$('folder-pick')?.addEventListener('change', (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = '';
  if (!files.length) return;
  const entries = files.map((file) => ({
    path: file.webkitRelativePath || file.name,
    file,
  }));
  ingestLooseFiles(entries).catch((err) => appendTerm(String(err) + '\n'));
});

{
  const wb = $('workbench');
  const onDrag = (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    wb.classList.add('drop-target');
  };
  wb?.addEventListener('dragenter', onDrag);
  wb?.addEventListener('dragover', onDrag);
  wb?.addEventListener('dragleave', (e) => {
    if (e.target === wb) wb.classList.remove('drop-target');
  });
  wb?.addEventListener('drop', (e) => {
    e.preventDefault();
    wb.classList.remove('drop-target');
    const items = [...(e.dataTransfer.items || [])];
    const entries = [];
    const walk = (async () => {
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry) await walkDirectoryEntry(entry, '', entries);
      }
      if (entries.length > 1 || (entries[0] && entries[0].file?.webkitRelativePath)) {
        await ingestLooseFiles(entries);
        return;
      }
      if (entries.length === 1 && /\.(zip|tgz|tar\.gz)$/i.test(entries[0].path)) {
        await ingestArchiveFile(entries[0].file);
        return;
      }
      if (entries.length === 1) {
        await ingestLooseFiles(entries);
        return;
      }
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) await ingestArchiveFile(file);
    })();
    walk.catch((err) => appendTerm(String(err) + '\n'));
  });
}

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
    if (!wb.classList.contains('sidebar-hidden') && wb.dataset.sidebar === 'explorer') {
      toggleSidebar();
      return;
    }
    setSidebarView('explorer');
  });
});

$('activity-preview')?.addEventListener('click', () => {
  const wb = $('workbench');
  if (!wb) return;
  setPreviewVisible(wb.classList.contains('preview-hidden'));
});

$('activity-run')?.addEventListener('click', () => setSidebarView('run'));
$('activity-extensions')?.addEventListener('click', () => setSidebarView('extensions'));
$('activity-settings')?.addEventListener('click', () => setSidebarView('settings'));

$('btn-preview-close')?.addEventListener('click', () => setPreviewVisible(false));

$('btn-preview-reload')?.addEventListener('click', () => {
  if (lastPreview.port != null) {
    showPreview(lastPreview.port, lastPreview.url).catch((e) => appendTerm(String(e) + '\n'));
    return;
  }
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
    fitAllTerms();
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
    const reg = await navigator.serviceWorker.register(publicPath('sw.js'), {
      updateViaCache: 'none',
      scope: publicBase(),
    });
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
    hideSplash();
  });
