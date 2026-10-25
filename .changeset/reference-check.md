---
'harness-score': minor
---

Add an opt-in reference check. `harness-score --references` (or `score(root, { references: true })`) verifies that the files, directories, glob patterns and Markdown anchors cited in `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`, scoped rules, skills and OpenSpec documents exist in the repository, and reports each occurrence with its position and one of five states: consistent, inconsistent, not evaluable, not supported or ambiguous. The result is informational: it appears as a separate terminal and Markdown section and as the optional `references` field of the JSON report, and it never changes the score, the level, the checks or the exit code. Without the flag the output is unchanged.

`ScanContext` gains two read-only methods, `hasDirectory(path)` and `matchingGlob(pattern)`. Code that implements `ScanContext` itself (for example test doubles) needs to add them.
