---
'harness-score': minor
---

Add `ScanContext.hasDirectory(relPath)`, an additive query that reports whether any scanned file lives under a repository-relative directory. Existing `ScanContext` members and all check results are unchanged. Empty directories are not detected, since the scan only indexes files.
