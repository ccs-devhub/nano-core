import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ROLES_QUEUE,
  ROLES_SUPPRESSION
} from './apply-role-change.js';
import { ROLES_COMMAND } from './command.js';
import { ROLES_CONFIG_SCHEMA, ROLES_CONFIG_VERSION } from './config.js';
import {
  ROLES_VERSION,
  TEXT_ROLES_DB_REQUIRED,
  TEXT_ROLES_HEALTH_NO_DB,
  TEXT_ROLES_HEALTH_READY
} from './constants.js';
import type { ReactionLike, UserLike } from './events.js';
import { handleReactionEvent, pickComponent } from './events.js';
import { countBrokenPanels } from './panels.js';
import type { MemberLike } from './rule-runtime.js';
import {
  handleMemberUpdate,
  resetRuleRuntime,
  ruleLevelBlindCount
} from './rule-runtime.js';

import type {
  Client,
  NanoHealthReport,
  NanoModule
} from '@ccs-devhub/nano-core';
import { getModuleLogger } from '@ccs-devhub/nano-core';

/**
 * roles — role automation for any server: self-pick panels,
 * derivation rules, divider sync, snapshots and rejoin restore.
 * P2 of the module plan; this scaffold ships the storage layer
 * (tables + guild config schema) that every later surface uses.
 * License: MIT (modules may use any license).
 */
const MODULE_NAME = 'roles';
const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'migrations'
);

async function onEnable(bot: Client): Promise<void> {
  const DATABASE = bot.services.database;

  /* DB6: fail fast without storage — the throw lands this module
     disabled (N5) while the rest of the bot boots on. */
  if (!DATABASE) {
    throw new Error(TEXT_ROLES_DB_REQUIRED);
  }

  const MIGRATED = DATABASE.runModuleMigrations(
    MODULE_NAME,
    MIGRATIONS_DIR
  );

  if (!MIGRATED.ok) {
    throw new Error(MIGRATED.error);
  }

  bot.services.guild_store.registerSchema(MODULE_NAME, {
    schema: ROLES_CONFIG_SCHEMA,
    config_version: ROLES_CONFIG_VERSION,
  });
  getModuleLogger(MODULE_NAME).info(
    { migrations: MIGRATIONS_DIR },
    'Roles storage ready — tables migrated, config schema registered'
  );
}

function onDisable(): void {
  /* PF17: module-owned state leaves with the module. */
  ROLES_QUEUE.clear();
  ROLES_SUPPRESSION.clear();
  resetRuleRuntime();
}

function healthCheck(bot: Client): NanoHealthReport {
  const DATABASE = bot.services.database;

  if (!DATABASE) {
    return { status: 'down', details: TEXT_ROLES_HEALTH_NO_DB };
  }

  const BROKEN = countBrokenPanels(DATABASE.getDb());
  const BLIND = ruleLevelBlindCount();
  const METRICS = {
    queue_keys: ROLES_QUEUE.size(),
    suppression_entries: ROLES_SUPPRESSION.size(),
    broken_panels: BROKEN,
    level_blind_rules: BLIND,
  };
  const PROBLEMS: string[] = [];

  if (BROKEN > 0) {
    /* B12: a vanished panel message degrades, never hides. */
    PROBLEMS.push(
      `${BROKEN} panel(s) lost their message, run refresh.`
    );
  }

  if (BLIND > 0) {
    /* N13: a level rule ran without the leveling module. */
    PROBLEMS.push(
      `level rules ran blind ${BLIND} time(s), the leveling ` +
      'module is absent.'
    );
  }

  if (PROBLEMS.length > 0) {
    return {
      status: 'degraded',
      details: PROBLEMS.join(' '),
      metrics: METRICS,
    };
  }
  return {
    status: 'healthy',
    details: TEXT_ROLES_HEALTH_READY,
    metrics: METRICS,
  };
}

const MODULE: NanoModule = {
  name: MODULE_NAME,
  version: ROLES_VERSION,
  license: 'MIT',
  description:
    'Role panels, derivation rules, divider sync, snapshots and ' +
    'rejoin restore for any server.',
  commands: [ROLES_COMMAND],
  events: [
    {
      name: 'messageReactionAdd',
      description:
        'Grants a panel role when a mapped reaction is added.',
      intents: ['GuildMessageReactions'],
      partials: ['Message', 'Reaction', 'User'],
      execute: (...args: unknown[]): Promise<void> => {
        const REACTION = args[0] as ReactionLike & { client: Client };
        return handleReactionEvent(
          REACTION.client,
          REACTION,
          args[1] as UserLike,
          'add'
        );
      },
    },
    {
      name: 'messageReactionRemove',
      description:
        'Revokes a panel role when a mapped reaction is removed.',
      intents: ['GuildMessageReactions'],
      partials: ['Message', 'Reaction', 'User'],
      execute: (...args: unknown[]): Promise<void> => {
        const REACTION = args[0] as ReactionLike & { client: Client };
        return handleReactionEvent(
          REACTION.client,
          REACTION,
          args[1] as UserLike,
          'remove'
        );
      },
    },
    {
      name: 'guildMemberUpdate',
      description:
        'Adopts external role changes into the ledger and re-runs ' +
        'the derivation rules for that member.',
      intents: ['GuildMembers'],
      execute: (...args: unknown[]): Promise<void> => {
        const MEMBER = args[1] as MemberLike & { client: Client };
        return handleMemberUpdate(MEMBER.client, MEMBER);
      },
    },
  ],

  components: { pick: pickComponent },

  onEnable,
  onDisable,
  healthCheck,
};

export default MODULE;
