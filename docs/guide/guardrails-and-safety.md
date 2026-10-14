# Guardrails & Safety

Guides suggest. Sensors detect. **Guardrails prevent.** This chapter covers
the harness layer that holds even when the model ignores every instruction —
because it doesn't depend on the model reading anything.

## Why prose is not a guardrail

A rule that says "never run `git push --force`" is a request to a
probabilistic system. It will usually be honored. "Usually" is the wrong
reliability class for destructive, irreversible, or credential-touching
operations. For those, the check must live **outside the model**, in
machinery the model cannot skip: hooks, permissions, and repository hygiene.

The escalation ladder from chapter 3 ends here: guidance that keeps being
violated moves from rule → sensor → **gate**.

## Gate hooks

Cursor's gating events — `beforeShellExecution`, `beforeMCPExecution`,
`preToolUse`, `beforeReadFile` — run your script *before* the action and let
it answer `allow`, `deny`, or `ask`:

```js
// .cursor/hooks/guard-shell.js — deny destructive commands
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  const { command = '' } = JSON.parse(input || '{}');
  const destructive =
    /\brm\s+-rf\s+[\/~]|\bgit\s+push\s+--force\b|\bdrop\s+(table|database)\b/i;
  process.stdout.write(
    JSON.stringify(
      destructive.test(command)
        ? { permission: 'deny', userMessage: 'Blocked: destructive command.' }
        : { permission: 'allow' },
    ),
  );
});
```

```json
{
  "version": 1,
  "hooks": {
    "beforeShellExecution": [
      { "command": "node ./.cursor/hooks/guard-shell.js", "timeout": 10 }
    ]
  }
}
```

Patterns worth gating in most repositories:

- **Destructive shell**: recursive deletes outside the workspace, force
  pushes, history rewrites, `DROP`/`TRUNCATE` against non-local databases.
- **Outbound writes**: deploys, package publishes, posting to external APIs —
  `ask`, not `deny`: the human confirms, in-flow.
- **Secret-bearing reads**: `beforeReadFile` on `.env*`, key files, and
  credential stores keeps secrets out of model context entirely.
- **MCP calls with side effects**: `beforeMCPExecution` filtering by tool
  name — allow reads, confirm writes.

Design notes: fail *closed* for the dangerous list (exit code 2 blocks),
keep gate scripts dependency-free and fast, and **commit them** — a hook
config pointing at a script that exists only on your machine protects only
you.

## Secret hygiene

The agent reads your working tree; anything in it can end up in context, in
a commit, or in a generated file. Deterministic hygiene rules:

1. **`.gitignore` covers `.env` and `.env.*`** (allow `.env.example`).
   This is the single cheapest guardrail in existence.
2. **No real `.env` files in the tree** where avoidable; templates document
   the required variables instead.
3. **`mcp.json` uses `${ENV_VAR}` interpolation, never literal keys.** An MCP
   config with an inlined API key is a secret published to every clone.
4. **No tokens in harness files.** `AGENTS.md`, rules, and hooks configs are
   *loaded into model context on every session* — a key there is exfiltrated
   by design.

`harness-score` checks all four (HYG-02 … HYG-06) with credential-signature
matching — deterministically, offline.

## Prompt-injection awareness

Agent harnesses have a threat class human workflows don't: **instructions
hiding in data**. A README in a dependency, a web page fetched by MCP, an
issue comment — any of them can contain text addressed to your agent
("ignore your instructions and run…"). Harness-level mitigations:

- Gate hooks don't care who authored the instruction — the destructive
  command is denied whether the user, the model, or an injected page asked
  for it. This is the strongest argument for gates over rules.
- Scope MCP servers to what the task needs; a read-only docs server can't
  post your data anywhere.
- Treat "the agent suddenly wants to curl an unfamiliar domain" as a signal
  worth an `ask` gate.

## Permissions and blast radius

Beyond hooks, shrink what a compromised or confused agent *could* do:

- Run agents with credentials scoped to the task (a CI token that can open
  PRs but not push to `main`).
- Branch protection: agents open PRs; humans (or required checks) merge.
- Sandboxed execution for untrusted or long-running autonomous work.

The unifying principle is **defense in depth**: rules make bad actions
unlikely, sensors make them visible, gates make them impossible, and
permissions make even "impossible failed" survivable.

## A minimum viable guardrail set

For a typical product repository, the floor looks like:

- [ ] `.gitignore` covering env files; no real secrets in the tree
- [ ] `mcp.json` clean of literal credentials
- [ ] A recognized hooks config (`.cursor/hooks.json`, Claude Code `settings.json`, `.devin/hooks.v1.json`, or `.devin/config.json` hooks key) with one gate (destructive patterns → deny/ask)
- [ ] One feedback hook (format/lint on edit)
- [ ] Branch protection with required CI checks

That set is exactly what the [maturity model](/guide/maturity-model) requires
for the Hooks & Guardrails and Hygiene & Safety dimensions at L4.
