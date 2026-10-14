import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ScanContext } from '../types.js';
import { compareLexically } from '../util.js';
import type { ToolId } from './registry.js';

export const CLAUDE_PLUGIN_MANIFEST = '.claude-plugin/plugin.json';
export const CURSOR_PLUGIN_MANIFEST = '.cursor-plugin/plugin.json';

const PLUGIN_ROOT_SKILL = 'plugin-root';

export type PluginLayoutTool = 'claude-code' | 'cursor';

/** Tool id when the scan root is a Claude Code or Cursor plugin repository. */
export function pluginLayoutAtScanRoot(ctx: ScanContext): PluginLayoutTool | null {
  if (ctx.has(CLAUDE_PLUGIN_MANIFEST)) return 'claude-code';
  if (ctx.has(CURSOR_PLUGIN_MANIFEST)) return 'cursor';
  return null;
}

function canonicalToolPrefix(tool: PluginLayoutTool): string {
  return tool === 'claude-code' ? '.claude' : '.cursor';
}

/**
 * Map a plugin-root-relative path to the repo-canonical shape PATH_SPECS expect.
 * Returns null when the path is not a default-layout plugin component.
 */
export function pluginPhysicalToCanonical(
  physicalPath: string,
  tool: PluginLayoutTool,
  hasSkillsDir: boolean,
): string | null {
  const prefix = canonicalToolPrefix(tool);

  const skillDir = physicalPath.match(/^skills\/([^/]+)\/SKILL\.md$/);
  if (skillDir) return `${prefix}/skills/${skillDir[1]}/SKILL.md`;

  if (physicalPath === 'SKILL.md' && !hasSkillsDir) {
    return `${prefix}/skills/${PLUGIN_ROOT_SKILL}/SKILL.md`;
  }

  const command = physicalPath.match(/^commands\/([^/]+\.md)$/);
  if (command) return `${prefix}/commands/${command[1]}`;

  const agent = physicalPath.match(/^agents\/([^/]+\.md)$/);
  if (agent) return `${prefix}/agents/${agent[1]}`;

  if (physicalPath === 'hooks/hooks.json') {
    return tool === 'claude-code' ? '.claude/settings.json' : '.cursor/hooks.json';
  }

  return null;
}

/** Namespace segment so multiple user-installed plugins do not overwrite the same canonical key. */
export function pluginNamespacedSegment(pluginId: string, componentName: string): string {
  return `${pluginId}--${componentName}`;
}

export function pluginPhysicalToCanonicalForInstall(
  physicalPath: string,
  tool: PluginLayoutTool,
  pluginId: string,
  hasSkillsDir: boolean,
): string | null {
  const prefix = canonicalToolPrefix(tool);

  const skillDir = physicalPath.match(/^skills\/([^/]+)\/SKILL\.md$/);
  if (skillDir) {
    return `${prefix}/skills/${pluginNamespacedSegment(pluginId, skillDir[1]!)}/SKILL.md`;
  }

  if (physicalPath === 'SKILL.md' && !hasSkillsDir) {
    return `${prefix}/skills/${pluginNamespacedSegment(pluginId, PLUGIN_ROOT_SKILL)}/SKILL.md`;
  }

  const command = physicalPath.match(/^commands\/([^/]+\.md)$/);
  if (command) {
    const base = command[1]!.replace(/\.md$/, '');
    return `${prefix}/commands/${pluginNamespacedSegment(pluginId, base)}.md`;
  }

  const agent = physicalPath.match(/^agents\/([^/]+\.md)$/);
  if (agent) {
    const base = agent[1]!.replace(/\.md$/, '');
    return `${prefix}/agents/${pluginNamespacedSegment(pluginId, base)}.md`;
  }

  if (physicalPath === 'hooks/hooks.json') {
    return tool === 'claude-code' ? '.claude/settings.json' : '.cursor/hooks.json';
  }

  return null;
}

export function pluginLayoutToolId(tool: PluginLayoutTool): ToolId {
  return tool;
}

