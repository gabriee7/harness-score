import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { createScanContext } from '../src/scan.js';
import { buildReportFromScanContext, LEVEL_REQUIREMENTS, TOOL_VERSION } from '../src/score.js';
import type { DimensionId, DimensionScore } from '../src/types.js';
import { DIMENSIONS } from '../src/types.js';
import { fakeContext } from './helpers.js';

/** A dimension override is either a bare percent (applicable defaults true) or a full shape. */
type DimOverride = number | { percent?: number; applicable?: boolean };

/** Synthetic dimension map for exercising LEVEL_REQUIREMENTS in isolation, without a full scan. */
function makeDims(overrides: Partial<Record<DimensionId, DimOverride>>): Map<DimensionId, DimensionScore> {
  return new Map(
    DIMENSIONS.map((d) => {
      const raw = overrides[d.id];
      const percent = typeof raw === 'number' ? raw : (raw?.percent ?? 0);
      const applicable = typeof raw === 'number' ? true : (raw?.applicable ?? true);
      return [d.id, { id: d.id, title: d.title, earned: 0, max: 100, percent, applicable }];
    }),
  );
}

describe('LEVEL_REQUIREMENTS boundaries', () => {
  test('L1 context requirement is exact at the 40% boundary', () => {
    const [contextReq] = LEVEL_REQUIREMENTS[0]!;
    expect(contextReq!.met(makeDims({ context: 39 }), 0)).toBe(false);
    expect(contextReq!.met(makeDims({ context: 40 }), 0)).toBe(true);
    expect(contextReq!.met(makeDims({ context: 41 }), 0)).toBe(true);
  });

  test('L2 "skills ≥30% or hooks ≥30%" requirement is a true OR', () => {
    const orReq = LEVEL_REQUIREMENTS[1]![1]!;
    expect(orReq.label).toBe('skills ≥ 30% or hooks ≥ 30%');
    expect(orReq.met(makeDims({ skills: 30, hooks: 0 }), 0)).toBe(true);
    expect(orReq.met(makeDims({ skills: 0, hooks: 30 }), 0)).toBe(true);
    expect(orReq.met(makeDims({ skills: 29, hooks: 29 }), 0)).toBe(false);
  });

  test('L4 "hooks ≥70%" requirement is exact at the boundary', () => {
    const hooksReq = LEVEL_REQUIREMENTS[3]![0]!;
    expect(hooksReq.met(makeDims({ hooks: 69 }), 0)).toBe(false);
    expect(hooksReq.met(makeDims({ hooks: 70 }), 0)).toBe(true);
  });

  test('L4 "total ≥80%" requirement reads totalPercent, ignoring the dims map', () => {
    const totalReq = LEVEL_REQUIREMENTS[3]![1]!;
    expect(totalReq.label).toBe('total ≥ 80%');
    expect(totalReq.met(makeDims({}), 79)).toBe(false);
    expect(totalReq.met(makeDims({}), 80)).toBe(true);
    expect(totalReq.met(makeDims({}), 81)).toBe(true);
  });

  test('dimAtLeast requirements carry blockedDimension for capped-level detection', () => {
    const contextReq = LEVEL_REQUIREMENTS[0]![0]!;
    const hooksReq = LEVEL_REQUIREMENTS[3]![0]!;
    expect(contextReq.blockedDimension).toBe('context');
    expect(hooksReq.blockedDimension).toBe('hooks');
    // The L2 OR-requirement and the L4 total-percent requirement aren't tied to a single
    // hard-blocking dimension, so they must never be treated as "capped-capable".
    expect(LEVEL_REQUIREMENTS[1]![1]!.blockedDimension).toBeUndefined();
    expect(LEVEL_REQUIREMENTS[3]![1]!.blockedDimension).toBeUndefined();
  });

  test('a non-applicable dimension can never satisfy dimAtLeast, even at 100%', () => {
    const hooksReq = LEVEL_REQUIREMENTS[3]![0]!;
    expect(hooksReq.met(makeDims({ hooks: { percent: 100, applicable: false } }), 0)).toBe(false);
    // Contrast: the exact same 100% is satisfied when the dimension is applicable.
    expect(hooksReq.met(makeDims({ hooks: { percent: 100, applicable: true } }), 0)).toBe(true);
  });
});

