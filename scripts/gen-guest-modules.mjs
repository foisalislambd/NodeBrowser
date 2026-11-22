/**
 * Windows-friendly twin of gen-guest-modules.sh.
 * Embeds kernel/embed/guest_modules.js into the C++ header.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'kernel/embed/guest_modules.js'), 'utf8').replace(/\r\n/g, '\n');
const delim = 'GUESTJS';
const out =
  '// AUTO-GENERATED from kernel/embed/guest_modules.js — do not edit\n' +
  '#pragma once\n' +
  `static const char kGuestModules[] = R"${delim}(\n` +
  src +
  `\n)${delim}";\n`;
const dest = join(root, 'kernel/src/generated_guest_modules.hpp');
writeFileSync(dest, out);
console.log('generated', dest, out.length);
