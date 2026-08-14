/**
 * Optional @xterm/xterm terminal (Phase 32). Falls back to a <pre>-like host if the package is missing.
 */

export type TermApi = {
  write(text: string): void;
  clear(): void;
  fit(): void;
};

type TermCtor = new (options?: object) => {
  loadAddon(addon: { fit(): void }): void;
  open(el: HTMLElement): void;
  write(text: string): void;
  clear(): void;
};

type FitCtor = new () => { fit(): void };

const terms = new Map<string, TermApi>();

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('script ' + src));
    document.head.appendChild(s);
  });
}

function preFallback(el: HTMLElement): TermApi {
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

function pickCtor(mod: unknown, name: string): FitCtor | TermCtor | null {
  if (!mod) return null;
  if (typeof mod === 'function') return mod as FitCtor;
  const rec = mod as Record<string, unknown>;
  if (typeof rec[name] === 'function') return rec[name] as FitCtor;
  const d = rec.default;
  if (typeof d === 'function') return d as FitCtor;
  if (d && typeof (d as Record<string, unknown>)[name] === 'function') {
    return (d as Record<string, unknown>)[name] as FitCtor;
  }
  return null;
}

async function loadXterm(): Promise<{ Terminal: TermCtor; FitAddon: FitCtor }> {
  try {
    const m = await import('@xterm/xterm');
    const f = await import('@xterm/addon-fit');
    const Terminal = pickCtor(m, 'Terminal') as TermCtor | null;
    const FitAddon = pickCtor(f, 'FitAddon') as FitCtor | null;
    if (typeof Terminal === 'function' && typeof FitAddon === 'function') {
      return { Terminal, FitAddon };
    }
  } catch {
    /* UMD via script tags */
  }
  await loadScript('./node_modules/@xterm/xterm/lib/xterm.js');
  await loadScript('./node_modules/@xterm/addon-fit/lib/addon-fit.js');
  const g = globalThis as unknown as Record<string, unknown>;
  const Terminal = (pickCtor(g.Terminal, 'Terminal') || pickCtor(g, 'Terminal')) as TermCtor | null;
  const FitAddon = (pickCtor(g.FitAddon, 'FitAddon') || pickCtor(g, 'FitAddon')) as FitCtor | null;
  if (typeof Terminal !== 'function' || typeof FitAddon !== 'function') {
    throw new Error('xterm UMD missing');
  }
  return { Terminal, FitAddon };
}

export async function mountXterm(el: HTMLElement | null): Promise<TermApi | null> {
  if (!el) return null;
  if (terms.has(el.id)) return terms.get(el.id) ?? null;
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
    const api: TermApi = {
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
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => api.fit()).observe(el);
    }
    requestAnimationFrame(() => api.fit());
    return api;
  } catch {
    const api = preFallback(el);
    terms.set(el.id, api);
    return api;
  }
}

export function getTerm(id: string): TermApi | null {
  return terms.get(id) || null;
}

export function fitAllTerms(): void {
  for (const api of terms.values()) api.fit?.();
}
