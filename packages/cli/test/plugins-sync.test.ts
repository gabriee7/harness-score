import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { TOOL_PATHS } from '../../../plugins/shared/tool-paths.mjs';
import { TOOLS } from '../../../plugins/shared/tools.mjs';
import { PLUGIN_TOOL_PATHS } from '../src/harness/registry.js';

function writeFixture(root: string, relativePath: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

describe('plugins/shared path config sync', () => {
  test('the legacy GitHub Action entrypoint matches the canonical root action', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../..');
    const canonical = fs.readFileSync(path.join(repoRoot, 'action.yml'), 'utf8');
    const legacy = fs.readFileSync(path.join(repoRoot, 'action/action.yml'), 'utf8');

    expect(legacy).toBe(canonical);
  });

  test('the GitHub Action metadata stays Marketplace-ready and version-aligned', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../..');
    const metadata = fs.readFileSync(path.join(repoRoot, 'action.yml'), 'utf8');
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'packages/cli/package.json'), 'utf8'),
    ) as { version: string };
    const actionReadme = fs.readFileSync(path.join(repoRoot, 'action/README.md'), 'utf8');

    const descriptionBlock = metadata.match(/^description: >-\r?\n(?<lines>(?: {2}.+\r?\n)+)author:/m);
    const description = descriptionBlock?.groups?.lines
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .join(' ');
    const actionVersion = metadata.match(/^ {2}version:\r?\n(?: {4}.+\r?\n)+? {4}default: '([^']+)'/m)?.[1];
    const documentedActionVersion = actionReadme.match(
      /^\| `version` \| `([^`]+)` \| harness-score npm version or package spec \|$/m,
    )?.[1];

    expect(description).toBeDefined();
    expect(description!.length).toBeLessThan(125);
    expect(actionVersion).toBe(packageJson.version);
    expect(documentedActionVersion).toBe(packageJson.version);
  });

  test('the GitHub Action documents gate-scoped failures and effective output availability', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../..');
    const metadata = fs.readFileSync(path.join(repoRoot, 'action.yml'), 'utf8');

    expect(metadata).toContain(
      "description: 'Fail below this level (0–4). An incomplete gated snapshot exits 2, including at 0.'",
    );
    expect(metadata).toContain(
      "description: 'Effective level index when the effective snapshot is complete.'",
    );
    expect(metadata).toContain(
      "description: 'Effective score percentage when the effective snapshot is complete.'",
    );
  });

  test('the PR baseline and current diff receive the same explicit config without disabling autodiscovery', () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../..');
    const metadata = fs.readFileSync(path.join(repoRoot, 'action.yml'), 'utf8');
    const baseline = metadata.match(/ {4}- id: baseline\r?\n(?<body>[\s\S]*?)(?=\r?\n {4}- id: diff\r?\n)/)
      ?.groups?.body;
    const diff = metadata.match(/ {4}- id: diff\r?\n(?<body>[\s\S]*?)(?=\r?\n {4}- id: comment\r?\n)/)?.groups
      ?.body;

    expect(baseline).toContain('HS_CONFIG: ${{ inputs.config }}');
    expect(baseline).toContain('[ -n "$HS_CONFIG" ] && BASELINE_ARGS+=(--config "$HS_CONFIG")');
    expect(baseline).toContain('"${BASELINE_ARGS[@]}"');
    expect(diff).toContain('HS_CONFIG: ${{ inputs.config }}');
    expect(diff).toContain('[ -n "$HS_CONFIG" ] && DIFF_ARGS+=(--config "$HS_CONFIG")');
    expect(diff).toContain('"${DIFF_ARGS[@]}"');
  });

  test('sync-version updates the documented GitHub Action version with the release surfaces', () => {
    const sourceRoot = path.resolve(import.meta.dirname, '../../..');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-version-sync-'));
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.copyFileSync(
      path.join(sourceRoot, 'scripts/sync-version.mjs'),
      path.join(root, 'scripts/sync-version.mjs'),
    );
    writeFixture(root, 'packages/cli/package.json', JSON.stringify({ version: '9.9.9' }));
    writeFixture(root, 'packages/cli/src/score.ts', "export const TOOL_VERSION = '1.5.3';\n");
    writeFixture(root, 'packages/cli/jsr.json', JSON.stringify({ version: '1.5.3' }));
    writeFixture(
      root,
      'package-lock.json',
      JSON.stringify({ packages: { 'packages/cli': { version: '1.5.3' } } }),
    );
    const action =
      "inputs:\n  version:\n    description: 'version'\n    required: false\n    default: '1.5.3'\n";
    writeFixture(root, 'action.yml', action);
    writeFixture(root, 'action/action.yml', action);
    writeFixture(
      root,
      'action/README.md',
      '| `version` | `1.5.3` | harness-score npm version or package spec |\n',
    );

    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    if (process.platform === 'win32') {
      writeFixture(root, 'bin/npx.cmd', '@exit /b 0\r\n');
    } else {
      writeFixture(root, 'bin/npx', '#!/bin/sh\nexit 0\n');
      fs.chmodSync(path.join(bin, 'npx'), 0o755);
    }

    try {
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/sync-version.mjs')], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(fs.readFileSync(path.join(root, 'action/README.md'), 'utf8')).toContain(
        '| `version` | `9.9.9` | harness-score npm version or package spec |',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('generated TOOL_PATHS matches PLUGIN_TOOL_PATHS from the CLI harness registry exactly', () => {
    for (const [toolId, paths] of Object.entries(PLUGIN_TOOL_PATHS)) {
      const tool = TOOL_PATHS[toolId as keyof typeof TOOL_PATHS];
      expect(tool, `missing TOOL_PATHS.${toolId}`).toBeDefined();
      expect(tool.skillsDir).toBe(paths.skillsDir);
      expect(tool.commandsDir).toBe(paths.commandsDir);
      expect(tool.mcpConfigPath).toBe(paths.mcpConfigPath);
    }
    expect(Object.keys(TOOL_PATHS).sort()).toEqual(Object.keys(PLUGIN_TOOL_PATHS).sort());
    expect(PLUGIN_TOOL_PATHS).not.toHaveProperty('devin');
  });

  test('every shipped plugin in TOOLS derives its paths from TOOL_PATHS', () => {
    for (const [toolId, tool] of Object.entries(TOOLS)) {
      const paths = TOOL_PATHS[toolId as keyof typeof TOOL_PATHS];
      expect(paths, `TOOLS.${toolId} has no registry entry in TOOL_PATHS`).toBeDefined();
      expect(tool.skillsDir).toBe(paths.skillsDir);
      expect(tool.commandsDir).toBe(paths.commandsDir);
      expect(tool.mcpConfigPath).toBe(paths.mcpConfigPath);
      expect(tool.pluginDir).toBe(`plugins/${toolId}`);
    }
  });
});
