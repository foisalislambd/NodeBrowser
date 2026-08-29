/**
 * In-browser bundle helper using esbuild-wasm (Vite-ready path, phase 11).
 * Does not run full Vite — transforms an entry graph from the VFS into /dist.
 */

export type BundleOptions = {
  entry: string;
  outfile?: string;
  format?: 'esm' | 'cjs' | 'iife';
  /** Project folder — `/src/foo` and `/vite.svg` resolve here, not VFS `/`. */
  projectRoot?: string;
  /** esbuild jsx mode — default transform for Vite/Next demos */
  jsx?: 'transform' | 'preserve' | 'automatic';
  jsxFactory?: string;
  jsxFragment?: string;
  globalName?: string;
};

type FsLike = {
  readFile: (path: string, encoding?: 'utf8' | 'buffer') => Promise<string | Uint8Array>;
  writeFile: (path: string, data: string | Uint8Array) => Promise<void>;
  mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
};

let esbuildApi: typeof import('esbuild-wasm') | null = null;
let initialized = false;

async function ensureEsbuild(wasmURL?: string): Promise<typeof import('esbuild-wasm')> {
  if (esbuildApi && initialized) return esbuildApi;
  // Bare specifier resolved via demo import map → ./node_modules/esbuild-wasm/esm/browser.js
  esbuildApi = await import('esbuild-wasm');
  if (!initialized) {
    const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
    if (isBrowser) {
      const defaultWasm =
        typeof document !== 'undefined'
          ? new URL('node_modules/esbuild-wasm/esbuild.wasm', new URL('./', document.baseURI)).href
          : typeof location !== 'undefined'
            ? new URL('node_modules/esbuild-wasm/esbuild.wasm', location.href).href
            : 'https://unpkg.com/esbuild-wasm@0.25.0/esbuild.wasm';
      await esbuildApi.initialize({
        wasmURL: wasmURL || defaultWasm,
        worker: true,
      });
    } else {
      // Node (tests / tooling): package resolves wasm itself
      await esbuildApi.initialize({ worker: false });
    }
    initialized = true;
  }
  return esbuildApi;
}

