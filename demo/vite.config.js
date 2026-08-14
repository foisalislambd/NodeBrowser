import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createReadStream } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import viteBasepath from 'vite-basepath';
import tailwindcss from '@tailwindcss/vite';

const demoRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(demoRoot, '..');

const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '.turbo', 'coverage']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function walkFiles(dir, base = dir, files = []) {
  if (!existsSync(dir)) return files;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, base, files);
    else files.push(relative(base, p).split('\\').join('/'));
  }
  return files;
}

function copyFiltered(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (SKIP.has(name)) continue;
    const from = join(src, name);
    const to = join(dest, name);
    const st = statSync(from);
    if (st.isDirectory()) copyFiltered(from, to);
    else {
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
    }
  }
}

function copyDir(src, dest) {
  if (!existsSync(src)) throw new Error(`Missing required path: ${src}`);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

function copyKernelAssets(outDir) {
  const apiPkg = join(repoRoot, 'packages', 'api');
  copyDir(join(apiPkg, 'dist'), join(outDir, 'packages', 'api', 'dist'));
  copyDir(join(apiPkg, 'wasm'), join(outDir, 'packages', 'api', 'wasm'));

  const esbuildSrc = [
    join(repoRoot, 'node_modules', 'esbuild-wasm'),
    join(demoRoot, 'node_modules', 'esbuild-wasm'),
    join(apiPkg, 'node_modules', 'esbuild-wasm'),
  ].find((p) => existsSync(p));
  if (!esbuildSrc) throw new Error('esbuild-wasm not found — run npm install at repo root');
  copyDir(esbuildSrc, join(outDir, 'node_modules', 'esbuild-wasm'));

  const templatesRoot = join(demoRoot, 'templates');
  const outTemplates = join(outDir, 'templates');
  mkdirSync(outTemplates, { recursive: true });
  for (const name of readdirSync(templatesRoot)) {
    const src = join(templatesRoot, name);
    if (!statSync(src).isDirectory()) continue;
    copyFiltered(src, join(outTemplates, name));
    const files = walkFiles(src);
    writeFileSync(join(outTemplates, `${name}.files.json`), JSON.stringify(files, null, 2));
  }

  writeFileSync(join(outDir, '.nojekyll'), '');
  writeFileSync(
    join(outDir, 'base.json'),
    JSON.stringify({ base: './', bundler: 'vite', builtAt: new Date().toISOString() }, null, 2),
  );
}

function resolveDevFile(urlPath) {
  const path = urlPath.split('?')[0];
  const mappings = [
    ['/packages/api/wasm/', join(repoRoot, 'packages', 'api', 'wasm')],
    ['/packages/api/dist/', join(repoRoot, 'packages', 'api', 'dist')],
    ['/templates/', join(demoRoot, 'templates')],
    ['/node_modules/esbuild-wasm/', join(repoRoot, 'node_modules', 'esbuild-wasm')],
  ];
  for (const [prefix, disk] of mappings) {
    if (!path.startsWith(prefix) && path !== prefix.slice(0, -1)) continue;
    const rel = path.slice(prefix.length);
    if (prefix === '/templates/' && rel.endsWith('.files.json')) {
      const name = rel.replace(/\.files\.json$/, '');
      const src = join(demoRoot, 'templates', name);
      if (existsSync(src) && statSync(src).isDirectory()) {
        return { kind: 'json', json: JSON.stringify(walkFiles(src)) };
      }
    }
    const file = resolve(disk, rel);
    const root = resolve(disk);
    const prefixOk = file === root || file.startsWith(root + '\\') || file.startsWith(root + '/');
    if (!prefixOk) continue;
    if (existsSync(file) && statSync(file).isFile()) return { kind: 'file', file };
  }
  return null;
}

function nodebrowserAssetsPlugin() {
  return {
    name: 'nodebrowser-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || '/';
        const hit = resolveDevFile(url);
        if (!hit) return next();
        if (hit.kind === 'json') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(hit.json);
          return;
        }
        res.setHeader('Content-Type', MIME[extname(hit.file)] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(hit.file).pipe(res);
      });
    },
    closeBundle() {
      const outDir = join(demoRoot, 'dist');
      copyKernelAssets(outDir);
      console.log(`demo assets → ${outDir} (vite-basepath ./)`);
    },
  };
}

export default defineConfig({
  root: demoRoot,
  publicDir: join(demoRoot, 'public'),
  plugins: [viteBasepath(), tailwindcss(), nodebrowserAssetsPlugin()],
  resolve: {
    alias: {
      '@foisal/nodebrowser': join(repoRoot, 'packages', 'api', 'dist', 'index.js'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: ISOLATION_HEADERS,
    fs: { allow: [repoRoot] },
  },
  preview: {
    port: 5173,
    strictPort: true,
    headers: ISOLATION_HEADERS,
  },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['esbuild-wasm'],
  },
  build: {
    outDir: join(demoRoot, 'dist'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: true,
  },
});
