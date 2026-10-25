/**
 * Minimal Markdown syntax scanner. It locates the constructs that can carry a
 * reference (links, code, HTML anchors, frontmatter fields) together with their
 * exact position, and nothing else: no rendering, no semantics.
 *
 * Positions are 1-based. A column counts Unicode code points, so an emoji is one
 * column on every platform. `\r\n`, `\r` and `\n` all end a line and a leading
 * byte-order mark is ignored, so the same text gives the same positions
 * everywhere.
 *
 * Known limits: indented (non-fenced) code blocks, constructs split across
 * lines (inline code, link destinations, multi-line HTML tags), block quotes
 * around fences, and YAML block scalars (`|`, `>`) are not recognized.
 */

export interface SourcePosition {
  line: number;
  column: number;
}

export interface TextSpan {
  text: string;
  position: SourcePosition;
}

export type MarkdownNode =
  | {
      type: 'link';
      syntax: 'inline' | 'image' | 'definition' | 'autolink';
      position: SourcePosition;
      destination: TextSpan;
    }
  | { type: 'inline-code'; position: SourcePosition; content: TextSpan }
  | { type: 'code-block'; position: SourcePosition; info: string; lines: TextSpan[] }
  | {
      type: 'html-anchor';
      position: SourcePosition;
      attribute: 'name' | 'id';
      value: TextSpan;
    }
  | { type: 'frontmatter-field'; position: SourcePosition; key: string; values: TextSpan[] };

/** Column of a UTF-16 index in a line, counting code points. */
function columnOf(line: string, index: number): number {
  let count = 0;
  for (let i = 0; i < index; i++) {
    const code = line.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) i++;
    count++;
  }
  return count + 1;
}

function span(line: string, lineNo: number, start: number, end: number): TextSpan {
  return {
    text: line.slice(start, end),
    position: { line: lineNo, column: columnOf(line, start) },
  };
}

/** Position `offset` UTF-16 units into a span (for callers that split a span's text). */
export function positionWithin(textSpan: TextSpan, offset: number): SourcePosition {
  const before = textSpan.text.slice(0, offset);
  return {
    line: textSpan.position.line,
    column: textSpan.position.column + Array.from(before).length,
  };
}

/* ------------------------------------------------------------------ */
/* Frontmatter                                                         */
/* ------------------------------------------------------------------ */

function scalarSpan(line: string, lineNo: number, from: number, to: number): TextSpan | null {
  let start = from;
  let end = to;
  while (start < end && /\s/.test(line[start]!)) start++;
  while (end > start && /\s/.test(line[end - 1]!)) end--;
  if (start >= end) return null;
  const quote = line[start];
  let result: TextSpan;
  if (quote === '"' || quote === "'") {
    const close = line.indexOf(quote, start + 1);
    if (close === -1 || close >= end) return null;
    result = span(line, lineNo, start + 1, close);
  } else {
    const comment = line.slice(start, end).search(/[ \t]#/);
    if (comment !== -1) end = start + comment;
    while (end > start && /\s/.test(line[end - 1]!)) end--;
    result = span(line, lineNo, start, end);
  }
  return result.text === '' ? null : result;
}

function flowListItems(line: string, lineNo: number, open: number): TextSpan[] {
  const items: TextSpan[] = [];
  let itemStart = open + 1;
  let quote: string | null = null;
  const push = (end: number) => {
    const item = scalarSpan(line, lineNo, itemStart, end);
    if (item) items.push(item);
  };
  for (let i = open + 1; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      push(i);
      itemStart = i + 1;
    } else if (ch === ']') {
      push(i);
      return items;
    }
  }
  return items;
}

/** Scans a leading `---` block; returns the index of the first body line. */
function scanFrontmatter(lines: string[], nodes: MarkdownNode[]): number {
  if (lines[0]?.trimEnd() !== '---') return 0;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i]!.trimEnd();
    if (trimmed === '---' || trimmed === '...') {
      end = i;
      break;
    }
  }
  if (end === -1) return 0;

  for (let i = 1; i < end; i++) {
    const line = lines[i]!;
    const match = /^([A-Za-z_][\w.-]*)[ \t]*:(?:[ \t]+|$)(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!;
    const rest = match[2]!;
    const valueFrom = line.length - rest.length;
    const values: TextSpan[] = [];
    const head = rest.trim();

    if (head === '' || head.startsWith('#')) {
      let next = i + 1;
      for (; next < end; next++) {
        const item = /^[ \t]*-[ \t]+(.*)$/.exec(lines[next]!);
        if (!item) {
          if (lines[next]!.trim() === '') continue;
          break;
        }
        const itemLine = lines[next]!;
        const scalar = scalarSpan(itemLine, next + 1, itemLine.length - item[1]!.length, itemLine.length);
        if (scalar) values.push(scalar);
      }
      i = next - 1;
    } else if (head.startsWith('[')) {
      values.push(...flowListItems(line, i + 1, valueFrom + rest.indexOf('[')));
    } else if (!head.startsWith('|') && !head.startsWith('>')) {
      const scalar = scalarSpan(line, i + 1, valueFrom, line.length);
      if (scalar) values.push(scalar);
    }

    nodes.push({
      type: 'frontmatter-field',
      position: { line: i + 1, column: 1 },
      key,
      values,
    });
  }
  return end + 1;
}

