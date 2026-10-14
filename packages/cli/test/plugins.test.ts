import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildUserOverlay } from '../src/harness/global-paths.js';
import { buildReport } from '../src/score.js';
import { check, fakeContext } from './helpers.js';

describe('plugin layout at scan root', () => {
  test('SKL-01 passes for Claude Code plugin default skills/ layout', async () => {
    const ctx = fakeContext({
      '.claude-plugin/plugin.json': '{"name":"kit"}',
      'skills/s1/SKILL.md':
        '---\nname: s1\ndescription: Use when the user asks to test plugin skill visibility in the scanner.\n---\n# s1\n',
    });
    expect((await check('SKL-01')).run(ctx).passed).toBe(true);
    expect((await check('SKL-01')).run(ctx).evidence).toContain('skills/s1/SKILL.md');
  });

  test('SKL-01 passes for Cursor plugin default skills/ layout', async () => {
    const ctx = fakeContext({
      '.cursor-plugin/plugin.json': '{"name":"kit"}',
      'skills/review/SKILL.md': '---\nname: review\ndescription: x\n---\n',
    });
    expect((await check('SKL-01')).run(ctx).passed).toBe(true);
  });

  test('plugin skills are ignored without a manifest at the scan root', async () => {
    const ctx = fakeContext({
      'skills/s1/SKILL.md': '---\nname: s1\ndescription: x\n---\n',
    });
    expect((await check('SKL-01')).run(ctx).passed).toBe(false);
  });

  test('nested plugin manifest does not enable plugin layout aliasing', async () => {
    const ctx = fakeContext({
      'plugins/cursor/.cursor-plugin/plugin.json': '{}',
      'plugins/cursor/skills/x/SKILL.md': '---\nname: x\ndescription: x\n---\n',
    });
    expect((await check('SKL-01')).run(ctx).passed).toBe(false);
  });

  test('HKS-01 passes for plugin hooks/hooks.json mapped to Claude settings', async () => {
    const ctx = fakeContext({
      '.claude-plugin/plugin.json': '{"name":"kit"}',
      'hooks/hooks.json': '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"./noop.sh"}]}]}}',
    });
    expect((await check('HKS-01')).run(ctx).passed).toBe(true);
  });
});

describe('Claude Code user-installed plugins overlay', () => {
  function withTempHome(run: (home: string) => void): void {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-home-'));
    const prevHome = process.env.HOME;
    const prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    try {
      run(tmpHome);
    } finally {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  }

  test('collects user-scoped plugin skills into the user overlay (issue #69 repro)', () => {
    withTempHome((home) => {
      const installPath = path.join(home, '.claude', 'plugins', 'cache', 'cat', 'kit', '1.0.0');
      fs.mkdirSync(path.join(installPath, 'skills', 's1'), { recursive: true });
      fs.mkdirSync(path.join(installPath, '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(installPath, 'skills', 's1', 'SKILL.md'),
        '---\nname: s1\ndescription: Use when the user asks to test plugin skill visibility in the scanner.\n---\n# s1\n',
        'utf8',
      );
      fs.writeFileSync(path.join(installPath, '.claude-plugin', 'plugin.json'), '{"name":"kit"}', 'utf8');
      fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
      fs.writeFileSync(
        path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
        JSON.stringify({
          version: 2,
          plugins: {
            'kit@cat': [{ scope: 'user', installPath, version: '1.0.0' }],
          },
        }),
        'utf8',
      );

      const overlay = buildUserOverlay();
      expect(overlay?.files.has('.claude/skills/kit@cat--s1/SKILL.md')).toBe(true);
    });
  });

  test('ignores project-scoped plugin installs', () => {
    withTempHome((home) => {
      const installPath = path.join(home, '.claude', 'plugins', 'cache', 'cat', 'kit', '1.0.0');
      fs.mkdirSync(path.join(installPath, 'skills', 's1'), { recursive: true });
      fs.mkdirSync(path.join(installPath, '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(installPath, 'skills', 's1', 'SKILL.md'),
        '---\nname: s1\ndescription: x\n---\n',
        'utf8',
      );
      fs.writeFileSync(path.join(installPath, '.claude-plugin', 'plugin.json'), '{}', 'utf8');
      fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
      fs.writeFileSync(
        path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
        JSON.stringify({
          version: 2,
          plugins: {
            'kit@cat': [{ scope: 'project', installPath, version: '1.0.0' }],
          },
        }),
        'utf8',
      );

      const overlay = buildUserOverlay();
      expect(overlay?.files.has('.claude/skills/kit@cat--s1/SKILL.md') ?? false).toBe(false);
    });
  });

  test('user plugin skills affect effective score only, not maturity', () => {
    withTempHome((home) => {
      const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-repo-'));
      const installPath = path.join(home, '.claude', 'plugins', 'cache', 'cat', 'kit', '1.0.0');
      fs.mkdirSync(path.join(installPath, 'skills', 's1'), { recursive: true });
      fs.mkdirSync(path.join(installPath, '.claude-plugin'), { recursive: true });
      fs.writeFileSync(
        path.join(installPath, 'skills', 's1', 'SKILL.md'),
        '---\nname: s1\ndescription: Use when the user asks to test plugin skill visibility in the scanner.\n---\n',
        'utf8',
      );
      fs.writeFileSync(path.join(installPath, '.claude-plugin', 'plugin.json'), '{}', 'utf8');
      fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true });
      fs.writeFileSync(
        path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
        JSON.stringify({
          version: 2,
          plugins: {
            'kit@cat': [{ scope: 'user', installPath, version: '1.0.0' }],
          },
        }),
        'utf8',
      );

      try {
        const config = {
          scopes: { user: true, system: false },
          extraRoots: [],
          gate: 'maturity' as const,
          effectiveScopes: ['repo', 'user'] as const,
          extends: [],
          rules: {},
        };
        const report = buildReport(repo, config);
        const sklMaturity = report.checks.find((c) => c.id === 'SKL-01');
        const sklEffective = report.effective.checks.find((c) => c.id === 'SKL-01');
        expect(sklMaturity?.passed).toBe(false);
        expect(sklEffective?.passed).toBe(true);
      } finally {
        fs.rmSync(repo, { recursive: true, force: true });
      }
    });
  });
});
