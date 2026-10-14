#!/usr/bin/env node
/**
 * Scan fixtures/devin-cli (or DEVIN_PROJECT_DIR) and assert Devin harness checks.
 *
 * DEVIN_PROJECT_DIR — optional absolute path to a project root; when set, the
 * scanner uses this directory instead of fixtures/devin-cli (same variable Devin
 * CLI sets at hook runtime for project-relative paths).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'packages', 'cli', 'dist', 'cli.js');
const DEFAULT_FIXTURE = path.join(ROOT, 'fixtures', 'devin-cli');

const PASSING_CHECKS = ['SKL-01', 'SKL-02', 'SKL-04', 'HKS-01', 'HKS-02', 'HKS-03', 'HKS-04', 'HKS-05'];

function main() {
  if (!fs.existsSync(CLI)) {
    console.error('CLI not built. Run: npm run build');
    process.exit(1);
  }

  const target = process.env.DEVIN_PROJECT_DIR
    ? path.resolve(process.env.DEVIN_PROJECT_DIR)
    : DEFAULT_FIXTURE;

  if (!fs.existsSync(target)) {
    console.error(`Scan target does not exist: ${target}`);
    process.exit(1);
  }

  const result = spawnSync(process.execPath, [CLI, target, '--json'], {
    encoding: 'utf8',
    cwd: ROOT,
  });

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  const report = JSON.parse(result.stdout);
  assert.ok(
    report.detectedHarnesses?.includes('devin'),
    `expected detectedHarnesses to include "devin", got ${JSON.stringify(report.detectedHarnesses)}`,
  );

  const byId = new Map(report.checks.map((check) => [check.id, check]));
  for (const id of PASSING_CHECKS) {
    const check = byId.get(id);
    assert.ok(check, `missing check ${id}`);
    assert.equal(check.passed, true, `${id} should pass: ${check.evidence}`);
  }

  console.log(`devin-harness-verify: OK (${target})`);
}

main();
