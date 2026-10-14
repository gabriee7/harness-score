import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import { buildUserOverlay } from '../src/harness/global-paths.js';
import {
  CLAUDE_PLUGIN_MANIFEST,
  CURSOR_PLUGIN_MANIFEST,
  claudePluginsRegistryPath,
  collectClaudePluginInstall,
  parseInstalledPluginsRegistry,
  pluginLayoutAtScanRoot,
  pluginLayoutToolId,
  pluginNamespacedSegment,
  pluginPhysicalToCanonical,
  pluginPhysicalToCanonicalForInstall,
  readClaudeEnabledPlugins,
  shouldIncludeInstalledPlugin,
} from '../src/harness/plugins.js';
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

describe('plugin path and registry helpers', () => {
  test('detects only manifests at the scan root and maps default-layout paths', () => {
    expect(pluginLayoutAtScanRoot(fakeContext({ [CLAUDE_PLUGIN_MANIFEST]: '{}' }))).toBe('claude-code');
    expect(pluginLayoutAtScanRoot(fakeContext({ [CURSOR_PLUGIN_MANIFEST]: '{}' }))).toBe('cursor');
    expect(pluginLayoutAtScanRoot(fakeContext({}))).toBeNull();
    expect(pluginLayoutToolId('cursor')).toBe('cursor');
    expect(pluginPhysicalToCanonical('skills/review/SKILL.md', 'cursor', true)).toBe(
      '.cursor/skills/review/SKILL.md',
    );
    expect(pluginPhysicalToCanonical('SKILL.md', 'claude-code', false)).toBe(
      '.claude/skills/plugin-root/SKILL.md',
    );
    expect(pluginPhysicalToCanonical('SKILL.md', 'claude-code', true)).toBeNull();
    expect(pluginPhysicalToCanonical('commands/review.md', 'cursor', true)).toBe(
      '.cursor/commands/review.md',
    );
    expect(pluginPhysicalToCanonical('agents/reviewer.md', 'claude-code', true)).toBe(
      '.claude/agents/reviewer.md',
    );
    expect(pluginPhysicalToCanonical('hooks/hooks.json', 'cursor', true)).toBe('.cursor/hooks.json');
    expect(pluginPhysicalToCanonical('assets/icon.svg', 'cursor', true)).toBeNull();
  });

  test('namespaces installed plugin paths and rejects unsupported layouts', () => {
    expect(pluginNamespacedSegment('catalog@owner', 'review')).toBe('catalog@owner--review');
    expect(
      pluginPhysicalToCanonicalForInstall('skills/review/SKILL.md', 'claude-code', 'cat@owner', true),
    ).toBe('.claude/skills/cat@owner--review/SKILL.md');
    expect(pluginPhysicalToCanonicalForInstall('SKILL.md', 'claude-code', 'cat@owner', false)).toBe(
      '.claude/skills/cat@owner--plugin-root/SKILL.md',
    );
    expect(pluginPhysicalToCanonicalForInstall('commands/review.md', 'claude-code', 'cat@owner', true)).toBe(
      '.claude/commands/cat@owner--review.md',
    );
    expect(pluginPhysicalToCanonicalForInstall('agents/reviewer.md', 'claude-code', 'cat@owner', true)).toBe(
      '.claude/agents/cat@owner--reviewer.md',
    );
    expect(pluginPhysicalToCanonicalForInstall('hooks/hooks.json', 'claude-code', 'cat@owner', true)).toBe(
      '.claude/settings.json',
    );
    expect(
      pluginPhysicalToCanonicalForInstall('assets/icon.svg', 'claude-code', 'cat@owner', true),
    ).toBeNull();
  });

  test('parses registry entries and checks enabled user installs', () => {
    expect(parseInstalledPluginsRegistry(null)).toBeNull();
    expect(parseInstalledPluginsRegistry([])).toBeNull();
    expect(parseInstalledPluginsRegistry({ plugins: [] })).toBeNull();
    expect(
      parseInstalledPluginsRegistry({
        plugins: { malformed: 'ignored', empty: [null, 2, []], valid: [null, { scope: 'user' }] },
      }),
    ).toEqual({ valid: [{ scope: 'user' }] });

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-plugin-entry-'));
    const directory = path.join(root, 'install');
    fs.mkdirSync(directory);
    const file = path.join(root, 'not-a-directory');
    fs.writeFileSync(file, 'file');
    try {
      expect(
        shouldIncludeInstalledPlugin('cat@owner', { scope: 'project', installPath: directory }, null),
      ).toBe(false);
      expect(shouldIncludeInstalledPlugin('cat@owner', { scope: 'user' }, null)).toBe(false);
      expect(
        shouldIncludeInstalledPlugin('cat@owner', { scope: 'user', installPath: 'relative' }, null),
      ).toBe(false);
      expect(shouldIncludeInstalledPlugin('cat@owner', { scope: 'user', installPath: file }, null)).toBe(
        false,
      );
      expect(shouldIncludeInstalledPlugin('cat@owner', { scope: 'user', installPath: directory }, null)).toBe(
        true,
      );
      expect(shouldIncludeInstalledPlugin('cat@owner', { scope: 'user', installPath: directory }, {})).toBe(
        false,
      );
      expect(
        shouldIncludeInstalledPlugin(
          'cat@owner',
          { scope: 'user', installPath: directory },
          { 'cat@owner': false },
        ),
      ).toBe(false);
      expect(
        shouldIncludeInstalledPlugin(
          'cat@owner',
          { scope: 'user', installPath: directory },
          { 'cat@owner': true },
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('reads enabled plugin settings and honors the configured registry path', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-plugin-settings-'));
    const settings = path.join(home, '.claude', 'settings.json');
    const previous = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
    try {
      expect(readClaudeEnabledPlugins(home)).toBeNull();
      fs.mkdirSync(path.dirname(settings), { recursive: true });
      fs.writeFileSync(settings, '{bad json');
      expect(readClaudeEnabledPlugins(home)).toBeNull();
      fs.writeFileSync(settings, '{}');
      expect(readClaudeEnabledPlugins(home)).toBeNull();
      fs.writeFileSync(settings, JSON.stringify({ enabledPlugins: [] }));
      expect(readClaudeEnabledPlugins(home)).toBeNull();
      fs.writeFileSync(settings, JSON.stringify({ enabledPlugins: { 'cat@owner': true } }));
      expect(readClaudeEnabledPlugins(home)).toEqual({ 'cat@owner': true });
      delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
      expect(claudePluginsRegistryPath(home)).toBe(
        path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
      );
      process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = path.join(home, 'cache');
      expect(claudePluginsRegistryPath(home)).toBe(path.join(home, 'cache', 'installed_plugins.json'));
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
      else process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = previous;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  test('collects only supported files from valid plugin install directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-plugin-collect-'));
    const install = path.join(root, 'installed');
    fs.mkdirSync(path.join(install, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(install, 'skills', 'review'), { recursive: true });
    fs.mkdirSync(path.join(install, 'commands'), { recursive: true });
    fs.mkdirSync(path.join(install, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(install, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(install, CLAUDE_PLUGIN_MANIFEST), '{}');
    fs.writeFileSync(path.join(install, 'skills', 'review', 'SKILL.md'), '# Review');
    fs.writeFileSync(path.join(install, 'commands', 'review.md'), '# Review');
    fs.writeFileSync(path.join(install, 'agents', 'reviewer.md'), '# Reviewer');
    fs.writeFileSync(path.join(install, 'hooks', 'hooks.json'), '{}');
    try {
      const withoutHooks = new Map<string, string>();
      collectClaudePluginInstall(install, 'catalog@owner', withoutHooks, false);
      expect([...withoutHooks.keys()]).toEqual([
        '.claude/agents/catalog@owner--reviewer.md',
        '.claude/commands/catalog@owner--review.md',
        '.claude/skills/catalog@owner--review/SKILL.md',
      ]);

      const withExistingSettings = new Map([['.claude/settings.json', 'repo settings']]);
      collectClaudePluginInstall(install, 'catalog@owner', withExistingSettings, true);
      expect(withExistingSettings.get('.claude/settings.json')).toBe('repo settings');
      expect(withExistingSettings.size).toBe(4);

      const noSkills = path.join(root, 'root-skill');
      fs.mkdirSync(path.join(noSkills, '.claude-plugin'), { recursive: true });
      fs.writeFileSync(path.join(noSkills, CLAUDE_PLUGIN_MANIFEST), '{}');
      fs.writeFileSync(path.join(noSkills, 'SKILL.md'), '# Root skill');
      const rootSkillFiles = new Map<string, string>();
      collectClaudePluginInstall(noSkills, 'root@owner', rootSkillFiles, true);
      expect(rootSkillFiles.has('.claude/skills/root@owner--plugin-root/SKILL.md')).toBe(true);

      const invalid = new Map<string, string>();
      collectClaudePluginInstall(path.join(root, 'missing'), 'missing', invalid, true);
      expect(invalid.size).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
