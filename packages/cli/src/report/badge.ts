import type { Report } from '../types.js';
import { reportScopeIsComplete } from '../verdict.js';

const H = 20;
const R = 3;
const FONT = 'Verdana,Geneva,DejaVu Sans,sans-serif';
const FONT_SIZE = 11;
const TEXT_Y = 14;
const PAD = 7;

/** Left segment: bars + "harness" — inset clears rx=3 corners at 20px height. */
const LABEL_SEG = 76;
/** Right segment fits L4 — keep in sync with generate.mjs BADGE_VALUE_SEG. */
const VALUE_SEG = 36;
const INCOMPLETE_VALUE_SEG = 64;
const BAR_X = 10;
const LABEL_X = 28;
const VALUE_X = LABEL_SEG + PAD;

function barsSvg(): string {
  return `<g fill="#3ce3a3">
    <rect x="${BAR_X}" y="12" width="2.5" height="4"/>
    <rect x="${BAR_X + 4}" y="9" width="2.5" height="7"/>
    <rect x="${BAR_X + 8}" y="6" width="2.5" height="10"/>
  </g>`;
}

/** Rounded only on the exterior — no clipPath (clipPath ate the left bar icon). */
function segmentPaths(total: number, split: number): string {
  const right = `M${split},0 H${total - R} Q${total},0 ${total},${R} V${H - R} Q${total},${H} ${total - R},${H} H${split} Z`;
  const left = `M${R},0 H${split} V${H} H${R} Q0,${H} 0,${H - R} V${R} Q0,0 ${R},0 Z`;
  return `<path d="${right}" fill="#16a877"/>
  <path d="${left}" fill="#14232f"/>`;
}

function badgeBody(total: number, value: string): string {
  return `${segmentPaths(total, LABEL_SEG)}
  ${barsSvg()}
  <text x="${LABEL_X}" y="${TEXT_Y}" font-family="${FONT}" font-size="${FONT_SIZE}" font-weight="400" fill="#e9f2ee">${'harness'}</text>
  <text x="${VALUE_X}" y="${TEXT_Y}" font-family="${FONT}" font-size="${FONT_SIZE}" font-weight="700" fill="#06231a">${value}</text>`;
}

/**
 * shields.io pattern: 20px height, 11px Verdana, fixed width (level only).
 */
export function renderBadge(report: Report): string {
  const value = reportScopeIsComplete(report, 'maturity') ? `L${report.level.index}` : 'incomplete';
  const total = LABEL_SEG + (value === 'incomplete' ? INCOMPLETE_VALUE_SEG : VALUE_SEG);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${H}" viewBox="0 0 ${total} ${H}" role="img" aria-label="Harness Score ${value}">
  <title>Harness Score: ${value}</title>
  ${badgeBody(total, value)}
</svg>
`;
}
