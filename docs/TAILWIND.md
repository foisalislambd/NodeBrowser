# Tailwind CSS in NodeBrowser

There is **no second Tailwind product**. You install the same npm packages as on a PC and type the same CLI. Native `lightningcss` / `@tailwindcss/oxide` cannot run in WASM; utilities are applied in **Simple Browser** with official `@tailwindcss/browser`.

User-facing steps: [GUIDE.md](./GUIDE.md). API: `bn.compileTailwind` in [API.md](./API.md).

## Install (like a PC)

```bash
npm install tailwindcss @tailwindcss/browser
```

Demo: Run and Debug → **Install Tailwind CSS**. Files go to `/home/project/node_modules`.

Oxide/linux binaries are **skipped** on purpose ([NPM.md](./NPM.md)).

## Compile (same CLI shape)

```bash
npx tailwindcss -i ./src/input.css -o ./dist/output.css
```

Also: `npx -y tailwindcss@4 …`, `tailwindcss -i …`, or:

```ts
await bn.compileTailwind('/home/project', ['-i', './src/input.css', '-o', './dist/output.css']);
```

If `-i` is omitted, the host looks for `src/input.css`, `src/index.css`, `input.css`, `app.css`, `styles.css`, `src/style.css`, and creates `src/input.css` when needed. Paths with `./` are normalized.

`sh -c` with `&&` / `|` / `;` is **not** intercepted — use a single `npx tailwindcss …` line.

## What actually happens

1. Host intercepts `tailwindcss` / `npx tailwindcss` (not the Rust CLI).
2. Installs `tailwindcss` + `@tailwindcss/browser` into the VFS if missing.
3. Copies `node_modules/@tailwindcss/browser/dist/index.global.js` to `/usr/share/nodebrowser/tailwind-browser.js` (IIFE only — ESM `index.js` is not used, so preview `<script>` stays valid). The demo also vendors a copy for first paint.
4. Writes `-o` as your CSS **minus** `@import "tailwindcss"` plus a short header. This is **not** a full pre-generated utility dump.
5. Preview HTML injects `<style type="text/tailwindcss">` + the browser compiler so `flex` / `pt-4` / … work in the iframe.

The **demo workbench’s own** CSS uses `@tailwindcss/vite` in `demo/`. That only styles VS Code chrome. Guest apps do not use that pipeline.

## Demo buttons

| UI | Command |
|----|---------|
| Install Tailwind CSS | `npm install tailwindcss @tailwindcss/browser` |
| Compile Tailwind | `npx tailwindcss -i ./src/input.css -o ./dist/output.css` |