/** Bundle `entry` from VFS into `outfile` (default /dist/bundle.js). */
export async function bundleWithEsbuild(
  fs: FsLike,
  opts: BundleOptions,
): Promise<{ outfile: string; code: string }> {
  const esbuild = await ensureEsbuild();
  const outfile = opts.outfile || '/dist/bundle.js';
  const entry = opts.entry;
  const projectRoot = opts.projectRoot || guessProjectRoot(entry);

  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: opts.format || 'iife',
    globalName: opts.globalName,
    platform: 'browser',
    logLevel: 'silent',
    jsx: opts.jsx || 'automatic',
    jsxFactory: opts.jsxFactory,
    jsxFragment: opts.jsxFragment,
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.env.MODE': '"development"',
      'import.meta.env.DEV': 'true',
      'import.meta.env.PROD': 'false',
      'import.meta.env.SSR': 'false',
      'import.meta.env.BASE_URL': '"/"',
      'import.meta.hot': 'undefined',
    },
    plugins: [
      {
        name: 'browsernode-vfs',
        setup(build) {
          build.onResolve({ filter: /.*/ }, async (args) => {
            if (args.kind === 'entry-point') {
              return { path: splitQuery(args.path).bare, namespace: 'bnvfs' };
            }
            const { bare, query } = splitQuery(args.path);
            const req = bare;
            if (isShimSpec(req)) {
              return { path: req, namespace: 'bnshim' };
            }
            if (req.startsWith('@/')) {
              const rest = req.slice(2);
              const hit = await firstReadable(fs, [
                join(join(projectRoot, 'src'), rest),
                join(projectRoot, rest),
              ]);
              return { path: (hit || join(join(projectRoot, 'src'), rest)) + query, namespace: 'bnvfs' };
            }
            if (req.startsWith('/') && !req.startsWith('//')) {
              return { path: resolveAbsImport(projectRoot, req) + query, namespace: 'bnvfs' };
            }
            if (req.startsWith('./') || req.startsWith('../')) {
              const base = args.resolveDir || dirname(splitQuery(args.importer || entry).bare);
              const resolved = normalize(join(base, req));
              return { path: resolved + query, namespace: 'bnvfs' };
            }
            return { path: join(join(projectRoot, 'node_modules'), req) + query, namespace: 'bnvfs' };
          });

          build.onLoad({ filter: /.*/, namespace: 'bnshim' }, (args) => {
            return { contents: shimFor(args.path), loader: 'js' };
          });

          build.onLoad({ filter: /.*/, namespace: 'bnvfs' }, async (args) => {
            const { bare, query } = splitQuery(args.path);
            const q = query.toLowerCase();
            if (/\.(css)$/i.test(bare)) {
              const text = await loadCssGraph(fs, bare, projectRoot, new Set());
              if (q.includes('raw')) {
                return { contents: 'export default ' + JSON.stringify(text), loader: 'js' };
              }
              const inject =
                'var s=document.createElement("style");s.textContent=' +
                JSON.stringify(text) +
                ';document.head.appendChild(s);';
              if (bare.includes('.module.')) {
                return {
                  contents:
                    inject +
                    'export default new Proxy({}, { get: function(_, k) { return k; } });',
                  loader: 'js',
                };
              }
              return { contents: inject + 'export default {};', loader: 'js' };
            }
            if (q.includes('raw')) {
              let text = '';
              try {
                text = String(await fs.readFile(bare, 'utf8'));
              } catch {
                text = '';
              }
              return { contents: 'export default ' + JSON.stringify(text), loader: 'js' };
            }
            if (/\.(svg|png|jpe?g|gif|webp|ico)$/i.test(bare)) {
              return { contents: 'export default ' + JSON.stringify(await assetDataUrl(fs, bare)), loader: 'js' };
            }
            if (/\.json$/i.test(bare)) {
              let text = '{}';
              try {
                text = String(await fs.readFile(bare, 'utf8'));
              } catch {
                /* */
              }
              return { contents: text, loader: 'json' };
            }
            const candidates = [
              bare,
              bare + '.js',
              bare + '.ts',
              bare + '.tsx',
              bare + '.jsx',
              bare + '.mjs',
              bare + '.mts',
              join(bare, 'index.js'),
              join(bare, 'index.ts'),
              join(bare, 'index.tsx'),
              join(bare, 'index.jsx'),
            ];
            let text: string | null = null;
            let pathUsed = bare;
            for (const c of candidates) {
              try {
                const got = await fs.readFile(c, 'utf8');
                text = String(got);
                pathUsed = c;
                break;
              } catch {
                /* try next */
              }
            }
            if (text == null) throw new Error(`bnvfs ENOENT: ${bare}`);
            let loader: 'js' | 'jsx' | 'ts' | 'tsx' = 'js';
            if (pathUsed.endsWith('.ts') || pathUsed.endsWith('.mts')) loader = 'ts';
            else if (pathUsed.endsWith('.tsx')) loader = 'tsx';
            else if (pathUsed.endsWith('.jsx')) loader = 'jsx';
            else if ((pathUsed.endsWith('.js') || pathUsed.endsWith('.mjs')) && /<[A-Za-z]/.test(text)) loader = 'jsx';
            return { contents: text, loader, resolveDir: dirname(pathUsed) };
          });
        },
      },
    ],
  });

  const file = result.outputFiles?.[0];
  if (!file) throw new Error('esbuild produced no output');
  const code = file.text;
  await fs.mkdir(dirname(outfile), { recursive: true });
  await fs.writeFile(outfile, code);
  return { outfile, code };
}

const EMPTY_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

async function assetDataUrl(fs: FsLike, path: string): Promise<string> {
  try {
    if (/\.svg$/i.test(path)) {
      const text = String(await fs.readFile(path, 'utf8'));
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
    }
    const raw = await fs.readFile(path, 'buffer');
    const bytes = raw instanceof Uint8Array ? raw : new TextEncoder().encode(String(raw));
    const mime = /\.png$/i.test(path)
      ? 'image/png'
      : /\.jpe?g$/i.test(path)
        ? 'image/jpeg'
        : /\.webp$/i.test(path)
          ? 'image/webp'
          : /\.gif$/i.test(path)
            ? 'image/gif'
            : 'application/octet-stream';
    return `data:${mime};base64,${uint8ToB64(bytes)}`;
  } catch {
    return EMPTY_GIF;
  }
}

function uint8ToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function isShimSpec(req: string): boolean {
  return (
    req === 'react' ||
    req === 'react-dom' ||
    req === 'react-dom/client' ||
    req === 'react/jsx-runtime' ||
    req === 'react/jsx-dev-runtime' ||
    req === 'next/image' ||
    req === 'next/link' ||
    req === 'next/navigation' ||
    req === 'next/headers' ||
    req === 'next/cache' ||
    req === 'next/head' ||
    req === 'next/font' ||
    req.startsWith('next/font/') ||
    req.startsWith('geist/font') ||
    req === 'next/dynamic' ||
    req === 'next/script' ||
    req === 'vite/client' ||
    req === 'vite/preload-helper' ||
    req.startsWith('virtual:')
  );
}

