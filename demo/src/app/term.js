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
  el.classList.add('term', 'plain-term');
  el.tabIndex = 0;
  el.setAttribute('role', 'textbox');
  el.setAttribute('aria-label', 'Terminal');
  const listeners = [];
  let text = '';
  const paint = () => {
    el.textContent = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    el.scrollTop = el.scrollHeight;
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      listeners.forEach((fn) => fn('\r'));
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      listeners.forEach((fn) => fn('\x7f'));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      listeners.forEach((fn) => fn('\x1b[A'));
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      listeners.forEach((fn) => fn('\x1b[B'));
      return;
    }
    if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      listeners.forEach((fn) => fn('\x03'));
      return;
    }
    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      listeners.forEach((fn) => fn('\x0c'));
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      listeners.forEach((fn) => fn(e.key));
    }
  });
  return {
    write(chunk) {
      let next = String(chunk);
      if (next.includes('\x1b[2K')) {
        const cut = text.lastIndexOf('\n');
        text = cut >= 0 ? text.slice(0, cut + 1) : '';
        next = next.replace(/\r?\x1b\[2K/g, '');
      }
      next = next.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\b \b/g, '\b');
      for (const ch of next) {
        if (ch === '\b') text = text.slice(0, -1);
        else if (ch !== '\r') text += ch;
      }
      paint();
    },
    clear() {
      text = '';
      paint();
    },
    focus() {
      el.focus();
    },
    onData(fn) {
      listeners.push(fn);
    },
    fit() {},
  };
}

/** Type commands in the terminal itself. Logs and the prompt share one screen. */
export function bindLineEditor(api, { getCwd, onSubmit, onInterrupt }) {
  let line = '';
  let history = [];
  let hist = 0;
  let locked = false;
  let prompted = false;
  let atLineStart = true;

  function raw(text) {
    const s = String(text);
    api.write(s);
    if (s.length) atLineStart = /\n$/.test(s) || /\r\n$/.test(s);
  }

  function writePrompt() {
    const cwd = String(getCwd?.() || '/').replace(/\/$/, '') || '/';
    const short = cwd.startsWith('/home/project') ? '~' + cwd.slice('/home/project'.length) : cwd;
    if (!atLineStart) raw('\r\n');
    raw(`\x1b[38;5;114m${short}\x1b[0m \x1b[38;5;111m$\x1b[0m `);
  }

  function replaceLine(next) {
    api.write('\r\x1b[2K');
    writePrompt();
    line = next;
    if (line) api.write(line);
  }

  api.onData((data) => {
    if (locked) {
      if (String(data).includes('\x03')) onInterrupt?.();
      return;
    }
    let rest = String(data);
    while (rest) {
      if (rest.startsWith('\x1b[A')) {
        if (history.length) {
          hist = Math.max(0, hist - 1);
          replaceLine(history[hist] || '');
        }
        rest = rest.slice(3);
        continue;
      }
      if (rest.startsWith('\x1b[B')) {
        hist = Math.min(history.length, hist + 1);
        replaceLine(hist >= history.length ? '' : history[hist] || '');
        rest = rest.slice(3);
        continue;
      }
      if (rest.startsWith('\x1b[C') || rest.startsWith('\x1b[D') || rest.startsWith('\x1b[3~')) {
        rest = rest.slice(rest.startsWith('\x1b[3~') ? 4 : 3);
        continue;
      }
      const ch = rest[0];
      rest = rest.slice(1);
      if (ch === '\r' || ch === '\n') {
        raw('\r\n');
        atLineStart = true;
        const cmd = line;
        line = '';
        hist = history.length;
        if (!cmd.trim()) {
          writePrompt();
          continue;
        }
        history.push(cmd);
        hist = history.length;
        locked = true;
        Promise.resolve(onSubmit(cmd)).finally(() => {
          locked = false;
          line = '';
          writePrompt();
        });
        continue;
      }
      if (ch === '\x7f' || ch === '\b') {
        if (!line) continue;
        line = line.slice(0, -1);
        api.write('\b\x1b[K');
        continue;
      }
      if (ch === '\x03') {
        api.write('^C\r\n');
        line = '';
        writePrompt();
        continue;
      }
      if (ch === '\x0c') {
        api.clear();
        writePrompt();
        if (line) api.write(line);
        continue;
      }
      if (ch < ' ' && ch !== '\t') continue;
      line += ch;
      api.write(ch);
    }
  });

  return {
    write(text) {
      const s = String(text);
      if (!locked && prompted) {
        api.write('\r\x1b[2K');
        raw(s.endsWith('\n') ? s : s + '\n');
        atLineStart = true;
        writePrompt();
        if (line) raw(line);
        return;
      }
      raw(s);
    },
    begin() {
      if (locked) return;
      api.write('\r\x1b[2K');
      locked = true;
      line = '';
      atLineStart = true;
    },
    end() {
      locked = false;
      line = '';
      writePrompt();
      prompted = true;
    },
    focus() {
      api.focus?.();
    },
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
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      theme: {
        background: '#0d0f14',
        foreground: '#d5dbe8',
        cursor: '#8aa2ff',
        cursorAccent: '#0d0f14',
        selectionBackground: '#2a3f78',
      },
      scrollback: 4000,
    });
    term.loadAddon(fit);
    el.replaceChildren();
    term.open(el);
    try {
      fit.fit();
    } catch {
      /* layout not ready */
    }
    let fitTimer = 0;
    const api = {
      write(text) {
        term.write(String(text).replace(/\n/g, '\r\n'));
      },
      clear() {
        term.reset();
      },
      focus() {
        term.focus();
      },
      onData(fn) {
        term.onData(fn);
      },
      fit() {
        clearTimeout(fitTimer);
        fitTimer = setTimeout(() => {
          try {
            fit.fit();
          } catch {
            /* layout not ready */
          }
        }, 40);
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

export function getTerm(id) {
  return terms.get(id) || null;
}

export function fitAllTerms() {
  for (const api of terms.values()) api.fit?.();
}
