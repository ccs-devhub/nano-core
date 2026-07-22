import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client, Collection, version as discordjs_version } from
  'discord.js';

import { NANO_VERSION } from '@/constants/nano.js';
import { createKernelModule } from '@/core/kernel/index.js';
import { printBootBanner } from '@/misc/utility/banner.js';
import { syncCommands } from '@/misc/utility/command-sync.js';
import { deriveIntents, resolveIntents } from
  '@/misc/utility/resolve-intents.js';
import type { ExternalModule } from '@/registry/module-loader.js';
import { loadCoreModule, loadExternalModules } from
  '@/registry/module-loader.js';
import { ModuleRegistry } from '@/registry/module-registry.js';
import { loadConfig, setModuleState } from '@/registry/nano-config.js';
import { NanoCache } from '@/services/cache.js';
import { CooldownManager } from '@/services/cooldown.js';
import { DatabaseService } from '@/services/database.js';
import { installProcessGuards } from '@/services/errors.js';
import { LifecycleManager } from '@/services/lifecycle.js';
import { createLogger, getLogger } from '@/services/logger.js';
import { NanoScheduler } from '@/services/scheduler.js';
import type { NanoModule, NanoTaskHandler } from
  '@/types/nano-module.js';

import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG = loadConfig();
createLogger(CONFIG.logging);

/* Load every module DEFINITION first: intents derive from them. */
const KERNEL_MODULE = createKernelModule();
const CORE_MODULE = await loadCoreModule(__dirname);
const EXTERNAL_MODULES = await loadExternalModules(CONFIG);
const ALL_DEFINITIONS = [
  KERNEL_MODULE,
  CORE_MODULE,
  ...EXTERNAL_MODULES.map((external: ExternalModule): NanoModule => {
    return external.module;
  }),
];

const DERIVED = deriveIntents(CONFIG.intents, ALL_DEFINITIONS);

if (process.env.NANO_SKIP_BANNER !== '1') {
  printBootBanner({
    version: NANO_VERSION,
    bot_name: CONFIG.bot.name,
    node_version: process.version,
    discordjs_version,
    modules: ALL_DEFINITIONS.map((definition: NanoModule): string => {
      return definition.name;
    }),
    intents: DERIVED.names,
    database: CONFIG.database.driver,
    dev_guild_id: CONFIG.bot.dev_guild_id,
  });
}

if (DERIVED.privileged.length > 0) {
  getLogger().warn(
    `Privileged intents in use (${DERIVED.privileged.join(', ')}) — ` +
    'enable them in the developer portal or their events will never ' +
    'fire.'
  );
}

const BOT: Client = new Client({
  intents: resolveIntents(DERIVED.names),
});

BOT.commands = new Collection();

/* Services. */
const DATABASE_RESULT = DatabaseService.open(CONFIG.database);

if (!DATABASE_RESULT.ok) {
  getLogger().warn(
    { error: DATABASE_RESULT.error },
    'Database unavailable — persistence features disabled.'
  );
}

const DATABASE = DATABASE_RESULT.ok ? DATABASE_RESULT.data : null;
const SCHEDULER = new NanoScheduler();

if (DATABASE) {
  SCHEDULER.attachPersistence(DATABASE.schedulerPersistence());
}

const COOLDOWNS = new CooldownManager();
const CACHE = new NanoCache();
const LIFECYCLE = new LifecycleManager(BOT);

BOT.services = {
  cooldowns: COOLDOWNS,
  scheduler: SCHEDULER,
  cache: CACHE,
  lifecycle: LIFECYCLE,
  database: DATABASE,
};

const REGISTRY = new ModuleRegistry(BOT, {
  disabled: CONFIG.disabled,
  cooldowns: COOLDOWNS,
  onStateChange: (module_name: string, enabled: boolean): void => {
    setModuleState(module_name, enabled);
  },
});

BOT.nano = REGISTRY;

installProcessGuards({
  onFatal: (): Promise<void> => {
    return LIFECYCLE.shutdown();
  },
});
LIFECYCLE.bindClientEvents();
LIFECYCLE.installSignalHandlers();
LIFECYCLE.addShutdownTask((): void => {
  SCHEDULER.stopAll();
});

if (DATABASE) {
  LIFECYCLE.addShutdownTask((): void => {
    DATABASE.close();
  });
}

/* The kernel (dispatcher + /module manager) is protected: always on. */
await REGISTRY.register(KERNEL_MODULE, 'core', true);
await REGISTRY.register(CORE_MODULE, 'core');

for (const _external of EXTERNAL_MODULES) {
  await REGISTRY.register(_external.module, _external.origin);
}

/* Persistent one-shots survive restarts. */
const REARMED = SCHEDULER.rearmPersistedJobs(
  (module_id: string, task_name: string): NanoTaskHandler | undefined => {
    return REGISTRY.getTask(module_id, task_name);
  }
);

if (REARMED > 0) {
  getLogger().info(`Re-armed ${REARMED} persisted job(s)`);
}

const TOKEN: string | undefined = process.env.DISCORD_TOKEN;
const CLIENT_ID: string | undefined = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  getLogger().error(
    'DISCORD_TOKEN or CLIENT_ID is missing — skipping command ' +
    'registration.'
  );
} else {
  const SYNC = await syncCommands(REGISTRY.enabledCommands(), {
    token: TOKEN,
    client_id: CLIENT_ID,
    guild_id: CONFIG.bot.dev_guild_id,
  });

  if (!SYNC.ok) {
    getLogger().error({ error: SYNC.error }, 'Command sync failed');
  }
}

if (TOKEN) {
  const LOGIN = await LIFECYCLE.login(TOKEN);

  if (!LOGIN.ok) {
    getLogger().fatal({ error: LOGIN.error }, 'Login failed — exiting.');
    await LIFECYCLE.shutdown();
    process.exit(1);
  }
} else {
  getLogger().error('No token provided — bot login skipped.');
}
