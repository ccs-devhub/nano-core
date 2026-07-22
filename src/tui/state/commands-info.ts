import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createKernelModule } from '@/core/kernel/index.js';
import type { ExternalModule } from '@/registry/module-loader.js';
import { loadCoreModule, loadExternalModules } from
  '@/registry/module-loader.js';
import { loadConfig } from '@/registry/nano-config.js';
import type { NanoCommand, NanoModule } from '@/types/nano-module.js';

/**
 * Render-ready view of every slash command the bot would register:
 * owning module, description, subcommands, cooldown and defer flags.
 * Loads module DEFINITIONS only — no client, no gateway.
 */
export interface SubcommandInfo {
  name: string;
  description: string;
}

export interface CommandInfo {
  module: string;
  name: string;
  description: string;
  subcommands: SubcommandInfo[];
  cooldown?: string;
  defer: boolean;
  has_autocomplete: boolean;
}

interface CommandJson {
  name?: string;
  description?: string;
  options?: { type?: number; name?: string; description?: string }[];
}

const SUBCOMMAND_TYPE = 1;
const MS_PER_SECOND = 1000;

export async function listCommandInfo(
  root: string = process.cwd()
): Promise<CommandInfo[]> {
  const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const MODULES: NanoModule[] = [
    createKernelModule(),
    await loadCoreModule(SRC_DIR),
    ...(await loadExternalModules(loadConfig(root))).map(
      (external: ExternalModule): NanoModule => {
        return external.module;
      }
    ),
  ];
  const COMMANDS: CommandInfo[] = [];

  for (const _module of MODULES) {
    for (const _command of _module.commands ?? []) {
      COMMANDS.push(toInfo(_module.name, _command));
    }
  }
  return COMMANDS;
}

function toInfo(module_name: string, command: NanoCommand): CommandInfo {
  const JSON_DATA = command.data.toJSON() as CommandJson;
  const SUBCOMMANDS = (JSON_DATA.options ?? [])
    .filter((option): boolean => {
      return option.type === SUBCOMMAND_TYPE;
    })
    .map((option): SubcommandInfo => {
      return {
        name: option.name ?? '',
        description: option.description ?? '',
      };
    });

  return {
    module: module_name,
    name: JSON_DATA.name ?? command.data.name,
    description: JSON_DATA.description ?? '',
    subcommands: SUBCOMMANDS,
    cooldown: command.cooldown
      ? `${command.cooldown.limit ?? 1}x per ` +
        `${Math.round(command.cooldown.delay_ms / MS_PER_SECOND)}s ` +
        `(${command.cooldown.scope})`
      : undefined,
    defer: Boolean(command.defer),
    has_autocomplete: typeof command.autocomplete === 'function',
  };
}
