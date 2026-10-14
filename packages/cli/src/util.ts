const BLOCK_SCALAR_RE = /^([|>])([+-]?)$/;

/** Locale-independent code-point ordering for deterministic path tie-breakers. */
export function compareLexically(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function leadingWhitespace(line: string): number {
  return line.match(/^\s*/)![0].length;
}

/**
 * Consume a YAML block scalar (`>` folded or `|` literal) starting after the
 * `key:` line. Returns the reconstructed value and the index of the last
 * consumed line (caller resumes scanning after it).
 */
function readBlockScalar(
  lines: string[],
  startIndex: number,
  keyIndent: number,
  style: '|' | '>',
): { value: string; lastIndex: number } {
  const collected: string[] = [];
  let blockIndent: number | null = null;
  let i = startIndex;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') {
      collected.push('');
      continue;
    }
    const indent = leadingWhitespace(line);
    if (indent <= keyIndent) break;
    if (blockIndent === null) blockIndent = indent;
    collected.push(line.slice(blockIndent));
  }
  const value =
    style === '|'
      ? collected.join('\n').trim()
      : collected
          .join('\n')
          .split(/\n{2,}/)
          .map((para) => para.replace(/\n/g, ' ').trim())
          .join('\n')
          .trim();
  return { value, lastIndex: i - 1 };
}

/**
 * Minimal frontmatter parser: reads the leading `---` block and extracts
 * top-level `key: value` pairs, including multi-line YAML block scalars
 * (`key: >` folded / `key: |` literal). Intentionally supports only the
 * subset used by Cursor rules (.mdc) and skills (SKILL.md) — determinism
 * over full YAML compliance.
 */
export function parseFrontmatter(content: string): Record<string, string> | null {
  const normalized = content.replace(/^﻿/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) return null;
  const lines = match[1]!.split(/\r?\n/);
  const result: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1]!;
    const rawValue = kv[2]!.trim();
    const blockMatch = rawValue.match(BLOCK_SCALAR_RE);
    if (blockMatch) {
      const style = blockMatch[1] as '|' | '>';
      const keyIndent = leadingWhitespace(line);
      const { value, lastIndex } = readBlockScalar(lines, i + 1, keyIndent, style);
      result[key] = value;
      i = lastIndex;
    } else {
      result[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }
  return result;
}

/** Count lines that contain something other than whitespace. */
export function nonEmptyLines(content: string): number {
  return content.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
}

export function totalLines(content: string): number {
  return content.split(/\r?\n/).length;
}

/** Markdown headings (`#`–`######`). */
export function countHeadings(content: string): number {
  return content.split(/\r?\n/).filter((l) => /^#{1,6}\s+\S/.test(l)).length;
}

/**
 * Signatures of credentials that must never live in a repository.
 * Applied to harness files (mcp.json, rules, AGENTS.md) — not a full secret
 * scanner, but catches the classic leaks deterministically.
 */
const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: 'OpenAI-style API key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Slack incoming webhook URL', re: /hooks\.slack\.com\/services\/[A-Za-z0-9/]+/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Stripe secret key', re: /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

export function findSecret(content: string): string | null {
  for (const { name, re } of SECRET_PATTERNS) {
    if (re.test(content)) return name;
  }
  return null;
}

/**
 * Returns `undefined` only when `content` fails to parse as JSON — a valid
 * but falsy JSON value (`null`, `false`, `0`, `""`) is returned as-is, since
 * JSON itself can never produce `undefined`. Callers must check
 * `=== undefined` for "did not parse", not a truthiness check.
 */
export function safeJsonParse(content: string): unknown | undefined {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}
