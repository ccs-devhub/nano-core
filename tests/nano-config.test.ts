import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  addModuleEntry,
  defaultConfig,
  loadConfig,
  removeModuleEntry,
  saveConfig,
  setModuleState
} from '@/registry/nano-config.js';

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'nano-config-'));
}

describe('nano-config', (): void => {
  it('returns defaults when no config file exists', (): void => {
    expect(loadConfig(createTempRoot())).toEqual(defaultConfig());
  });

  it('round-trips a saved config', (): void => {
    const ROOT = createTempRoot();
    const CONFIG = {
      ...defaultConfig(),
      intents: ['Guilds', 'GuildMessages'],
      modules: ['@scope/nano-module-x', './modules/local'],
      disabled: ['local'],
    };

    saveConfig(CONFIG, ROOT);

    expect(loadConfig(ROOT)).toEqual(CONFIG);
  });

  it('persists module enable/disable state', (): void => {
    const ROOT = createTempRoot();

    setModuleState('mod-a', false, ROOT);
    expect(loadConfig(ROOT).disabled).toEqual(['mod-a']);

    setModuleState('mod-a', false, ROOT);
    expect(loadConfig(ROOT).disabled).toEqual(['mod-a']);

    setModuleState('mod-a', true, ROOT);
    expect(loadConfig(ROOT).disabled).toEqual([]);
  });

  it('adds and removes module entries once', (): void => {
    const ROOT = createTempRoot();

    expect(addModuleEntry('./modules/x', ROOT)).toBe(true);
    expect(addModuleEntry('./modules/x', ROOT)).toBe(false);
    expect(loadConfig(ROOT).modules).toEqual(['./modules/x']);

    expect(removeModuleEntry('./modules/x', ROOT)).toBe(true);
    expect(removeModuleEntry('./modules/x', ROOT)).toBe(false);
    expect(loadConfig(ROOT).modules).toEqual([]);
  });
});
