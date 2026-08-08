import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * `npm run module -- scaffold <name>` — a BORN-GATED module: the
 * generated checkout carries the descriptor (languages + about +
 * the reserved enabled switch), a command with its full help card,
 * a provides sample, and a test suite that already runs the
 * dashboard audit, the keys==schema==surfaces pin, and the help
 * bijection. Templates mirror the modules/roles conventions (the
 * reference cartridge).
 */
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const JSON_INDENT = 2;

function pkgJson(name: string): string {
  return `${JSON.stringify({
    name: `@ccs-devhub/nano-module-${name}`,
    version: '0.1.0',
    description:
      `A NanoModule for nano-core. TODO: describe ${name}.`,
    license: 'MIT',
    type: 'module',
    main: 'index.ts',
    scripts: {
      lint: 'eslint .',
      'lint:fix': 'eslint . --fix',
      check: 'tsc -p tsconfig.json',
      test: 'vitest',
    },
    peerDependencies: {
      '@ccs-devhub/nano-core': '>=0.4.0',
    },
    peerDependenciesMeta: {
      '@ccs-devhub/nano-core': { optional: true },
    },
    devDependencies: {
      '@ccs-devhub/nano-core': 'file:../..',
      '@eslint/js': '^9.39.2',
      'discord.js': 'file:../../node_modules/discord.js',
      eslint: '^9.39.2',
      'typescript-eslint': '^8.46.4',
      typescript: '^5.9.3',
      'vite-tsconfig-paths': '^5.1.4',
      vitest: '^4.0.16',
      zod: 'file:../../node_modules/zod',
    },
  }, null, JSON_INDENT)}\n`;
}

