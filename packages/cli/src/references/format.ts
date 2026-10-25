/**
 * What the human-readable reports say about references, without colors or
 * markup, so the terminal and the Markdown report show the same content.
 */

import type { ReferenceReport } from '../types.js';
import type { ReferenceState } from './types.js';

/** How many inconsistent references a human-readable report lists before pointing to JSON. */
export const INCONSISTENT_LIST_LIMIT = 50;

export interface ReferenceOverview {
  documents: string;
  states: string;
  /** True when the repository scan was incomplete. */
  incomplete: boolean;
  inconsistent: Array<{ location: string; text: string; evidence: string }>;
  /** Inconsistent references beyond the listing limit. */
  hidden: number;
  /** Outcomes other than consistent and inconsistent, per state and reason. */
  other: Array<{ state: ReferenceState; reason: string; count: number }>;
}

const OTHER_STATES: ReferenceState[] = ['not-evaluable', 'not-supported', 'ambiguous'];

/** Human-readable name of a state: `not-evaluable` -> `not evaluable`. */
export function label(state: string): string {
  return state.replace('-', ' ');
}

export function referenceOverview(references: ReferenceReport): ReferenceOverview {
  const { summary } = references;
  const unreadable = summary.unreadableDocuments > 0 ? ` · ${summary.unreadableDocuments} unreadable` : '';
  const inconsistent = references.occurrences.filter((occurrence) => occurrence.state === 'inconsistent');

  const counts = new Map<string, number>();
  for (const occurrence of references.occurrences) {
    if (!OTHER_STATES.includes(occurrence.state)) continue;
    const key = `${occurrence.state}\0${occurrence.reasonCode ?? 'unspecified'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const other = [...counts].map(([key, count]) => {
    const [state, reason] = key.split('\0') as [ReferenceState, string];
    return { state, reason, count };
  });
  other.sort(
    (a, b) =>
      OTHER_STATES.indexOf(a.state) - OTHER_STATES.indexOf(b.state) ||
      b.count - a.count ||
      a.reason.localeCompare(b.reason, 'en'),
  );

  return {
    documents:
      `${summary.operationalDocuments} operational documents · ${summary.occurrences} references · ` +
      `${summary.skippedDocuments} documents skipped${unreadable}`,
    states: (Object.keys(summary.byState) as ReferenceState[])
      .map((state) => `${label(state)} ${summary.byState[state]}`)
      .join(' · '),
    incomplete: !summary.scanComplete,
    inconsistent: inconsistent.slice(0, INCONSISTENT_LIST_LIMIT).map((occurrence) => ({
      location: `${occurrence.sourceArtifact}:${occurrence.position.line}:${occurrence.position.column}`,
      text: occurrence.rawText,
      evidence: occurrence.evidence,
    })),
    hidden: Math.max(0, inconsistent.length - INCONSISTENT_LIST_LIMIT),
    other,
  };
}
