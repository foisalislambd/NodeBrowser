#!/usr/bin/env node
/**
 * Publish packages/api to GitHub Packages.
 * GitHub requires the npm scope to equal the repository owner, so we temporarily
 * rename @foisal/nodebrowser → @$OWNER/nodebrowser for this publish only.
 *
 * Env:
 *   GITHUB_REPOSITORY_OWNER or OWNER  — GitHub user/org (required)
 *   NODE_AUTH_TOKEN                   — GITHUB_TOKEN (required)
 *   VERSION                           — optional; keeps package version
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const apiPkgPath = join(root, 'packages/api/package.json');
const owner = process.env.OWNER || process.env.GITHUB_REPOSITORY_OWNER;
const token = process.env.NODE_AUTH_TOKEN || process.env.GITHUB_TOKEN;

if (!owner) {
  console.error('OWNER / GITHUB_REPOSITORY_OWNER is required');
  process.exit(1);
}
if (!token) {
  console.error('NODE_AUTH_TOKEN is required');
  process.exit(1);
}

const original = readFileSync(apiPkgPath, 'utf8');
const pkg = JSON.parse(original);
const ghName = `@${owner}/nodebrowser`;
const version = process.env.VERSION || pkg.version;

pkg.name = ghName;
pkg.version = version;
pkg.publishConfig = {
  access: 'public',
  registry: 'https://npm.pkg.github.com',
};

writeFileSync(apiPkgPath, JSON.stringify(pkg, null, 2) + '\n');

const npmrcDir = mkdtempSync(join(tmpdir(), 'nb-gh-npmrc-'));
const npmrc = join(npmrcDir, '.npmrc');
writeFileSync(
  npmrc,
  [
    `@${owner}:registry=https://npm.pkg.github.com`,
    `//npm.pkg.github.com/:_authToken=${token}`,
    '',
  ].join('\n'),
);

try {
  console.log(`Publishing ${ghName}@${version} → https://npm.pkg.github.com`);
  execSync('npm publish --access public --registry https://npm.pkg.github.com', {
    cwd: join(root, 'packages/api'),
    stdio: 'pipe',
    env: {
      ...process.env,
      NPM_CONFIG_USERCONFIG: npmrc,
      NODE_AUTH_TOKEN: token,
    },
  });
  console.log('GitHub Packages publish OK');
} catch (err) {
  const msg = `${err.stderr?.toString?.() || ''}\n${err.stdout?.toString?.() || ''}\n${err.message || ''}`;
  if (/EPUBLISHCONFLICT|cannot publish over|already exists|409/i.test(msg)) {
    console.log(`GitHub Packages already has ${ghName}@${version} — skip`);
  } else {
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    throw err;
  }
} finally {
  writeFileSync(apiPkgPath, original);
  rmSync(npmrcDir, { recursive: true, force: true });
}