function tsconfigJson(name: string): string {
  return `${JSON.stringify({
    compilerOptions: {
      baseUrl: '.',
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      paths: { [`@modules/${name}/*`]: ['./*'] },
      types: ['node'],
    },
    include: ['*.ts', 'tests'],
    exclude: ['node_modules', 'dist'],
  }, null, JSON_INDENT)}\n`;
}

const VITEST_CONFIG = `import tsconfig_paths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfig_paths({ projects: ['./tsconfig.json'] })],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
`;

const ESLINT_CONFIG = `import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * The module lint floor: recommended rules plus THE IMPORT LAW —
 * a module reaches the host ONLY through the bare barrel. Extend
 * toward the roles config (the reference) as the module grows.
 */
export default [
  { ignores: ['node_modules/**', 'dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['../*'], message: 'No escaping the module.' },
          {
            group: ['@ccs-devhub/nano-core/*'],
            message: 'Only the bare barrel.',
          },
        ],
      }],
    },
  },
];
`;

function configTs(name: string): string {
  const CONST = name.replace(/-/g, '_').toUpperCase();
  return `import { z } from 'zod';

/** Every key needs a default — {} MUST parse complete. */
export const ${CONST}_CONFIG_SCHEMA = z.object({
  enabled: z.boolean().default(true),
  greeting: z.string().nullable().default(null),
});

export type ${CONST}Config = z.infer<typeof ${CONST}_CONFIG_SCHEMA>;

export const ${CONST}_CONFIG_VERSION = 1;

/** ONE tier source — the descriptor derives from THIS map. */
export const ${CONST}_CONFIG_SURFACES = {
  enabled: 'discord',
  greeting: 'discord',
} as const;
`;
}

function indexTs(name: string): string {
  const CONST = name.replace(/-/g, '_').toUpperCase();
  return `import { ${CONST}_COMMAND } from './command.js';
import {
  ${CONST}_CONFIG_SCHEMA,
  ${CONST}_CONFIG_VERSION
} from './config.js';
import * as provides from './provides.js';

import type { Client, NanoModule } from '@ccs-devhub/nano-core';

const MODULE_NAME = '${name}';

async function onEnable(bot: Client): Promise<void> {
  bot.services.guild_store.registerSchema(MODULE_NAME, {
    schema: ${CONST}_CONFIG_SCHEMA,
    config_version: ${CONST}_CONFIG_VERSION,
  });
  provides.initProvides(bot);
}

async function onDisable(): Promise<void> {
  provides.resetProvides();
}

const MODULE: NanoModule = {
  name: MODULE_NAME,
  version: '0.1.0',
  api_version: '1',
  description: 'TODO: one line on what ${name} does.',
  commands: [${CONST}_COMMAND],
  provides: {
    ${camel(name)}Stats: provides.${camel(name)}Stats,
  },
  onEnable,
  onDisable,
};

export default MODULE;
`;
}

function camel(name: string): string {
  return name.replace(/-([a-z])/g, (whole: string, letter: string):
  string => {
    void whole;
    return letter.toUpperCase();
  });
}

function commandTs(name: string): string {
  const CONST = name.replace(/-/g, '_').toUpperCase();
  return `import { SlashCommandBuilder } from 'discord.js';

import type {
  NanoCommand,
  NanoCommandInteraction
} from '@ccs-devhub/nano-core';

/** Help cards are LAW: they feed /help, the dashboard commands
    surface, and the per-guild gates. One card per path. */
export const ${CONST}_COMMAND: NanoCommand = {
  data: new SlashCommandBuilder()
    .setName('${name}')
    .setDescription('TODO: what /${name} does.')
    .addSubcommand((sub) => {
      return sub
        .setName('status')
        .setDescription('Show the module status.');
    }),
  help: {
    long: 'TODO: the long help for /${name}.',
    usage: '/${name} status',
    examples: ['/${name} status'],
    subcommands: {
      status: {
        long: 'Shows whether the module is on and configured.',
        usage: '/${name} status',
        examples: ['/${name} status'],
      },
    },
  },
  async execute(
    interaction: NanoCommandInteraction
  ): Promise<void> {
    await interaction.reply({
      content: '${name}: ready.',
      ephemeral: true,
    });
  },
};
`;
}

function providesTs(name: string): string {
  return `import type { Client, NanoResult } from '@ccs-devhub/nano-core';
import { err, ok } from '@ccs-devhub/nano-core';

let bot_ref: Client | null = null;

export function initProvides(bot: Client): void {
  bot_ref = bot;
}

export function resetProvides(): void {
  bot_ref = null;
}

/** The {tiles} convention: labels/hints may be { en, es } maps. */
export async function ${camel(name)}Stats(
  guild_id: string
): Promise<NanoResult<{
  tiles: {
    label: Record<string, string>;
    value: number;
  }[];
}>> {
  if (!bot_ref) {
    return err('The ${name} module is not enabled.');
  }

  void guild_id;
  return ok({
    tiles: [
      {
        label: { en: 'ready', es: 'listo' },
        value: 1,
      },
    ],
  });
}
`;
}

function descriptorJson(name: string): string {
  const TITLE = name.charAt(0).toUpperCase() + name.slice(1);
  return `${JSON.stringify({
    title: { en: TITLE, es: TITLE },
    languages: ['en', 'es'],
    about: {
      description: {
        en: `TODO: what **${name}** does, in one paragraph.`,
        es: `TODO: qué hace **${name}**, en un párrafo.`,
      },
      commands: [
        {
          name: `/${name} status`,
          help: {
            en: 'Show the module status.',
            es: 'Muestra el estado del módulo.',
          },
        },
      ],
    },
    api_version: '1',
    config_version: 1,
    config: {
      fields: [
        {
          key: 'enabled',
          label: { en: 'Module enabled', es: 'Módulo activado' },
          type: 'boolean',
          tier: 'discord',
          help: {
            en: 'Turns this module on or off for this server.',
            es: 'Enciende o apaga este módulo para este servidor.',
          },
        },
        {
          key: 'greeting',
          label: { en: 'Greeting', es: 'Saludo' },
          type: 'text',
          tier: 'discord',
          help: {
            en: 'TODO: what this setting changes.',
            es: 'TODO: qué cambia esta opción.',
          },
        },
      ],
    },
    data: [
      {
        id: 'stats',
        title: { en: 'At a glance', es: 'De un vistazo' },
        provides: `${camel(name)}Stats`,
        help: {
          en: 'Live counters for this module.',
          es: 'Contadores en vivo de este módulo.',
        },
      },
    ],
  }, null, JSON_INDENT)}\n`;
}

function dashboardTestTs(name: string): string {
  const CONST = name.replace(/-/g, '_').toUpperCase();
  return `import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  auditDashboardDescriptor,
  NANO_DASHBOARD_MANIFEST_SCHEMA
} from '@ccs-devhub/nano-core';
import {
  ${CONST}_CONFIG_SCHEMA,
  ${CONST}_CONFIG_SURFACES
} from '@modules/${name}/config.js';
import module_def from '@modules/${name}/index.js';

import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW: unknown = JSON.parse(
  readFileSync(join(ROOT, 'nano-dashboard.json'), 'utf8')
);

describe('${name} nano-dashboard.json (born-gated)', (): void => {
  it('passes the full dashboard audit', (): void => {
    const REPORT = auditDashboardDescriptor(ROOT, module_def);

    expect(REPORT.issues).toEqual([]);
    expect(REPORT.ok).toBe(true);
  });

  it('covers every config key with tiers from the surfaces map',
    (): void => {
      const PARSED = NANO_DASHBOARD_MANIFEST_SCHEMA.parse(RAW);
      const FIELD_KEYS = PARSED.config.fields
        .map((field): string => {
          return field.key;
        })
        .sort();

      expect(FIELD_KEYS)
        .toEqual(Object.keys(${CONST}_CONFIG_SCHEMA.shape).sort());
      expect(FIELD_KEYS)
        .toEqual(Object.keys(${CONST}_CONFIG_SURFACES).sort());

      for (const _field of PARSED.config.fields) {
        expect(_field.tier ?? 'discord').toBe(
          ${CONST}_CONFIG_SURFACES[
            _field.key as keyof typeof ${CONST}_CONFIG_SURFACES
          ]
        );
      }
    });

  it('parses a complete config from nothing (defaults law)', ():
  void => {
    expect(${CONST}_CONFIG_SCHEMA.safeParse({}).success).toBe(true);
  });
});
`;
}

function readmeOrg(name: string): string {
  return `#+TITLE: nano-module-${name}

TODO: the quickstart. The agent recipes live in ${name}.ai.org;
the dashboard authoring contract in the host's
docs/web-dashboard.ai.org.
`;
}

function aiOrg(name: string): string {
  return `#+TITLE: nano-module-${name} — AI OPERATING RECIPES

AUDIENCE: AI agents. This module's specifics only — the dashboard
authoring contract lives in the host's docs/web-dashboard.ai.org;
modules/roles is the platform's worked reference.

* AS SCAFFOLDED

Born-gated: the test suite already runs the dashboard audit, the
keys==schema==surfaces pin, and the defaults law. Extend, never
remove, those gates.

* EXTENDING

- New command path :: builder subcommand + a help card at the same
  path key + an about.commands signature tag + both languages.
- New config key :: zod default + surfaces tier + descriptor field
  with { en, es } help — the pins fail until all copies agree.
- New provides :: export + register in index.ts; NanoResult;
  (guild_id, params?, context{actor_id}?); expensive reads declare
  manual + cooldown_s in the descriptor.
`;
}

export function scaffoldModule(
  name: string,
  root: string = process.cwd()
): { ok: boolean; message: string } {
  if (!NAME_PATTERN.test(name)) {
    return {
      ok: false,
      message: `Bad module name '${name}' — lowercase, digits, ` +
        'hyphens, starting with a letter.',
    };
  }

  const DIR = resolve(root, 'modules', name);

  if (existsSync(DIR)) {
    return {
      ok: false,
      message: `'modules/${name}' already exists — refusing to ` +
        'overwrite.',
    };
  }

  mkdirSync(join(DIR, 'tests'), { recursive: true });
  mkdirSync(join(DIR, 'nano-dashboard-assets'), { recursive: true });

  const FILES: [string, string][] = [
    ['package.json', pkgJson(name)],
    ['tsconfig.json', tsconfigJson(name)],
    ['vitest.config.ts', VITEST_CONFIG],
    ['eslint.config.mjs', ESLINT_CONFIG],
    ['config.ts', configTs(name)],
    ['index.ts', indexTs(name)],
    ['command.ts', commandTs(name)],
    ['provides.ts', providesTs(name)],
    ['nano-dashboard.json', descriptorJson(name)],
    ['nano-dashboard-assets/.gitkeep', ''],
    [`tests/${name}-dashboard.test.ts`, dashboardTestTs(name)],
    ['README.org', readmeOrg(name)],
    [`${name}.ai.org`, aiOrg(name)],
    ['.gitignore', 'node_modules/\n.drafts/\n'],
  ];

  for (const [_file, _content] of FILES) {
    writeFileSync(join(DIR, _file), _content);
  }
  return {
    ok: true,
    message: `Scaffolded modules/${name} (${FILES.length} files, ` +
      'born-gated). Next: npm install inside it, then register ' +
      `with npm run module -- add ./modules/${name}`,
  };
}
