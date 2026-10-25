/**
 * Extracts reference candidates from one operational document and gives each a
 * canonical record with a preliminary state. Nothing is checked against the
 * repository here: a reference that still needs the file index is `pending`.
 *
 * Candidates come from four syntactic sources only: Markdown links, inline code,
 * fenced code blocks and recognized frontmatter fields. Text that merely looks
 * like a command or a concept is not extracted.
 */

import { normalizeFragment } from './anchors.js';
import { parseGlob } from './glob.js';
import { positionWithin, type SourcePosition, scanMarkdown, type TextSpan } from './markdown.js';
import { type NormalizeResult, normalizeTarget } from './normalize.js';
import type {
  ExtractedReference,
  ExtractionResult,
  HtmlAnchor,
  ReferenceForm,
  ReferenceReason,
  ReferenceStatus,
  ReferenceSyntax,
  SourceArtifactKind,
} from './types.js';

export interface SourceDocument {
  /** Repository-relative POSIX path of the document. */
  path: string;
  kind: SourceArtifactKind;
  content: string;
}

/** Extensions that make a bare name a file reference. */
const KNOWN_EXTENSIONS = new Set([
  'md',
  'mdc',
  'markdown',
  'mdx',
  'txt',
  'rst',
  'json',
  'jsonc',
  'yml',
  'yaml',
  'toml',
  'ini',
  'cfg',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'mts',
  'cts',
  'tsx',
  'vue',
  'svelte',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'bat',
  'cmd',
  'sql',
  'lock',
  'csv',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'pdf',
  'tex',
  'bib',
  'ipynb',
  'gradle',
  'tf',
  'proto',
  'graphql',
]);

/** Frontmatter fields whose values are scope globs or paths of a rule. */
const FORMAL_FIELDS = new Set(['globs', 'paths', 'applyTo']);

interface Candidate {
  syntax: ReferenceSyntax;
  text: string;
  position: SourcePosition;
}

function directoryOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function hasKnownExtension(name: string): boolean {
  const segment = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = segment.lastIndexOf('.');
  return dot > 0 && KNOWN_EXTENSIONS.has(segment.slice(dot + 1).toLowerCase());
}

