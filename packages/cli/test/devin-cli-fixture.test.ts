import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { score } from '../src/index.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures');
const DEVIN_CLI = path.join(FIXTURES, 'devin-cli');

const DEVIN_HOOK_AND_SKILL_CHECKS = [
  'SKL-01',
  'SKL-02',
  'SKL-04',
  'HKS-01',
  'HKS-02',
  'HKS-03',
  'HKS-04',
  'HKS-05',
] as const;

describe('devin-cli fixture', () => {
  test('detects Devin and passes skill + hook checks', () => {
    const report = score(DEVIN_CLI);
    expect(report.detectedHarnesses).toContain('devin');
    expect(report.detectedHarnesses).not.toContain('cursor');

    for (const id of DEVIN_HOOK_AND_SKILL_CHECKS) {
      const check = report.checks.find((entry) => entry.id === id);
      expect(check, `missing ${id}`).toBeDefined();
      expect(check?.passed, `${id}: ${check?.evidence}`).toBe(true);
    }
  });
});
