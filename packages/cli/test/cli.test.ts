import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { renderBadge, score } from '../dist/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'dist', 'cli.js');
const FIXTURES = path.join(here, '..', '..', '..', 'fixtures');

function run(args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function makeIncompleteRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-incomplete-'));
  const unreadable = path.join(root, 'unreadable');
  fs.mkdirSync(unreadable);
  if (process.platform === 'win32') {
    const denied = spawnSync('icacls', [unreadable, '/deny', '*S-1-1-0:(RD)'], { encoding: 'utf8' });
    if (denied.status !== 0) throw new Error(`Could not create unreadable fixture: ${denied.stderr}`);
  } else {
    fs.chmodSync(unreadable, 0o000);
  }
  return root;
}

function removeIncompleteRoot(root: string): void {
  const unreadable = path.join(root, 'unreadable');
  if (process.platform === 'win32') {
    spawnSync('icacls', [unreadable, '/remove:d', '*S-1-1-0'], { encoding: 'utf8' });
  } else {
    fs.chmodSync(unreadable, 0o700);
  }
  fs.rmSync(root, { recursive: true, force: true });
}

describe('cli', () => {
  test('--json emits a parseable report', () => {
    const result = run([path.join(FIXTURES, 'level-2'), '--json']);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.level.index).toBe(2);
  });

  test('--min-level gates with exit code 1', () => {
    const result = run([path.join(FIXTURES, 'level-1'), '--min-level', '3', '--quiet']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('below required L3');
  });

  test('--min-level passes when met', () => {
    const result = run([path.join(FIXTURES, 'level-4'), '--min-level', '4', '--quiet']);
    expect(result.status).toBe(0);
  });

  test.each([
    ['maturity', 'level-1', 3, 1],
    ['maturity', 'level-4', 4, 0],
    ['effective', 'level-1', 3, 1],
    ['effective', 'level-4', 4, 0],
  ] as const)('uses the %s snapshot for a complete --min-level gate', (gate, fixture, minLevel, status) => {
    const result = run([
      path.join(FIXTURES, fixture),
      '--gate',
      gate,
      '--min-level',
      String(minLevel),
      '--quiet',
    ]);
    expect(result.status).toBe(status);
  });

  test('--badge writes a valid SVG', () => {
    const badgePath = path.join(os.tmpdir(), `hs-badge-${process.pid}.svg`);
    const result = run([path.join(FIXTURES, 'level-3'), '--badge', badgePath, '--quiet']);
    expect(result.status).toBe(0);
    const svg = fs.readFileSync(badgePath, 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('Harness Score');
    expect(svg).toContain('L3');
    fs.unlinkSync(badgePath);
  });

  test('emits diagnostic JSON and exits 2 for an incomplete scan even with --min-level 0', () => {
    const root = makeIncompleteRoot();
    try {
      const result = run([root, '--json', '--quiet', '--min-level', '0']);
      expect(result.status).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.verdicts.maturity.status).toBe('incomplete');
      expect(report.verdicts.maturity.reasons[0]).toMatchObject({
        code: 'unreadable-directory',
        path: 'unreadable',
      });
      expect(result.stderr).toContain('no authoritative maturity verdict is available');
    } finally {
      removeIncompleteRoot(root);
    }
  });

  test('writes an incomplete badge instead of L0-L4 and exits 2', () => {
    const root = makeIncompleteRoot();
    const badgePath = path.join(os.tmpdir(), `hs-incomplete-badge-${process.pid}.svg`);
    try {
      const result = run([root, '--badge', badgePath, '--quiet']);
      expect(result.status).toBe(2);
      const svg = fs.readFileSync(badgePath, 'utf8');
      expect(svg).toContain('>incomplete<');
      expect(svg).not.toMatch(/>L[0-4]</);
    } finally {
      removeIncompleteRoot(root);
      fs.rmSync(badgePath, { force: true });
    }
  });

  test.each([
    ['maturity', 0, 0],
    ['maturity', 4, 1],
    ['effective', 0, 2],
  ] as const)('gate %s with --min-level L%i returns %i when only effective is incomplete', (gate, minLevel, expectedStatus) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-effective-root-'));
    const shared = makeIncompleteRoot();
    fs.writeFileSync(
      path.join(root, '.harness-score.json'),
      JSON.stringify({ extraRoots: [{ id: 'team', path: shared }], gate }),
      'utf8',
    );
    try {
      const result = run([root, '--json', '--quiet', '--min-level', String(minLevel)]);
      expect(result.status).toBe(expectedStatus);
      const report = JSON.parse(result.stdout);
      expect(report.verdicts.maturity.status).toBe('complete');
      expect(report.verdicts.effective.status).toBe('incomplete');
      expect(result.stderr).toContain('effective scan is incomplete');
      if (expectedStatus === 1) expect(result.stderr).toContain('maturity L0 is below required L4');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      removeIncompleteRoot(shared);
    }
  });

  test.each([
    'maturity',
    'effective',
  ] as const)('exits 2 with gate %s when maturity is incomplete', (gate) => {
    const root = makeIncompleteRoot();
    try {
      const result = run([root, '--json', '--quiet', '--gate', gate, '--min-level', '0']);
      expect(result.status).toBe(2);
      const report = JSON.parse(result.stdout);
      expect(report.verdicts.maturity.status).toBe('incomplete');
      expect(report.verdicts.effective.status).toBe('incomplete');
    } finally {
      removeIncompleteRoot(root);
    }
  });

  test('rejects a nonexistent directory', () => {
    const result = run([path.join(FIXTURES, 'does-not-exist')]);
    expect(result.status).toBe(2);
  });

  test('badge renderer escapes nothing unexpected', () => {
    const report = score(path.join(FIXTURES, 'level-0'));
    const svg = renderBadge(report);
    expect(svg).toContain('L0');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  test('--diff compares against a baseline report and shows the level delta', () => {
    const baselinePath = path.join(os.tmpdir(), `hs-baseline-${process.pid}.json`);
    const baseline = run([path.join(FIXTURES, 'level-2'), '--json', '--quiet']);
    fs.writeFileSync(baselinePath, baseline.stdout, 'utf8');

    const result = run([path.join(FIXTURES, 'level-4'), '--diff', baselinePath]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Compared to baseline');
    expect(result.stdout).toContain('L2 · Guided → L4 · Self-correcting (+2)');

    const jsonResult = run([path.join(FIXTURES, 'level-4'), '--diff', baselinePath, '--json', '--quiet']);
    const payload = JSON.parse(jsonResult.stdout);
    expect(payload.diff.level.delta).toBe(2);
    expect(payload.current.level.index).toBe(4);
    expect(payload.baseline.level.index).toBe(2);

    fs.unlinkSync(baselinePath);
  });

  test('--diff fails clearly on an unreadable baseline path', () => {
    const result = run([
      path.join(FIXTURES, 'level-4'),
      '--diff',
      path.join(os.tmpdir(), 'does-not-exist.json'),
    ]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--diff');
  });

  test('--diff fails clearly (not a crash) on a valid-JSON baseline that is not a Report', () => {
    const badPath = path.join(os.tmpdir(), `hs-bad-baseline-${process.pid}.json`);
    fs.writeFileSync(badPath, 'false', 'utf8');
    const result = run([path.join(FIXTURES, 'level-4'), '--diff', badPath]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('does not look like a harness-score report');
    fs.unlinkSync(badPath);
  });

  test('--diff rejects legacy incomplete baselines', () => {
    const baselinePath = path.join(os.tmpdir(), `hs-incomplete-baseline-${process.pid}.json`);
    const baseline = JSON.parse(run([path.join(FIXTURES, 'level-2'), '--json', '--quiet']).stdout);
    baseline.truncated = true;
    delete baseline.verdicts;
    fs.writeFileSync(baselinePath, JSON.stringify(baseline), 'utf8');
    try {
      const result = run([path.join(FIXTURES, 'level-4'), '--diff', baselinePath, '--quiet']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('baseline maturity report is incomplete');
    } finally {
      fs.rmSync(baselinePath, { force: true });
    }
  });

  test('--diff rejects an incomplete current scan', () => {
    const baselinePath = path.join(os.tmpdir(), `hs-complete-baseline-${process.pid}.json`);
    const root = makeIncompleteRoot();
    fs.writeFileSync(baselinePath, run([path.join(FIXTURES, 'level-2'), '--json', '--quiet']).stdout, 'utf8');
    try {
      const result = run([root, '--diff', baselinePath, '--quiet']);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('current maturity report is incomplete');
    } finally {
      removeIncompleteRoot(root);
      fs.rmSync(baselinePath, { force: true });
    }
  });
});
