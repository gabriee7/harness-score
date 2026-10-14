# Changelog

## 0.1.1 — 2026-07-15

Content-only maintenance release — no new commands or skills.

- `harness-engineering` skill: terminology aligned with the v0.4.0 CLI
  rename ("rubric" → "maturity model").
- Plugin sources moved from `plugin/` to `plugins/cursor/` in the repo
  (multi-plugin layout alongside the new Claude Code plugin); no change
  to what the plugin installs or does.

## 0.1.0 — 2026-07-10

Initial release.

- `/harness-audit` command running the deterministic `harness-score` scanner
  (6 dimensions, maturity levels L0–L4) — always the latest published
  version via `npx`, so the exact check count isn't pinned to this plugin
  release.
- `harness-engineering` skill with remediation recipes for every check
  family (context, skills, hooks, sensors, CI, hygiene).