async function firstReadable(fs: FsLike, bases: string[]): Promise<string | null> {
  const extras = (p: string) => [
    p,
    p + '.tsx',
    p + '.ts',
    p + '.jsx',
    p + '.js',
    join(p, 'index.tsx'),
    join(p, 'index.ts'),
    join(p, 'index.jsx'),
    join(p, 'index.js'),
  ];
  for (const base of bases) {
    for (const c of extras(base)) {
      try {
        await fs.readFile(c, 'utf8');
        return base;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

function shimFor(spec: string): string {
  if (spec === 'react/jsx-runtime' || spec === 'react/jsx-dev-runtime') {
    return [
      'export function jsx(type, props) { return { type: type, props: props || {} }; }',
      'export const jsxs = jsx;',
      'export const Fragment = "fragment";',
    ].join('\n');
  }
  if (spec === 'react-dom/client' || spec === 'react-dom') {
    return REACT_DOM_SHIM;
  }
  if (spec === 'next/image') {
    return [
      'export default function Image(p){',
      '  p=p||{};',
      '  var src=p.src||"";',
      '  if(src && typeof src==="object") src=src.src||src.default||"";',
      '  if(typeof src==="string" && src.charAt(0)==="/" && src.charAt(1)!=="/") src="."+src;',
      '  return { type:"img", props:{ src:src, alt:p.alt||"", width:p.width, height:p.height, className:p.className, style:p.style } };',
      '}',
    ].join('\n');
  }
  if (spec === 'next/link') {
    return 'export default function Link(p){ p=p||{}; return { type:"a", props:{ href:p.href||"#", children:p.children, className:p.className } }; }';
  }
  if (spec === 'next/navigation') {
    return 'export function useRouter(){ return { push:function(){}, replace:function(){}, pathname:"/" }; } export function usePathname(){ return "/"; } export function useSearchParams(){ return new URLSearchParams(); }';
  }
  if (spec === 'next/headers') {
    return 'export function headers(){ return new Headers(); } export function cookies(){ return { get:function(){}, getAll:function(){ return []; }, set:function(){} }; }';
  }
  if (spec === 'next/cache') {
    return 'export function revalidatePath(){} export function revalidateTag(){} export function unstable_cache(fn){ return fn; }';
  }
  if (spec === 'next/head') {
    return 'export default function Head(p){ return (p && p.children) || null; }';
  }
  if (spec === 'next/font' || spec.startsWith('next/font/') || spec.startsWith('geist/font')) {
    return [
      'function font(opts){ opts=opts||{}; var v=opts.variable||"--bn-font"; return { className: opts.className||"bn-font", variable: v, style: {} }; }',
      'export const Geist = font; export const Geist_Mono = font; export const Inter = font; export const Roboto = font;',
      'export const Poppins = font; export const Outfit = font; export const Open_Sans = font; export const Montserrat = font;',
      'export const Lato = font; export const Rubik = font; export const Nunito = font; export const Ubuntu = font;',
      'export function localFont(opts){ return font(opts); }',
      'export default new Proxy(function(){ return font({}); }, { get: function(_, k){ if(k==="then") return undefined; return font; } });',
    ].join('\n');
  }
  if (spec === 'next/dynamic') {
    return 'export default function dynamic(){ return function Dyn(){ return null; }; }';
  }
  if (spec === 'next/script') {
    return 'export default function Script(p){ p=p||{}; return { type:"script", props:{ src:p.src, children:p.children } }; }';
  }
  if (spec === 'vite/client' || spec === 'vite/preload-helper' || spec.startsWith('virtual:')) {
    return 'export default {};';
  }
  return REACT_SHIM;
}

const REACT_SHIM = `
var states = [];
var cursor = 0;
var rootEl = null;
var rootNode = null;
function rerender() {
  if (!rootEl || !rootNode) return;
  cursor = 0;
  rootEl.innerHTML = '';
  rootEl.appendChild(toDom(rootNode));
}
export function useState(init) {
  var i = cursor++;
  if (states.length <= i) states[i] = typeof init === 'function' ? init() : init;
  return [states[i], function(v) {
    states[i] = typeof v === 'function' ? v(states[i]) : v;
    rerender();
  }];
}
export function StrictMode(props) { return (props && props.children) || null; }
export function createElement(type, props) {
  var children = [].slice.call(arguments, 2);
  props = props ? Object.assign({}, props) : {};
  if (children.length) props.children = children.length === 1 ? children[0] : children;
  return { type: type, props: props };
}
export default { useState: useState, StrictMode: StrictMode, createElement: createElement, Fragment: "fragment" };
function flatten(c) {
  if (c == null || c === false) return [];
  if (Array.isArray(c)) return c.flatMap(flatten);
  return [c];
}
function toDom(node) {
  if (node == null || node === false) return document.createTextNode('');
  if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node));
  if (typeof node.type === 'function') {
    var out = node.type(Object.assign({}, node.props));
    return toDom(out);
  }
  if (node.type === 'fragment') {
    var f = document.createDocumentFragment();
    flatten(node.props && node.props.children).forEach(function(ch) { f.appendChild(toDom(ch)); });
    return f;
  }
  var el = document.createElement(String(node.type));
  var p = node.props || {};
  Object.keys(p).forEach(function(k) {
    if (k === 'children' || k === 'key') return;
    if (k === 'className') el.setAttribute('class', p[k]);
    else if (k.slice(0, 2) === 'on' && typeof p[k] === 'function') el.addEventListener(k.slice(2).toLowerCase(), p[k]);
    else if ((k === 'src' || k === 'href') && typeof p[k] === 'string' && p[k].charAt(0) === '/' && p[k].charAt(1) !== '/') el.setAttribute(k, '.' + p[k]);
    else if (p[k] != null && p[k] !== false) el.setAttribute(k, String(p[k]));
  });
  flatten(p.children).forEach(function(ch) { el.appendChild(toDom(ch)); });
  return el;
}
export function __bn_bind_root(el, node) { rootEl = el; rootNode = node; rerender(); }
`;

const REACT_DOM_SHIM = `
import { __bn_bind_root } from 'react';
export function createRoot(el) {
  return { render: function(node) { __bn_bind_root(el, node); } };
}
export default { createRoot: createRoot };
`;

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

function join(a: string, b: string): string {
  if (b.startsWith('/')) return normalize(b);
  if (a === '/') return normalize('/' + b);
  return normalize(a + '/' + b);
}

function joinUnder(root: string, rel: string): string {
  const stripped = rel.replace(/^\/+/, '');
  if (root === '/') return normalize('/' + stripped);
  return normalize(root + '/' + stripped);
}

/** `/src/x` is site-root; `/home/project/src/x` is already a VFS path. */
function resolveAbsImport(projectRoot: string, req: string): string {
  const n = normalize(req);
  const root = projectRoot.replace(/\/+$/, '') || '/';
  if (root === '/') return n;
  if (n === root || n.startsWith(root + '/')) return n;
  return joinUnder(root, req);
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const p of path.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return '/' + parts.join('/');
}

function splitQuery(spec: string): { bare: string; query: string } {
  const i = spec.indexOf('?');
  if (i < 0) return { bare: spec, query: '' };
  return { bare: spec.slice(0, i), query: spec.slice(i) };
}

function guessProjectRoot(entry: string): string {
  const dir = dirname(entry);
  if (dir.endsWith('/src') || dir.endsWith('/app') || dir.endsWith('/pages')) return dirname(dir);
  return dir;
}

async function loadCssGraph(fs: FsLike, path: string, projectRoot: string, seen: Set<string>): Promise<string> {
  const norm = splitQuery(path).bare;
  if (seen.has(norm)) return '';
  seen.add(norm);
  let text = '';
  try {
    text = String(await fs.readFile(norm, 'utf8'));
  } catch {
    return '';
  }
  text = text
    .replace(/@import\s+["']tailwindcss(?:\/[^"']*)?["'][^;]*;?/g, '')
    .replace(/@import\s+["']tailwindcss["'][^;]*;?/g, '');
  const re = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"](?:\s*\)\s*)?[^;]*;/g;
  const chunks: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const spec = m[1]!;
    if (/^https?:/i.test(spec) || spec.startsWith('tailwindcss')) continue;
    chunks.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    const resolved = spec.startsWith('/') ? resolveAbsImport(projectRoot, spec) : join(dirname(norm), spec);
    chunks.push(await loadCssGraph(fs, resolved, projectRoot, seen));
  }
  chunks.push(text.slice(last));
  return chunks.join('\n');
}
