import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROLES_CONFIG_SCHEMA, ROLES_CONFIG_VERSION } from './config.js';
import {
  TEXT_ROLES_DB_REQUIRED,
  TEXT_ROLES_HEALTH_NO_DB,
  TEXT_ROLES_HEALTH_READY
} from './constants.js';

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

function healthCheck(bot: Client): NanoHealthReport {
  if (!bot.services.database) {
    return { status: 'down', details: TEXT_ROLES_HEALTH_NO_DB };
  }
  return { status: 'healthy', details: TEXT_ROLES_HEALTH_READY };
}

const MODULE: NanoModule = {
  name: MODULE_NAME,
  version: '0.1.0',
  license: 'MIT',
  description:
    'Role panels, derivation rules, divider sync, snapshots and ' +
    'rejoin restore for any server.',
  onEnable,
  healthCheck,
};

export default MODULE;