interface InstalledPluginEntry {
  scope?: string;
  installPath?: string;
}

/** Parsed `plugins` map from installed_plugins.json (Claude Code). */
export function parseInstalledPluginsRegistry(raw: unknown): Record<string, InstalledPluginEntry[]> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const root = raw as Record<string, unknown>;
  const plugins = root.plugins;
  if (plugins === null || typeof plugins !== 'object' || Array.isArray(plugins)) return null;
  const out: Record<string, InstalledPluginEntry[]> = {};
  for (const [key, value] of Object.entries(plugins as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const entries: InstalledPluginEntry[] = [];
    for (const item of value) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
      entries.push(item as InstalledPluginEntry);
    }
    if (entries.length > 0) out[key] = entries;
  }
  return out;
}

/** When null, every user-scoped install is included; otherwise only keys present and not false. */
export function readClaudeEnabledPlugins(home: string): Record<string, unknown> | null {
  const settingsPath = path.join(home, '.claude', 'settings.json');
  let content: string;
  try {
    content = fs.readFileSync(settingsPath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (!Object.hasOwn(parsed, 'enabledPlugins')) return null;
    const enabled = parsed.enabledPlugins;
    if (enabled === null || typeof enabled !== 'object' || Array.isArray(enabled)) return null;
    return enabled as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function claudePluginsRegistryPath(home: string): string {
  const env = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR;
  const pluginsRoot = env && env.length > 0 ? env : path.join(home, '.claude', 'plugins');
  return path.join(pluginsRoot, 'installed_plugins.json');
}

function isAbsoluteDirectory(absPath: string): boolean {
  if (!path.isAbsolute(absPath)) return false;
  try {
    return fs.statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

function installHasClaudePluginManifest(absInstallPath: string): boolean {
  try {
    return fs.statSync(path.join(absInstallPath, CLAUDE_PLUGIN_MANIFEST)).isFile();
  } catch {
    return false;
  }
}

function listPluginHarnessFiles(absRoot: string): string[] {
  const found: string[] = [];
  const walk = (absDir: string, relPrefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => compareLexically(a.name, b.name));
    for (const entry of entries) {
      const rel = relPrefix === '' ? entry.name : `${relPrefix}/${entry.name}`;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        found.push(rel.split(path.sep).join('/'));
      }
    }
  };
  walk(absRoot, '');
  return found;
}

function installHasSkillsDir(relFiles: string[]): boolean {
  return relFiles.some((file) => file === 'skills' || file.startsWith('skills/'));
}

/** Add harness files from a Claude Code plugin install directory into the overlay map. */
export function collectClaudePluginInstall(
  absInstallPath: string,
  pluginId: string,
  files: Map<string, string>,
  includeHooks: boolean,
): void {
  if (!installHasClaudePluginManifest(absInstallPath)) return;
  const relFiles = listPluginHarnessFiles(absInstallPath);
  const hasSkillsDir = installHasSkillsDir(relFiles);
  for (const rel of relFiles) {
    if (rel === 'hooks/hooks.json' && !includeHooks) continue;
    const canonical = pluginPhysicalToCanonicalForInstall(rel, 'claude-code', pluginId, hasSkillsDir);
    if (!canonical) continue;
    if (canonical === '.claude/settings.json' && files.has('.claude/settings.json')) continue;
    files.set(canonical, path.join(absInstallPath, ...rel.split('/')));
  }
}

export function shouldIncludeInstalledPlugin(
  pluginKey: string,
  entry: InstalledPluginEntry,
  enabledPlugins: Record<string, unknown> | null,
): boolean {
  if (entry.scope !== 'user') return false;
  if (typeof entry.installPath !== 'string' || !isAbsoluteDirectory(entry.installPath)) return false;
  if (enabledPlugins === null) return true;
  if (!Object.hasOwn(enabledPlugins, pluginKey)) return false;
  return enabledPlugins[pluginKey] !== false;
}
