# Devin CLI reference layout

This directory is a **reference fixture** for manual and automated verification of
[harness-score](https://github.com/paladini/harness-score) Devin detection — not a
maturity-level sample like `fixtures/level-0` … `level-4`.

It mirrors the official Devin CLI layout documented at
[Hooks overview](https://docs.devin.ai/cli/extensibility/hooks/overview) and
[Extensibility overview](https://docs.devin.ai/cli/extensibility/index.md).

## Layout

| Path | Purpose |
| --- | --- |
| `.devin/skills/verify/SKILL.md` | Project skill (SKL-01/02/04) |
| `.devin/hooks.v1.json` | Standalone event map from the docs quick example, plus `PostToolUse` for feedback hooks |
| `.devin/config.json` | Non-hook Devin project settings (`model`); hooks may also live under the `hooks` key here |
| `scripts/check-command.sh` | `PreToolUse` gate script referenced by `hooks.v1.json` |
| `scripts/format-after-tool.sh` | `PostToolUse` feedback script |

## Automated verification (no Devin binary)

From the repository root:

```bash
npm run build
npm run devin:verify
```

CI and contributors can also rely on the Vitest case `devin-cli fixture` in
`packages/cli/test/devin-cli-fixture.test.ts`.

The verify script accepts an optional project root override:

```bash
DEVIN_PROJECT_DIR=/path/to/copy npm run devin:verify
```

When set, the scanner target is `DEVIN_PROJECT_DIR` instead of this fixture
(useful when comparing against a temp copy after editing with the real Devin CLI).

## Optional: compare with the latest Devin CLI

The Devin CLI is distributed separately (see [cli.devin.ai](https://cli.devin.ai));
installation and login may require a Cognition account — this repository does not
install or invoke Devin in CI.

Suggested maintainer workflow:

1. Install or update the Devin CLI per [Devin CLI](https://docs.devin.ai/work-with-devin/devin-cli.md) (login required).
2. Copy this fixture to a temporary directory (`cp -r fixtures/devin-cli /tmp/devin-harness-check`).
3. Run `devin` (or your platform’s launcher) from that directory and use `/hooks` to
   confirm loaded hook paths match `.devin/hooks.v1.json`.
4. Run `npm run devin:verify` with `DEVIN_PROJECT_DIR=/tmp/devin-harness-check`.

Fetch the full documentation index once when updating this README:
[docs.devin.ai/llms.txt](https://docs.devin.ai/llms.txt).