/* ------------------------------------------------------------------ */
/* Body                                                                */
/* ------------------------------------------------------------------ */

const FENCE_OPEN_RE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const DEFINITION_RE = /^ {0,3}\[([^\]]+)\]:[ \t]*(<[^>]*>|\S+)/;
const AUTOLINK_RE = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/;
const ANCHOR_TAG_RE = /^<a\b[^>]*>/i;
const ANCHOR_ATTRIBUTE_RE = /\b(name|id)\s*=\s*(?:"([^"]*)"|'([^']*)')/dgi;

function isClosingFence(line: string, fence: { char: string; length: number }): boolean {
  const match = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line);
  return Boolean(match && match[1]![0] === fence.char && match[1]!.length >= fence.length);
}

/** Code span starting at `index` (a backtick). Returns the node data and the next index. */
function codeSpanAt(
  line: string,
  index: number,
  limit: number,
): { start: number; end: number; next: number } | null {
  let runEnd = index;
  while (runEnd < limit && line[runEnd] === '`') runEnd++;
  const size = runEnd - index;
  let cursor = runEnd;
  while (cursor < limit) {
    if (line[cursor] !== '`') {
      cursor++;
      continue;
    }
    let closeEnd = cursor;
    while (closeEnd < limit && line[closeEnd] === '`') closeEnd++;
    if (closeEnd - cursor === size) {
      let start = runEnd;
      let end = cursor;
      const inner = line.slice(start, end);
      if (inner.length > 1 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() !== '') {
        start++;
        end--;
      }
      return { start, end, next: closeEnd };
    }
    cursor = closeEnd;
  }
  return null;
}

function scanInline(line: string, lineNo: number, from: number, to: number, nodes: MarkdownNode[]): void {
  let i = from;
  while (i < to) {
    const ch = line[i]!;

    if (ch === '\\') {
      i += 2;
      continue;
    }

    if (ch === '`') {
      const code = codeSpanAt(line, i, to);
      if (code) {
        const content = span(line, lineNo, code.start, code.end);
        nodes.push({ type: 'inline-code', position: content.position, content });
        i = code.next;
      } else {
        while (i < to && line[i] === '`') i++;
      }
      continue;
    }

    if (ch === '[' || (ch === '!' && line[i + 1] === '[')) {
      const image = ch === '!';
      const open = image ? i + 1 : i;
      const link = linkAt(line, open, to);
      if (link) {
        const destination = span(line, lineNo, link.destStart, link.destEnd);
        nodes.push({
          type: 'link',
          syntax: image ? 'image' : 'inline',
          position: destination.position,
          destination,
        });
        scanInline(line, lineNo, open + 1, link.labelEnd, nodes);
        i = link.next;
      } else {
        i = open + 1;
      }
      continue;
    }

    if (ch === '<') {
      const rest = line.slice(i, to);
      const auto = AUTOLINK_RE.exec(rest);
      if (auto) {
        const destination = span(line, lineNo, i + 1, i + 1 + auto[1]!.length);
        nodes.push({ type: 'link', syntax: 'autolink', position: destination.position, destination });
        i += auto[0].length;
        continue;
      }
      const tag = ANCHOR_TAG_RE.exec(rest);
      if (tag) {
        for (const attr of tag[0].matchAll(ANCHOR_ATTRIBUTE_RE)) {
          const range = attr.indices?.[2] ?? attr.indices?.[3];
          if (!range) continue;
          const value = span(line, lineNo, i + range[0], i + range[1]);
          nodes.push({
            type: 'html-anchor',
            position: value.position,
            attribute: attr[1]!.toLowerCase() as 'name' | 'id',
            value,
          });
        }
        i += tag[0].length;
        continue;
      }
    }

    i++;
  }
}

