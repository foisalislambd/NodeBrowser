import { fileURLToPath } from 'node:url';
import { build } from 'vite';

/** Thin wrapper so `node demo/build.mjs` still runs the Vite + vite-basepath build. */
await build({ configFile: fileURLToPath(new URL('./vite.config.js', import.meta.url)) });
