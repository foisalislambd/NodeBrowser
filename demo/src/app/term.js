/**
 * Optional @xterm/xterm terminal (Phase 32). Falls back to a <pre>-like host if the package is missing.
 */
const terms = new Map();

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('script ' + src));
    document.head.appendChild(s);
  });
}

function preFallback(el) {
  el.classList.add('term');
  return {
    write(text) {
      el.textContent += text;
      el.scrollTop = el.scrollHeight;
    },
    clear() {
      el.textContent = '';
    },
    fit() {},
  };
}

/** ESM named export, default, or UMD `window.FitAddon = { FitAddon: class }`. */
function pickCtor(mod, name) {
  if (!mod) return null;
  if (typeof mod === 'function') return mod;
  if (typeof mod[name] === 'function') return mod[name];
  const d = mod.default;
  if (typeof d === 'function') return d;
  if (d && typeof d[name] === 'function') return d[name];
  return null;
}

async function loadXterm() {
  try {
    const m = await import('@xterm/xterm');
    const f = await import('@xterm/addon-fit');
    const Terminal = pickCtor(m, 'Terminal');
    const FitAddon = pickCtor(f, 'FitAddon');
    if (typeof Terminal === 'function' && typeof FitAddon === 'function') {
      return { Terminal, FitAddon };
    }
  } catch {
    /* UMD via script tags */
  }
  await loadScript('./node_modules/@xterm/xterm/lib/xterm.js');
  await loadScript('./node_modules/@xterm/addon-fit/lib/addon-fit.js');
  const g = globalThis;
  const Terminal = pickCtor(g.Terminal, 'Terminal') || pickCtor(g, 'Terminal');
  const FitAddon = pickCtor(g.FitAddon, 'FitAddon') || pickCtor(g, 'FitAddon');
  if (typeof Terminal !== 'function' || typeof FitAddon !== 'function') {
    throw new Error('xterm UMD missing');
  }
  return { Terminal, FitAddon };
}

export async function mountXterm(el) {
  if (!el) return null;
  if (terms.has(el.id)) return terms.get(el.id);
  try {
    const { Terminal, FitAddon } = await loadXterm();
    const fit = new FitAddon();
    const term = new Terminal({
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      theme: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#89d185' },
      scrollback: 4000,
    });
    term.loadAddon(fit);
    term.open(el);
    try {
      fit.fit();
    } catch {
      /* layout not ready */
    }
    const api = {
      write(text) {
        term.write(String(text).replace(/\n/g, '\r\n'));
      },
      clear() {
        term.clear();
      },
      fit() {
        try {
          fit.fit();
        } catch {
          /* ignore */
        }
      },
    };
    terms.set(el.id, api);
    window.addEventListener('resize', () => api.fit());
    return api;
  } catch {
    const api = preFallback(el);
    terms.set(el.id, api);
    return api;
  }
}

export function getTerm(id) {
  return terms.get(id) || null;
}
