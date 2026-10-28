---
'harness-score': minor
---

Add `ScanContext.matchingGlob(pattern)`, an additive query that returns the scanned files matching a glob pattern (literal segments, `*`, `?` and `**`). It returns `null` for unsupported syntax such as negation, braces or character classes, so callers can tell an unsupported pattern apart from one that matches nothing. Existing `ScanContext` members and all check results are unchanged.
