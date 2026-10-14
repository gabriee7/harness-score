import { describe, expect, test } from 'vitest';
import { renderBadge } from '../src/report/badge.js';
import type { Report } from '../src/types.js';

function makeReport(levelIndex: number): Report {
  return {
    tool: { name: 'harness-score', version: '0.3.0' },
    root: '/fake',
    truncated: false,
    level: { index: levelIndex, name: 'x', nextLevelGaps: [] },
    score: { earned: 0, max: 108, percent: 0 },
    dimensions: [],
    checks: [],
  };
}

describe('renderBadge', () => {
  test.each([0, 1, 2, 3, 4])('renders L%i in the value text, aria-label and title', (level) => {
    const svg = renderBadge(makeReport(level));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`>L${level}<`);
    expect(svg).toContain(`aria-label="Harness Score L${level}"`);
    expect(svg).toContain(`<title>Harness Score: L${level}</title>`);
  });

  test('viewBox width matches the sum of the label and value segments', () => {
    const svg = renderBadge(makeReport(2));
    expect(svg).toContain('viewBox="0 0 112 20"');
    expect(svg).toContain('width="112"');
  });

  test('renders incomplete instead of L0-L4 for explicit and legacy incomplete reports', () => {
    const explicit = makeReport(4);
    explicit.verdicts = {
      maturity: { status: 'incomplete', reasons: [{ code: 'depth-limit' }] },
      effective: { status: 'incomplete', reasons: [{ code: 'depth-limit' }] },
    };
    const explicitSvg = renderBadge(explicit);
    expect(explicitSvg).toContain('>incomplete<');
    expect(explicitSvg).toContain('aria-label="Harness Score incomplete"');
    expect(explicitSvg).toContain('width="140"');
    expect(explicitSvg).not.toContain('>L4<');

    const legacy = makeReport(2);
    legacy.truncated = true;
    expect(renderBadge(legacy)).toContain('>incomplete<');
  });

  test('remains maturity-only when effective is incomplete', () => {
    const report = makeReport(4);
    report.verdicts = {
      maturity: { status: 'complete', reasons: [] },
      effective: { status: 'incomplete', reasons: [{ code: 'depth-limit' }] },
    };

    const svg = renderBadge(report);
    expect(svg).toContain('>L4<');
    expect(svg).not.toContain('>incomplete<');
  });
});
