import { describe, expect, test } from 'vitest';
import {
  assignAnchorNames,
  createAnchorVerifier,
  documentAnchors,
  foldAccents,
  headingPlainText,
  slugifyHeading,
} from '../src/references/anchors.js';
import { extractReferences } from '../src/references/extract.js';
import { fakeContext } from './helpers.js';

describe('slugifyHeading', () => {
  test.each([
    ['Configuração local', 'configuração-local'],
    ['Hello, World!', 'hello-world'],
    ["What's new?", 'whats-new'],
    ['API v2.0 (beta)', 'api-v20-beta'],
    ['snake_case name', 'snake_case-name'],
    ['`npm test` command', 'npm-test-command'],
    ['[Guide](docs/g.md) intro', 'guide-intro'],
    ['![logo](a.png) Brand', 'logo-brand'],
    ['**Bold** and _italic_ text', 'bold-and-italic-text'],
    ['A - B', 'a---b'],
    ['Emoji 🎉 time', 'emoji--time'],
    ['日本語 見出し', '日本語-見出し'],
    ['<b>Tagged</b> title', 'tagged-title'],
    ['  padded  ', 'padded'],
  ])('%j -> %j', (heading, slug) => {
    expect(slugifyHeading(heading)).toBe(slug);
  });

  test('composed and decomposed accents give the same slug', () => {
    expect(slugifyHeading('Instalação'.normalize('NFD'))).toBe(slugifyHeading('Instalação'.normalize('NFC')));
  });

  test('headingPlainText reduces inline Markdown to words', () => {
    expect(headingPlainText('See [the guide](x.md) and `code`')).toBe('See the guide and code');
  });

  test('foldAccents removes diacritics only', () => {
    expect(foldAccents('configuração')).toBe('configuracao');
    expect(foldAccents('plain')).toBe('plain');
  });
});

describe('repeated headings', () => {
  test('later repeats get -1, -2, ... in order', () => {
    expect(assignAnchorNames(['Setup', 'Usage', 'Setup', 'Setup'])).toEqual([
      'setup',
      'usage',
      'setup-1',
      'setup-2',
    ]);
  });

  test('a heading that already looks like a numbered repeat does not collide', () => {
    expect(assignAnchorNames(['x', 'x', 'x-1'])).toEqual(['x', 'x-1', 'x-1-1']);
  });

  test('headings with no usable text are skipped', () => {
    expect(assignAnchorNames(['🎉', 'Real'])).toEqual(['real']);
  });
});

describe('documentAnchors', () => {
  const doc = [
    '# Guide',
    '',
    '## Configuração local',
    '',
    '```',
    '# not a heading',
    '```',
    '',
    'Setup',
    '-----',
    '',
    '<a name="Legacy-Anchor"></a>',
  ].join('\n');

  test('collects headings (ATX and setext) and HTML anchor names', () => {
    const anchors = documentAnchors(doc);
    expect([...anchors.headings]).toEqual(['guide', 'configuração-local', 'setup']);
    expect([...anchors.foldedHeadings]).toEqual(['guide', 'configuracao-local', 'setup']);
    expect([...anchors.htmlNames]).toEqual(['legacy-anchor']);
  });
});

describe('anchor verification', () => {
  const files = {
    'AGENTS.md': '# Guide\n\n## Configuração local\n\n## Setup\n\n## Setup\n',
    'docs/api.md': '# API\n\n## Login\n\n<a name="legacy"></a>\n',
    'src/a.ts': 'export {};\n',
  };
  const ctx = fakeContext(files);
  const verify = createAnchorVerifier(ctx);

  function verdictOf(link: string) {
    const [reference] = extractReferences({
      path: 'AGENTS.md',
      kind: 'context-instruction',
      content: link,
    }).references;
    return verify(reference!);
  }

  test('same-document anchor that exists', () => {
    expect(verdictOf('[a](#configuração-local)')).toEqual({
      state: 'consistent',
      reasonCode: null,
      rule: 'alg9.anchor-present',
      evidence: 'heading anchor "configuração-local" found in AGENTS.md',
    });
  });

  test('accent-insensitive match is reported as such', () => {
    const verdict = verdictOf('[a](#configuracao-local)');
    expect(verdict.state).toBe('consistent');
    expect(verdict.evidence).toContain('after removing accents');
  });

  test('other-document anchor that exists', () => {
    expect(verdictOf('[a](docs/api.md#Login)')).toMatchObject({
      state: 'consistent',
      rule: 'alg9.anchor-present',
    });
  });

  test('missing document: absence of file', () => {
    expect(verdictOf('[a](docs/ausente.md#secao)')).toMatchObject({
      state: 'inconsistent',
      reasonCode: 'document-missing',
      rule: 'alg9.document-missing',
    });
  });

  test('existing document without the heading: absence of section', () => {
    expect(verdictOf('[a](docs/api.md#secao-inexistente)')).toMatchObject({
      state: 'inconsistent',
      reasonCode: 'anchor-missing',
      rule: 'alg9.anchor-missing',
    });
  });

  test('same-document anchor that does not exist', () => {
    expect(verdictOf('[a](#nope)')).toMatchObject({ state: 'inconsistent', reasonCode: 'anchor-missing' });
  });

  test('HTML anchor is not supported, never inconsistent', () => {
    expect(verdictOf('[a](docs/api.md#legacy)')).toMatchObject({
      state: 'not-supported',
      reasonCode: 'html-anchor',
      rule: 'alg9.html-anchor',
    });
  });

  test('a target that is not Markdown is not supported', () => {
    expect(verdictOf('[a](src/a.ts#L10)')).toMatchObject({
      state: 'not-supported',
      reasonCode: 'non-markdown-anchor',
    });
  });

  test('repeated headings: both anchors resolve', () => {
    expect(verdictOf('[a](#setup)').state).toBe('consistent');
    expect(verdictOf('[a](#setup-1)').state).toBe('consistent');
    expect(verdictOf('[a](#setup-2)').state).toBe('inconsistent');
  });

  test('a document that exists but cannot be read is not evaluable', () => {
    const unreadable = createAnchorVerifier({ has: () => true, read: () => null });
    const [reference] = extractReferences({
      path: 'AGENTS.md',
      kind: 'context-instruction',
      content: '[a](docs/api.md#login)',
    }).references;
    expect(unreadable(reference!)).toMatchObject({
      state: 'not-evaluable',
      reasonCode: 'inaccessible-local-target',
    });
  });

  test('each document is read and analysed once', () => {
    let reads = 0;
    const counting = createAnchorVerifier({
      has: (p) => ctx.has(p),
      read: (p) => {
        reads++;
        return ctx.read(p);
      },
    });
    const { references } = extractReferences({
      path: 'AGENTS.md',
      kind: 'context-instruction',
      content: '[a](docs/api.md#login) [b](docs/api.md#legacy) [c](#setup) [d](#setup-1)',
    });
    for (const reference of references) counting(reference);
    expect(reads).toBe(2);
  });

  test('non-anchor references are rejected', () => {
    const [reference] = extractReferences({
      path: 'AGENTS.md',
      kind: 'context-instruction',
      content: '[a](docs/api.md)',
    }).references;
    expect(() => verify(reference!)).toThrow(TypeError);
  });

  test('verdicts are deterministic', () => {
    expect(verdictOf('[a](docs/api.md#login)')).toEqual(verdictOf('[a](docs/api.md#login)'));
  });
});
