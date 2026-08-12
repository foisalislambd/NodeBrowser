/**
 * In-browser bundle helper using esbuild-wasm (Vite-ready path, phase 11).
 * Does not run full Vite — transforms an entry graph from the VFS into /dist.
 */

export type BundleOptions = {
  entry: string;
  outfile?: string;
  format?: 'esm' | 'cjs' | 'iife';
  /** esbuild jsx mode — default transform for Vite/Next demos */
  jsx?: 'transform' | 'preserve' | 'automatic';
  jsxFactory?: string;
  jsxFragment?: string;
  globalName?: string;
};

type FsLike = {
  readFile: (path: string, encoding?: 'utf8' | 'buffer') => Promise<string | Uint8Array>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
};

let esbuildApi: typeof import('esbuild-wasm') | null = null;
let initialized = false;

async function ensureEsbuild(wasmURL?: string): Promise<typeof import('esbuild-wasm')> {
  if (esbuildApi && initialized) return esbuildApi;
  // Bare specifier resolved via demo import map → /node_modules/esbuild-wasm
  esbuildApi = await import('esbuild-wasm');
  if (!initialized) {
    const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
    if (isBrowser) {
      const defaultWasm =
        typeof document !== 'undefined'
          ? new URL('node_modules/esbuild-wasm/esbuild.wasm', document.baseURI).href
          : typeof location !== 'undefined'
            ? `${location.origin}/node_modules/esbuild-wasm/esbuild.wasm`
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
    plugins: [
      {
        name: 'browsernode-vfs',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === 'entry-point') {
              return { path: args.path, namespace: 'bnvfs' };
            }
            const req = args.path;
            if (
              req === 'react' ||
              req === 'react-dom' ||
              req === 'react-dom/client' ||
              req === 'react/jsx-runtime' ||
              req === 'react/jsx-dev-runtime' ||
              req === 'next/image' ||
              req === 'next/link' ||
              req === 'next/navigation'
            ) {
              return { path: req, namespace: 'bnshim' };
            }
            if (req.startsWith('./') || req.startsWith('../') || req.startsWith('/')) {
              const base = args.resolveDir || dirname(args.importer || entry);
              const resolved = normalize(join(base, req));
              return { path: resolved, namespace: 'bnvfs' };
            }
            const root = dirname(entry);
            return { path: join(join(root, 'node_modules'), req), namespace: 'bnvfs' };
          });

          build.onLoad({ filter: /.*/, namespace: 'bnshim' }, (args) => {
            return { contents: shimFor(args.path), loader: 'js' };
          });

          build.onLoad({ filter: /.*/, namespace: 'bnvfs' }, async (args) => {
            if (/\.(css)$/.test(args.path)) {
              let text = '';
              try {
                text = String(await fs.readFile(args.path, 'utf8'));
              } catch {
                text = '';
              }
              if (args.path.includes('.module.')) {
                return {
                  contents: 'export default new Proxy({}, { get: function(_, k) { return k; } });',
                  loader: 'js',
                };
              }
              const js =
                'var s=document.createElement("style");s.textContent=' +
                JSON.stringify(text) +
                ';document.head.appendChild(s);export default {};';
              return { contents: js, loader: 'js' };
            }
            if (/\.(svg|png|jpe?g|gif|webp)$/i.test(args.path)) {
              return {
                contents: 'export default ' + JSON.stringify(args.path) + ';',
                loader: 'js',
              };
            }
            const candidates = [
              args.path,
              args.path + '.js',
              args.path + '.ts',
              args.path + '.tsx',
              args.path + '.jsx',
              join(args.path, 'index.js'),
              join(args.path, 'index.ts'),
            ];
            let text: string | null = null;
            let pathUsed = args.path;
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
            if (text == null) throw new Error(`bnvfs ENOENT: ${args.path}`);
            let loader: 'js' | 'jsx' | 'ts' | 'tsx' = 'js';
            if (pathUsed.endsWith('.ts')) loader = 'ts';
            else if (pathUsed.endsWith('.tsx')) loader = 'tsx';
            else if (pathUsed.endsWith('.jsx')) loader = 'jsx';
            else if (pathUsed.endsWith('.js') && /<[A-Za-z]/.test(text)) loader = 'jsx';
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
    return 'export default function Image(p){ p=p||{}; return { type:"img", props:{ src:p.src, alt:p.alt||"", width:p.width, height:p.height, className:p.className } }; }';
  }
  if (spec === 'next/link') {
    return 'export default function Link(p){ p=p||{}; return { type:"a", props:{ href:p.href||"#", children:p.children, className:p.className } }; }';
  }
  if (spec === 'next/navigation') {
    return 'export function useRouter(){ return { push:function(){}, replace:function(){}, pathname:"/" }; } export function usePathname(){ return "/"; }';
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

function normalize(path: string): string {
  const parts: string[] = [];
  for (const p of path.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  return '/' + parts.join('/');
}
