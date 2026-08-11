#!/usr/bin/env node
/**
 * Version scheme: 1.0.0 → 1.0.1 → … → 1.0.9 → 1.1.0 → … → 1.9.9 → 2.0.0
 * Patch and minor each roll at 9.
 *
 * Usage:
 *   node scripts/next-version.mjs              # print next version
 *   node scripts/next-version.mjs --set        # write packages/api + root package.json
 *   node scripts/next-version.mjs --current X  # bump from explicit X
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = '@foisal/nodebrowser';
const apiPkgPath = join(root, 'packages/api/package.json');
const rootPkgPath = join(root, 'package.json');

function parse(v) {
  const m = String(v).replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function format(v) {
  return `${v.major}.${v.minor}.${v.patch}`;
}

function bump(v) {
  if (v.patch < 9) return { major: v.major, minor: v.minor, patch: v.patch + 1 };
  if (v.minor < 9) return { major: v.major, minor: v.minor + 1, patch: 0 };
  return { major: v.major + 1, minor: 0, patch: 0 };
}

function tryCmd(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function latestFromNpm() {
  return parse(tryCmd(`npm view ${PKG} version --registry https://registry.npmjs.org`));
}

function latestFromTags() {
  const out = tryCmd('git tag -l "v*" --sort=-v:refname');
  for (const line of out.split('\n')) {
    const p = parse(line.trim());
    if (p) return p;
  }
  return null;
}

function latestFromPackage() {
  return parse(JSON.parse(readFileSync(apiPkgPath, 'utf8')).version);
}

function cmp(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function maxVer(...list) {
  return list.filter(Boolean).sort(cmp).at(-1) ?? null;
}

const args = process.argv.slice(2);
const setFlag = args.includes('--set');
const curIdx = args.indexOf('--current');
const currentArg = curIdx >= 0 ? args[curIdx + 1] : null;

let next;
if (currentArg) {
  const cur = parse(currentArg);
  if (!cur) {
    console.error(`Invalid --current ${currentArg}`);
    process.exit(1);
  }
  next = bump(cur);
} else {
  const released = maxVer(latestFromNpm(), latestFromTags());
  if (!released) {
    next = latestFromPackage() || { major: 1, minor: 0, patch: 0 };
  } else if (cmp(released, { major: 1, minor: 0, patch: 0 }) < 0) {
    // Pre-1.0 publishes (e.g. 0.0.1 claim) → first public line is 1.0.0
    next = { major: 1, minor: 0, patch: 0 };
  } else {
    next = bump(released);
  }
}

const nextStr = format(next);
console.log(nextStr);

if (setFlag) {
  for (const path of [apiPkgPath, rootPkgPath]) {
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    pkg.version = nextStr;
    writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  }
}
