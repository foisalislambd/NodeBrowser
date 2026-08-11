/**
 * In-browser bundle helper using esbuild-wasm (Vite-ready path, phase 11).
 * Does not run full Vite — transforms an entry graph from the VFS into /dist.
 */

export type BundleOptions = {
  entry: string;
  outfile?: string;
  format?: 'esm' | 'cjs' | 'iife';
};

type FsLike = {
  readFile: (path: string, encoding?: 'utf8') => Promise<string>;
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
        typeof location !== 'undefined'
          ? `${location.origin}/node_modules/esbuild-wasm/esbuild.wasm`
          : 'https://unpkg.com/esbuild-wasm@0.25.0/esbuild.wasm';
      await esbuildApi.initialize({
        wasmURL: wasmURL || defaultWasm,
        worker: false,
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
    platform: 'browser',
    logLevel: 'silent',
    plugins: [
      {
        name: 'browsernode-vfs',
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === 'entry-point') {
              return { path: args.path, namespace: 'bnvfs' };
            }
            if (args.path.startsWith('./') || args.path.startsWith('../') || args.path.startsWith('/')) {
              const base = args.resolveDir || dirname(args.importer || entry);
              const resolved = normalize(join(base, args.path));
              return { path: resolved, namespace: 'bnvfs' };
            }
            // bare imports — try node_modules under entry root
            const root = dirname(entry);
            return { path: join(join(root, 'node_modules'), args.path), namespace: 'bnvfs' };
          });

          build.onLoad({ filter: /.*/, namespace: 'bnvfs' }, async (args) => {
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
                text = await fs.readFile(c, 'utf8');
                pathUsed = c;
                break;
              } catch {
                /* try next */
              }
            }
            if (text == null) throw new Error(`bnvfs ENOENT: ${args.path}`);
            const loader = pathUsed.endsWith('.ts')
              ? 'ts'
              : pathUsed.endsWith('.tsx')
                ? 'tsx'
                : pathUsed.endsWith('.jsx')
                  ? 'jsx'
                  : 'js';
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
