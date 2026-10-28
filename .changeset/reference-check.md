---
'harness-score': minor
---

Add an opt-in reference check. `harness-score --references` (or `score(root, { references: true })`) verifies that the files, directories, glob patterns and Markdown anchors cited in `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`, scoped rules, skills and OpenSpec documents exist in the repository, and reports each occurrence with its position and one of five states: consistent, inconsistent, not evaluable, not supported or ambiguous. The result is informational: it appears as a separate terminal and Markdown section and as the optional `references` field of the JSON report, and it never changes the score, the level, the checks or the exit code. Without the flag the output is unchanged. The same section also recognizes an OpenSpec structure and reports three independent properties: whether the structure exists, whether each active document has minimum content, and the states of the references those documents contain; archived changes are counted but not assessed. Every outcome carries a documented rule id (exported as `RULES`), and `packages/cli/REFERENCE-CHECK.md` specifies the exact behavior.

`ScanContext` gains two read-only methods, `hasDirectory(path)` and `matchingGlob(pattern)`. Code that implements `ScanContext` itself (for example test doubles) needs to add them.
