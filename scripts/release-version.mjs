#!/usr/bin/env node
/**
 * Release version comes from VERSION.md at the repo root.
 * A release is allowed only when that version is higher than the latest vX.Y.Z tag.
 *
 *   node scripts/release-version.mjs
 *   node scripts/release-version.mjs --latest 1.3.5
 *   node scripts/release-version.mjs --apply
 *
 * Prints version=, latest=, decision=release|skip
 * Writes GITHUB_OUTPUT when that env var is set.
 * --apply copies the VERSION.md number into the root and API package.json files.
 */
import { execSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const versionFile = join(root, 'VERSION.md');
const pkgPaths = [join(root, 'package.json'), join(root, 'packages/api/package.json')];

function parse(value) {
  const match = String(value).trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function format(value) {
  return `${value.major}.${value.minor}.${value.patch}`;
}

function cmp(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function readVersionFile() {
  const text = readFileSync(versionFile, 'utf8');
  for (const line of text.split('\n')) {
    const parsed = parse(line);
    if (parsed) return parsed;
  }
  return null;
}

function tryCmd(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function versionsFrom(text) {
  const found = [];
  for (const token of text.split(/\s+/)) {
    const parsed = parse(token);
    if (parsed) found.push(parsed);
  }
  return found;
}

function latestPublished(override) {
  if (override) return parse(override);
  const fromTags = versionsFrom(tryCmd('git tag -l "v*"'));
  const fromReleases = versionsFrom(tryCmd('gh release list --limit 100 --json tagName --jq ".[].tagName"'));
  let best = null;
  for (const version of [...fromTags, ...fromReleases]) {
    if (!best || cmp(version, best) > 0) best = version;
  }
  return best;
}

function applyVersion(version) {
  for (const path of pkgPaths) {
    const raw = readFileSync(path, 'utf8');
    const pkg = JSON.parse(raw);
    if (pkg.version === version) continue;
    const next = raw.replace(/("version"\s*:\s*")[^"]+(")/, `$1${version}$2`);
    writeFileSync(path, next);
  }
}

const args = process.argv.slice(2);
const latestFlag = args.indexOf('--latest');
const latestArg = latestFlag >= 0 ? args[latestFlag + 1] : '';
const fileVersion = readVersionFile();
if (!fileVersion) {
  console.error('VERSION.md must contain a standalone X.Y.Z version');
  process.exit(1);
}
if (latestFlag >= 0 && !parse(latestArg || '')) {
  console.error(`Invalid --latest ${latestArg || ''}`);
  process.exit(1);
}

const version = format(fileVersion);
const latest = latestPublished(latestArg);
const decision = !latest || cmp(fileVersion, latest) > 0 ? 'release' : 'skip';
const latestText = latest ? format(latest) : 'none';

if (args.includes('--apply') && decision === 'release') applyVersion(version);

const lines = [`version=${version}`, `latest=${latestText}`, `decision=${decision}`];
for (const line of lines) console.log(line);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
process.exit(0);
