#!/usr/bin/env node
/**
 * Mirrors packages/cli/package.json's version into every release surface:
 * TOOL_VERSION in score.ts, jsr.json, package-lock.json, both GitHub Action
 * entrypoints, and the Action README input table. Run after
 * `npx changeset version` (which only bumps package.json + CHANGELOG.md) and
 * before committing a release.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = path.join(ROOT, 'packages', 'cli');

const pkgPath = path.join(CLI_DIR, 'package.json');
const scorePath = path.join(CLI_DIR, 'src', 'score.ts');
const jsrPath = path.join(CLI_DIR, 'jsr.json');
const lockPath = path.join(ROOT, 'package-lock.json');
const actionPaths = [path.join(ROOT, 'action.yml'), path.join(ROOT, 'action', 'action.yml')];
const actionReadmePath = path.join(ROOT, 'action', 'README.md');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const version = pkg.version;
if (!version) {
  console.error('packages/cli/package.json has no "version" field.');
  process.exit(1);
}

const scoreSrc = fs.readFileSync(scorePath, 'utf8');
const toolVersionRe = /export const TOOL_VERSION = '[^']+';/;
if (!toolVersionRe.test(scoreSrc)) {
  console.error("Could not find `export const TOOL_VERSION = '...';` in score.ts.");
  process.exit(1);
}
fs.writeFileSync(scorePath, scoreSrc.replace(toolVersionRe, `export const TOOL_VERSION = '${version}';`));

const jsr = JSON.parse(fs.readFileSync(jsrPath, 'utf8'));
jsr.version = version;
fs.writeFileSync(jsrPath, `${JSON.stringify(jsr, null, 2)}\n`);

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const cliLockEntry = lock.packages?.['packages/cli'];
if (!cliLockEntry) {
  console.error('Could not find packages["packages/cli"] in package-lock.json.');
  process.exit(1);
}
cliLockEntry.version = version;
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);

const actionVersionRe = /(^ {2}version:\r?\n(?: {4}.+\r?\n)+? {4}default: ')[^']+(')/m;
for (const actionPath of actionPaths) {
  const metadata = fs.readFileSync(actionPath, 'utf8');
  if (!actionVersionRe.test(metadata)) {
    console.error(`Could not find the version input default in ${path.relative(ROOT, actionPath)}.`);
    process.exit(1);
  }
  fs.writeFileSync(actionPath, metadata.replace(actionVersionRe, `$1${version}$2`));
}

const actionReadme = fs.readFileSync(actionReadmePath, 'utf8');
const actionReadmeVersionRe =
  /^(\| `version` \| `)[^`]+(` \| harness-score npm version or package spec \|)$/m;
if (!actionReadmeVersionRe.test(actionReadme)) {
  console.error(`Could not find the version input row in ${path.relative(ROOT, actionReadmePath)}.`);
  process.exit(1);
}
fs.writeFileSync(actionReadmePath, actionReadme.replace(actionReadmeVersionRe, `$1${version}$2`));

// JSON.stringify expands short arrays onto multiple lines; Biome restores the
// repository's canonical JSON formatting.
const format = spawnSync('npx', ['biome', 'format', '--write', jsrPath, lockPath], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (format.status !== 0) {
  console.error('Failed to format versioned JSON files after version sync.');
  process.exit(format.status ?? 1);
}

console.log(`Synced CLI, JSR, lockfile, GitHub Action, and Action README versions to ${version}.`);
