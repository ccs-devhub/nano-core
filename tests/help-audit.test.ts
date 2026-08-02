import { resolve } from 'node:path';

import type {
  SlashCommandSubcommandBuilder,
  SlashCommandSubcommandGroupBuilder
} from 'discord.js';
import {
  SlashCommandBuilder
} from 'discord.js';
import { describe, expect, it } from 'vitest';

import { createKernelModule } from '@/core/kernel/index.js';
import {
  auditCommandHelp,
  auditModuleHelp,
  subcommandPaths
} from '@/misc/utility/help-audit.js';
import { loadCoreModule } from '@/registry/module-loader.js';
import type { NanoCommand, NanoModule } from '@/types/nano-module.js';

const MIN_CORE_COMMANDS = 5;

function makeCommand(overrides: Partial<NanoCommand>): NanoCommand {
  return {
    data: new SlashCommandBuilder()
      .setName('sample')
      .setDescription('A sample command.'),
    execute: async (): Promise<void> => {
      return;
    },
    ...overrides,
  };
}

function makeGroupedCommand(): NanoCommand {
  const DATA = new SlashCommandBuilder()
    .setName('grouped')
    .setDescription('A command with subcommands.')
    .addSubcommand((sub: SlashCommandSubcommandBuilder):
    SlashCommandSubcommandBuilder => {
      return sub.setName('list').setDescription('List things.');
    })
    .addSubcommandGroup((group: SlashCommandSubcommandGroupBuilder):
    SlashCommandSubcommandGroupBuilder => {
      return group.setName('item')
        .setDescription('Item operations.')
        .addSubcommand((sub: SlashCommandSubcommandBuilder):
        SlashCommandSubcommandBuilder => {
          return sub.setName('add').setDescription('Add an item.');
        });
    });

  return makeCommand({ data: DATA });
}

describe('subcommandPaths', (): void => {
  it('returns nothing for a flat command', (): void => {
    expect(subcommandPaths(makeCommand({}))).toEqual([]);
  });

  it('lists plain and group-nested subcommand paths', (): void => {
    expect(subcommandPaths(makeGroupedCommand()))
      .toEqual(['list', 'item add']);
  });
});

describe('auditCommandHelp', (): void => {
  it('accepts a complete flat command', (): void => {
    const COMMAND = makeCommand({
      help: {
        long: 'Does the sample thing.',
        usage: '/sample',
        examples: ['/sample'],
      },
    });

    expect(auditCommandHelp(COMMAND)).toEqual([]);
  });

  it('flags missing help metadata', (): void => {
    expect(auditCommandHelp(makeCommand({})))
      .toEqual(['/sample: help metadata is missing']);
  });

  it('flags empty long, usage and examples', (): void => {
    const COMMAND = makeCommand({
      help: { long: ' ', usage: '', examples: ['  '] },
    });
    const VIOLATIONS = auditCommandHelp(COMMAND);

    expect(VIOLATIONS).toContain('/sample: help.long is empty');
    expect(VIOLATIONS).toContain('/sample: help.usage is empty');
    expect(VIOLATIONS).toContain(
      '/sample: help.examples needs at least one example'
    );
  });

  it('flags an empty subcommand-card long', (): void => {
    const COMMAND = makeGroupedCommand();
    COMMAND.help = {
      long: 'Grouped operations.',
      usage: '/grouped <list|item add>',
      examples: ['/grouped list'],
      subcommands: {
        'list': { long: '', usage: '/grouped list', examples: ['ok'] },
        'item add': {
          long: 'x',
          usage: '/grouped item add',
          examples: ['ok'],
        },
      },
    };

    expect(auditCommandHelp(COMMAND))
      .toContain('/grouped list: help.long is empty');
  });

  it('demands one card per declared subcommand path', (): void => {
    const COMMAND = makeGroupedCommand();
    COMMAND.help = {
      long: 'Grouped operations.',
      usage: '/grouped <list|item add>',
      examples: ['/grouped list'],
      subcommands: {
        list: { long: 'x', usage: '/grouped list', examples: ['ok'] },
      },
    };

    expect(auditCommandHelp(COMMAND))
      .toEqual(['/grouped item add: subcommand help card is missing']);
  });

  it('flags help cards without a matching subcommand', (): void => {
    const COMMAND = makeGroupedCommand();
    COMMAND.help = {
      long: 'Grouped operations.',
      usage: '/grouped <list|item add>',
      examples: ['/grouped list'],
      subcommands: {
        'list': { usage: '/grouped list', examples: ['ok'], long: 'x' },
        'item add': {
          usage: '/grouped item add',
          examples: ['ok'],
          long: 'x',
        },
        'gone': { usage: '/grouped gone', examples: ['ok'], long: 'x' },
      },
    };

    expect(auditCommandHelp(COMMAND))
      .toEqual(['/grouped gone: help card has no matching subcommand']);
  });
});

describe('auditModuleHelp', (): void => {
  it('checks module description, events and tasks', (): void => {
    const MODULE: NanoModule = {
      name: 'm',
      version: '0.0.0',
      events: [{
        name: 'messageCreate',
        execute: (): void => {
          return;
        },
      }],
      tasks: {
        bare: (): void => {
          return;
        },
        described: {
          description: 'Ticks the sample counter.',
          run: (): void => {
            return;
          },
        },
      },
    };
    const VIOLATIONS = auditModuleHelp(MODULE);

    expect(VIOLATIONS).toContain('module m: description is empty');
    expect(VIOLATIONS).toContain('event messageCreate: description is empty');
    expect(VIOLATIONS).toContain('task bare: description is empty');
    expect(VIOLATIONS).not.toContain('task described: description is empty');
  });
});

describe('the help completeness gate over the shipped modules', (): void => {
  it('kernel module passes', (): void => {
    expect(auditModuleHelp(createKernelModule())).toEqual([]);
  });

  it('core module passes for every registered command', async ():
  Promise<void> => {
    const CORE = await loadCoreModule(resolve('src'));

    /* loadModules skips files that fail to import — the count bound
       makes a silent load failure fail the gate loudly. */
    expect((CORE.commands ?? []).length)
      .toBeGreaterThanOrEqual(MIN_CORE_COMMANDS);
    expect(auditModuleHelp(CORE)).toEqual([]);
  });
});