/** Parses `[label](destination "title")` whose `[` is at `open`. */
function linkAt(
  line: string,
  open: number,
  limit: number,
): { labelEnd: number; destStart: number; destEnd: number; next: number } | null {
  let depth = 1;
  let i = open + 1;
  let close = -1;
  while (i < limit) {
    const ch = line[i]!;
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') {
      const code = codeSpanAt(line, i, limit);
      if (code) {
        i = code.next;
      } else {
        while (i < limit && line[i] === '`') i++;
      }
      continue;
    }
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
    i++;
  }
  if (close === -1 || line[close + 1] !== '(') return null;

  let p = close + 2;
  while (p < limit && (line[p] === ' ' || line[p] === '\t')) p++;

  let destStart: number;
  let destEnd: number;
  if (line[p] === '<') {
    const end = line.indexOf('>', p + 1);
    if (end === -1 || end >= limit) return null;
    destStart = p + 1;
    destEnd = end;
    p = end + 1;
  } else {
    destStart = p;
    let parens = 0;
    while (p < limit) {
      const ch = line[p]!;
      if (ch === '\\') {
        p += 2;
        continue;
      }
      if (ch === ' ' || ch === '\t') break;
      if (ch === '(') parens++;
      if (ch === ')') {
        if (parens === 0) break;
        parens--;
      }
      p++;
    }
    destEnd = p;
  }

  while (p < limit && (line[p] === ' ' || line[p] === '\t')) p++;
  const titleOpen = line[p];
  if (titleOpen === '"' || titleOpen === "'" || titleOpen === '(') {
    const titleClose = titleOpen === '(' ? ')' : titleOpen;
    const end = line.indexOf(titleClose, p + 1);
    if (end === -1 || end >= limit) return null;
    p = end + 1;
    while (p < limit && (line[p] === ' ' || line[p] === '\t')) p++;
  }
  if (line[p] !== ')' || p >= limit) return null;
  return { labelEnd: close, destStart, destEnd, next: p + 1 };
}

export function scanMarkdown(content: string): MarkdownNode[] {
  const text = content.startsWith('﻿') ? content.slice(1) : content;
  const lines = text.split(/\r\n|\r|\n/);
  const nodes: MarkdownNode[] = [];

  let i = scanFrontmatter(lines, nodes);
  let fence: { char: string; length: number; indent: number } | null = null;
  let block: Extract<MarkdownNode, { type: 'code-block' }> | null = null;
  let inComment = false;

  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNo = i + 1;

    if (fence && block) {
      if (isClosingFence(line, fence)) {
        fence = null;
        block = null;
        continue;
      }
      let strip = 0;
      while (strip < fence.indent && line[strip] === ' ') strip++;
      block.lines.push(span(line, lineNo, strip, line.length));
      continue;
    }

    if (!inComment) {
      const open = FENCE_OPEN_RE.exec(line);
      if (open && !(open[2]![0] === '`' && open[3]!.includes('`'))) {
        fence = { char: open[2]![0]!, length: open[2]!.length, indent: open[1]!.length };
        block = {
          type: 'code-block',
          position: { line: lineNo, column: columnOf(line, open[1]!.length) },
          info: open[3]!.trim(),
          lines: [],
        };
        nodes.push(block);
        continue;
      }
      const definition = DEFINITION_RE.exec(line);
      if (definition && !definition[1]!.startsWith('^')) {
        const raw = definition[2]!;
        const wrapped = raw.startsWith('<') && raw.endsWith('>');
        const start = definition[0].length - raw.length + (wrapped ? 1 : 0);
        const destination = span(line, lineNo, start, start + raw.length - (wrapped ? 2 : 0));
        nodes.push({ type: 'link', syntax: 'definition', position: destination.position, destination });
        continue;
      }
    }

    let cursor = 0;
    while (cursor < line.length) {
      if (inComment) {
        const end = line.indexOf('-->', cursor);
        if (end === -1) {
          cursor = line.length;
        } else {
          inComment = false;
          cursor = end + 3;
        }
        continue;
      }
      const start = line.indexOf('<!--', cursor);
      if (start === -1) {
        scanInline(line, lineNo, cursor, line.length, nodes);
        cursor = line.length;
      } else {
        scanInline(line, lineNo, cursor, start, nodes);
        inComment = true;
        cursor = start + 4;
      }
    }
  }

  return nodes.sort((a, b) => a.position.line - b.position.line || a.position.column - b.position.column);
}