/** Tokens of a code span that can be a reference: they show a path or a known extension. */
function codeTokens(span: TextSpan): Candidate[] {
  const out: Candidate[] = [];
  const syntax = 'inline-code' as const;
  for (const match of span.text.matchAll(/[^\s"'`=;|&<>()]+/g)) {
    const leading = /^[,:]+/.exec(match[0])?.[0].length ?? 0;
    const text = match[0].slice(leading).replace(/[.,:!]+$/, '');
    if (text === '' || text.startsWith('-') || !/[\p{L}\p{N}]/u.test(text)) continue;
    if (!/[\\/]/.test(text) && !hasKnownExtension(text)) continue;
    out.push({ syntax, text, position: positionWithin(span, (match.index ?? 0) + leading) });
  }
  return out;
}

/** Splits a field value on commas that are not inside braces; trims and unquotes items. */
function fieldItems(span: TextSpan): Candidate[] {
  const out: Candidate[] = [];
  let depth = 0;
  let start = 0;
  const push = (end: number) => {
    const raw = span.text.slice(start, end);
    let lead = raw.length - raw.trimStart().length;
    let text = raw.trim();
    if (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text.endsWith(text[0]!)) {
      text = text.slice(1, -1);
      lead++;
    }
    if (text !== '') {
      out.push({
        syntax: 'formal-field',
        text,
        position: positionWithin(span, start + lead),
      });
    }
  };
  for (let i = 0; i < span.text.length; i++) {
    const ch = span.text[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(span.text.length);
  return out;
}

function decodePercent(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function build(doc: SourceDocument, candidate: Candidate): ExtractedReference {
  const sourceDir = directoryOf(doc.path);
  const isLink = candidate.syntax === 'markdown-link';
  const raw = candidate.text;

  const result = (
    state: ReferenceStatus,
    rule: string,
    evidence: string,
    fields: Partial<ExtractedReference> = {},
  ): ExtractedReference => ({
    sourceArtifact: doc.path,
    sourceArtifactKind: doc.kind,
    position: candidate.position,
    syntax: candidate.syntax,
    form: null,
    rawText: raw,
    normalizedTarget: null,
    anchor: null,
    alternateTarget: null,
    explicitPath: isLink || candidate.syntax === 'formal-field' || /[\\/]/.test(raw),
    operational: false,
    state,
    reasonCode: null,
    rule,
    evidence,
    ...fields,
  });
  const ambiguous = (rule: string, reason: ReferenceReason, evidence: string, f = {}) =>
    result('ambiguous', rule, evidence, { reasonCode: reason, ...f });

  const trimmed = raw.trim();
  if (trimmed === '') {
    return ambiguous('alg4.empty-destination', 'empty-destination', 'the destination is empty');
  }

  // A fragment starts at `#`; a query (`?`) exists only in hyperlinks, where `?` is
  // never a glob wildcard.
  let pathPart = trimmed;
  let fragment: string | null = null;
  const hash = pathPart.indexOf('#');
  if (hash !== -1) {
    fragment = pathPart.slice(hash + 1);
    pathPart = pathPart.slice(0, hash);
  }
  if (isLink) {
    const query = pathPart.indexOf('?');
    if (query !== -1) pathPart = pathPart.slice(0, query);
    pathPart = decodePercent(pathPart);
  }

  if (pathPart === '' && fragment !== null) {
    const slug = normalizeFragment(fragment);
    if (slug === '') {
      return ambiguous('alg4.empty-destination', 'empty-destination', 'the anchor has no name');
    }
    return result('pending', 'alg4.anchor-same-doc', 'anchor in the same document', {
      form: 'anchor-same-doc',
      normalizedTarget: slug,
      anchor: slug,
    });
  }

  // Hyperlinks read a leading `/` as the repository root; elsewhere it is absolute.
  const base = isLink && pathPart.startsWith('/') ? 'root' : 'document';
  const normalized: NormalizeResult = normalizeTarget(pathPart, {
    base,
    sourceDir: isLink ? sourceDir : '',
  });

  if (normalized.kind === 'empty') {
    return ambiguous('alg4.empty-destination', 'empty-destination', 'the destination is empty');
  }
  if (normalized.kind === 'not-evaluable') {
    const { reason } = normalized;
    const rule =
      reason === 'external-resource'
        ? 'alg4.external'
        : reason === 'variable-dependent' || reason === 'execution-dependent'
          ? 'alg4.dynamic'
          : reason === 'root-escape-attempt'
            ? 'policy.root-escape'
            : 'policy.absolute-path';
    return result('not-evaluable', rule, `target cannot be checked locally: ${reason}`, {
      reasonCode: reason,
    });
  }

  const target = normalized.path;
  let alternateTarget: string | null = null;
  if (!isLink && sourceDir !== '') {
    const alternate = normalizeTarget(pathPart, { base: 'document', sourceDir });
    if (alternate.kind === 'path' && alternate.path !== target) alternateTarget = alternate.path;
  }
  const located = (form: ReferenceForm, fields: Partial<ExtractedReference> = {}) => ({
    form,
    normalizedTarget: target,
    alternateTarget,
    ...fields,
  });

  if (fragment !== null && normalizeFragment(fragment) !== '') {
    const slug = normalizeFragment(fragment);
    return result('pending', 'alg5.anchor-other-doc', 'anchor in another document', {
      ...located('anchor-other-doc', { anchor: slug }),
    });
  }

  if (/[*?[\]{}]/.test(pathPart) || pathPart.startsWith('!')) {
    const glob = parseGlob(pathPart);
    if (!glob.supported) {
      return result('not-supported', 'alg5.glob-unsupported', `glob syntax not supported: ${glob.reason}`, {
        form: 'glob-pattern',
        normalizedTarget: pathPart,
        reasonCode: 'unsupported-glob',
      });
    }
    if (candidate.syntax !== 'formal-field') {
      return result(
        'not-evaluable',
        'alg5.glob-illustrative',
        'glob mentioned in text, not declared as an active scope',
        { ...located('glob-pattern'), reasonCode: 'non-operational-mention' },
      );
    }
    return result('pending', 'alg5.glob-pending', 'glob declared as an active scope', {
      ...located('glob-pattern'),
      operational: true,
    });
  }

  if (normalized.directoryHint) {
    return result('pending', 'alg5.directory', 'explicit directory', located('directory-path'));
  }
  if (hasKnownExtension(pathPart)) {
    return result('pending', 'alg5.file', 'known file extension', located('file-path'));
  }
  return ambiguous('alg5.ambiguous', 'no-type-indicator', 'no explicit indicator of file or directory', {
    normalizedTarget: target,
    alternateTarget,
  });
}

export function extractReferences(doc: SourceDocument): ExtractionResult {
  const candidates: Candidate[] = [];
  const htmlAnchors: HtmlAnchor[] = [];

  for (const node of scanMarkdown(doc.content)) {
    if (node.type === 'link') {
      candidates.push({
        syntax: 'markdown-link',
        text: node.destination.text,
        position: node.destination.position,
      });
    } else if (node.type === 'inline-code') {
      candidates.push(...codeTokens(node.content));
    } else if (node.type === 'code-block') {
      for (const line of node.lines) {
        for (const token of codeTokens(line)) candidates.push({ ...token, syntax: 'code-block' });
      }
    } else if (node.type === 'frontmatter-field') {
      if (doc.kind === 'scoped-rule' && FORMAL_FIELDS.has(node.key)) {
        for (const value of node.values) candidates.push(...fieldItems(value));
      }
    } else if (node.type === 'html-anchor') {
      htmlAnchors.push({
        name: node.value.text,
        attribute: node.attribute,
        position: node.value.position,
      });
    }
  }

  const references = candidates
    .map((candidate) => build(doc, candidate))
    .sort((a, b) => a.position.line - b.position.line || a.position.column - b.position.column);
  return { references, htmlAnchors };
}