describe('computeLevel — stops at the first unmet level', () => {
  test('a context-only repo fails at L1 and reports only L1 gaps', () => {
    // Empty repo: fails L1's context requirement outright, so the loop must
    // break before ever evaluating L2/L3/L4 — gaps should be L1-only.
    const report = buildReportFromScanContext(fakeContext({}));
    expect(report.level.index).toBe(0);
    expect(report.level.nextLevelGaps).toEqual(['context ≥ 40%']);
  });
});

describe('buildReport shape', () => {
  test('carries tool version, root, and truncated straight from the context', () => {
    const ctx = fakeContext({ 'AGENTS.md': '# hi' });
    const report = buildReportFromScanContext(ctx);
    expect(report.scopes.maturity).toEqual(['repo']);
    expect(report.effective).toBeDefined();
    expect(report.tool.name).toBe('harness-score');
    expect(report.tool.version).toBe(TOOL_VERSION);
    expect(report.root).toBe(ctx.root);
    expect(report.truncated).toBe(ctx.truncated);
    expect(report.verdicts).toEqual({
      maturity: { status: 'complete', reasons: [] },
      effective: { status: 'complete', reasons: [] },
    });
  });

  test('converts a legacy truncated context to a fail-closed file-count verdict', () => {
    const ctx = { ...fakeContext({}), truncated: true };
    const report = buildReportFromScanContext(ctx);
    expect(report.truncated).toBe(true);
    expect(report.verdicts?.maturity).toEqual({
      status: 'incomplete',
      reasons: [{ code: 'file-count-limit' }],
    });
  });

  test('preserves explicit incomplete reasons even when legacy truncated is false', () => {
    const ctx = {
      ...fakeContext({}),
      truncated: false,
      incompleteReasons: [{ code: 'depth-limit' as const, path: 'a/b', limit: 10 }],
    };
    const report = buildReportFromScanContext(ctx);
    expect(report.truncated).toBe(true);
    expect(report.verdicts?.effective).toEqual({
      status: 'incomplete',
      reasons: [{ code: 'depth-limit', path: 'a/b', limit: 10 }],
    });
  });

  test('computes the verdict after checks request discovered file contents', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-score-score-'));
    const agentsPath = path.join(root, 'AGENTS.md');
    fs.writeFileSync(agentsPath, '# present during discovery');
    const ctx = createScanContext(root);
    fs.unlinkSync(agentsPath);

    try {
      const report = buildReportFromScanContext(ctx);
      expect(report.truncated).toBe(true);
      expect(report.verdicts?.maturity).toEqual({
        status: 'incomplete',
        reasons: [{ code: 'unreadable-path', path: 'AGENTS.md' }],
      });
      expect(report.verdicts?.effective).toEqual(report.verdicts?.maturity);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('keeps oversized requested files complete because the read limit is intentional', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-score-score-'));
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'a'.repeat(512 * 1024 + 1));

    try {
      const report = buildReportFromScanContext(createScanContext(root));
      expect(report.truncated).toBe(false);
      expect(report.verdicts?.maturity).toEqual({ status: 'complete', reasons: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('does not fail closed for a discovered unreadable file that no check requests', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-score-score-'));
    const unrelatedPath = path.join(root, 'unrelated.txt');
    fs.writeFileSync(unrelatedPath, 'present during discovery');
    const ctx = createScanContext(root);
    fs.unlinkSync(unrelatedPath);

    try {
      const report = buildReportFromScanContext(ctx);
      expect(report.truncated).toBe(false);
      expect(report.verdicts?.maturity).toEqual({ status: 'complete', reasons: [] });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
