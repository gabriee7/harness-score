import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_CONFIG,
  loadConfigFile,
  PRESET_REGISTRY,
  PROTECTED_CHECKS,
  parseConfigObject,
  parseScopeFlagList,
  resolveScanConfig,
  resolveSeverities,
} from '../src/config.js';

describe('parseConfigObject', () => {
  test('accepts defaults when keys are omitted', () => {
    expect(parseConfigObject({}, 'test')).toEqual(DEFAULT_CONFIG);
  });

  test('rejects unknown top-level keys', () => {
    expect(() => parseConfigObject({ unknown: true }, 'test')).toThrow(/unknown key/);
  });

  test('rejects unknown scopes keys', () => {
    expect(() => parseConfigObject({ scopes: { repo: true } }, 'test')).toThrow(/unknown scopes key/);
  });

  test('parses scopes and gate', () => {
    expect(
      parseConfigObject(
        {
          scopes: { user: true, system: false },
          gate: 'effective',
          extraRoots: [{ id: 'team', path: '../shared' }],
        },
        'test',
      ),
    ).toEqual({
      scopes: { user: true, system: false },
      extraRoots: [{ id: 'team', path: '../shared' }],
      gate: 'effective',
      extends: [],
      rules: {},
    });
  });

  test('accepts a known preset in extends', () => {
    expect(parseConfigObject({ extends: ['no-hooks'] }, 'test').extends).toEqual(['no-hooks']);
  });

  test('rejects an unknown preset name', () => {
    expect(() => parseConfigObject({ extends: ['does-not-exist'] }, 'test')).toThrow(/unknown preset/);
  });

  test('accepts off/error severities in rules', () => {
    const parsed = parseConfigObject({ rules: { 'HKS-01': 'off', 'HYG-05': 'error' } }, 'test');
    expect(parsed.rules).toEqual({ 'HKS-01': 'off', 'HYG-05': 'error' });
  });

  test('rejects an unknown check ID in rules', () => {
    expect(() => parseConfigObject({ rules: { 'NOPE-01': 'off' } }, 'test')).toThrow(/unknown check ID/);
  });

  test('rejects "warn" severity with a clear "not supported yet" message', () => {
    expect(() => parseConfigObject({ rules: { 'HKS-01': 'warn' } }, 'test')).toThrow(/not supported yet/);
  });

  test('rejects an invalid severity string', () => {
    expect(() => parseConfigObject({ rules: { 'HKS-01': 'disabled' } }, 'test')).toThrow(
      /severity must be "off" or "error"/,
    );
  });

  test.each([...PROTECTED_CHECKS])('rejects turning off protected check %s', (checkId) => {
    expect(() => parseConfigObject({ rules: { [checkId]: 'off' } }, 'test')).toThrow(
      /can never be set to "off"/,
    );
  });

  test('a protected check can still be set to "error" explicitly (a no-op, but not rejected)', () => {
    const [checkId] = [...PROTECTED_CHECKS];
    expect(parseConfigObject({ rules: { [checkId!]: 'error' } }, 'test').rules).toEqual({
      [checkId!]: 'error',
    });
  });
});

describe('PRESET_REGISTRY never waives a protected check', () => {
  test('no built-in preset sets a protected check to "off"', () => {
    for (const [name, preset] of Object.entries(PRESET_REGISTRY)) {
      for (const checkId of PROTECTED_CHECKS) {
        expect(preset[checkId], `${name} preset must not exclude ${checkId}`).not.toBe('off');
      }
    }
  });
});

describe('resolveSeverities', () => {
  test('defaults every check to error/default', () => {
    const resolved = resolveSeverities({ extends: [], rules: {} });
    expect(resolved.get('HKS-01')).toEqual({ severity: 'error', source: 'default' });
  });

  test('applies a preset from extends', () => {
    const resolved = resolveSeverities({ extends: ['no-hooks'], rules: {} });
    expect(resolved.get('HKS-01')).toEqual({ severity: 'off', source: 'extends:no-hooks' });
    expect(resolved.get('HKS-05')).toEqual({ severity: 'off', source: 'extends:no-hooks' });
    // A dimension untouched by the preset stays at the default.
    expect(resolved.get('HYG-01')).toEqual({ severity: 'error', source: 'default' });
  });

  test('local rules take precedence over extends', () => {
    const resolved = resolveSeverities({ extends: ['no-hooks'], rules: { 'HKS-01': 'error' } });
    expect(resolved.get('HKS-01')).toEqual({ severity: 'error', source: 'rules' });
    // Everything else the preset touched stays overridden.
    expect(resolved.get('HKS-02')).toEqual({ severity: 'off', source: 'extends:no-hooks' });
  });
});

describe('resolveScanConfig precedence', () => {
  test('CLI scope flags override config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-cfg-'));
    const configPath = path.join(dir, '.harness-score.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ scopes: { user: true, system: true }, gate: 'effective' }),
      'utf8',
    );
    const resolved = resolveScanConfig(dir, {
      configPath,
      scopeFlags: [],
      gate: null,
    });
    expect(resolved.scopes.user).toBe(false);
    expect(resolved.scopes.system).toBe(false);
    expect(resolved.gate).toBe('effective');
    expect(resolved.effectiveScopes).toEqual(['repo']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('CLI gate overrides config file gate', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-cfg-'));
    fs.writeFileSync(path.join(dir, '.harness-score.json'), JSON.stringify({ gate: 'effective' }), 'utf8');
    const resolved = resolveScanConfig(dir, { gate: 'maturity' });
    expect(resolved.gate).toBe('maturity');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('parseScopeFlagList', () => {
  test('parses comma-separated scopes', () => {
    expect(parseScopeFlagList('user,system')).toEqual(['user', 'system']);
  });

  test('rejects unknown scope names', () => {
    expect(() => parseScopeFlagList('repo')).toThrow(/unknown scope/);
  });
});

describe('loadConfigFile', () => {
  test('loads valid JSON from disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-cfg-'));
    const file = path.join(dir, '.harness-score.json');
    fs.writeFileSync(file, JSON.stringify({ scopes: { user: true, system: false } }), 'utf8');
    expect(loadConfigFile(file).scopes.user).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('throws when JSON is invalid', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-cfg-'));
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, '{not json', 'utf8');
    expect(() => loadConfigFile(file)).toThrow(/could not read\/parse/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('resolveScanConfig extra roots', () => {
  test('adds extra root ids to effectiveScopes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-cfg-'));
    fs.writeFileSync(
      path.join(dir, '.harness-score.json'),
      JSON.stringify({ extraRoots: [{ id: 'team-shared', path: '../shared' }] }),
      'utf8',
    );
    const resolved = resolveScanConfig(dir);
    expect(resolved.effectiveScopes).toEqual(['repo', 'team-shared']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
