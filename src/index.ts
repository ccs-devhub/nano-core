import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client, Collection, version as discordjs_version } from
  'discord.js';

import { EXIT_CODE_LOGIN_FAILED, NANO_VERSION } from
  '@/constants/nano.js';
import { createKernelModule } from '@/core/kernel/index.js';
import { printBootBanner } from '@/misc/utility/banner.js';
import { syncCommands } from '@/misc/utility/command-sync.js';
import {
  deriveIntents,
  derivePartials,
  listPortalDisabledIntents,
  resolveIntents,
  resolvePartials
} from '@/misc/utility/resolve-intents.js';
import { resolveCacheOptions, resolveSharding } from
  '@/misc/utility/scale-options.js';
import type { ExternalModule } from '@/registry/module-loader.js';
import { loadCoreModule, loadExternalModules } from
  '@/registry/module-loader.js';
import { ModuleRegistry } from '@/registry/module-registry.js';
import { loadConfig, setModuleState } from '@/registry/nano-config.js';
import { NanoCache } from '@/services/cache.js';
import { CooldownManager } from '@/services/cooldown.js';
import { DatabaseService } from '@/services/database.js';
import { installProcessGuards } from '@/services/errors.js';
import { GuildStore } from '@/services/guild-store.js';
import { LifecycleManager } from '@/services/lifecycle.js';
import { createLogger, getLogger } from '@/services/logger.js';
import { ReconcileRunner } from '@/services/reconcile.js';
import { NanoScheduler } from '@/services/scheduler.js';
import { VitalsService } from '@/services/vitals.js';
import type { NanoModule } from '@/types/nano-module.js';

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
  /* Only warn when the portal toggle is actually missing. */
  const PORTAL = await listPortalDisabledIntents(
    DERIVED.privileged,
    process.env.DISCORD_TOKEN ?? ''
  );

  if (PORTAL.ok && PORTAL.data.length > 0) {
    getLogger().warn(
      'Privileged intent(s) OFF in the developer portal ' +
      `(${PORTAL.data.join(', ')}) — login will fail or their events ` +
      'will never fire. Enable them: Developer Portal > Bot > ' +
      'Privileged Gateway Intents.'
    );
  } else if (!PORTAL.ok) {
    getLogger().warn(
      `Privileged intents in use (${DERIVED.privileged.join(', ')}) — ` +
      'could not verify the developer-portal toggles ' +
      `(${PORTAL.error})`
    );
  }
}

const DERIVED_PARTIALS = derivePartials(CONFIG.partials, ALL_DEFINITIONS);

if (DERIVED_PARTIALS.names.length > 0) {
  /* N11: partials are a GLOBAL blast radius — once one module
     declares them, every module's listeners get partial objects. */
  const REPORT = {
    partials: DERIVED_PARTIALS.names,
    declared_by: DERIVED_PARTIALS.declaring,
    undeclared_modules: DERIVED_PARTIALS.silent,
  };

  if (DERIVED_PARTIALS.silent.length > 0) {
    getLogger().warn(
      REPORT,
      'Partials active — EVERY module listener receives partial ' +
      'objects; the undeclared modules must also be partial-safe.'
    );
  } else {
    getLogger().info(REPORT, 'Partials active');
  }
}

/* S1 seam: the fleet model is the shard manager — one shard per
   container; env SHARD_ID/SHARD_COUNT override the config block. */
const SHARDING_RESULT = resolveSharding(CONFIG.sharding);

if (!SHARDING_RESULT.ok) {
  getLogger().warn(
    'Sharding config unusable — booting unsharded: ' +
    `${SHARDING_RESULT.error}`
  );
}

const SHARDING = SHARDING_RESULT.ok ? SHARDING_RESULT.data : null;
/* S2: capped entity caches — RSS grows with cached members. */
const CACHE_OPTIONS = resolveCacheOptions(CONFIG.caching);

const BOT: Client = new Client({
  intents: resolveIntents(DERIVED.names),
  partials: resolvePartials(DERIVED_PARTIALS.names),
  makeCache: CACHE_OPTIONS.make_cache,
  sweepers: CACHE_OPTIONS.sweepers,
  ...(SHARDING
    ? { shards: [SHARDING.shard_id], shardCount: SHARDING.shard_count }
    : {}),
});

if (SHARDING) {
  getLogger().info(
    `Gateway shard ${SHARDING.shard_id} of ${SHARDING.shard_count}`
  );
}

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
const CACHE = new NanoCache({ max: CONFIG.nano_cache_max });
const LIFECYCLE = new LifecycleManager(BOT);
const GUILD_STORE = new GuildStore(
  DATABASE ? DATABASE.guildConfigPersistence() : null,
  CACHE
);

const VITALS = new VitalsService({
  bot: BOT,
  bot_name: CONFIG.bot.name,
  version: NANO_VERSION,
  database: DATABASE,
  scheduler: SCHEDULER,
  sharding: SHARDING,
});

const REGISTRY = new ModuleRegistry(BOT, {
  disabled: CONFIG.disabled,
  cooldowns: COOLDOWNS,
  onStateChange: (module_name: string, enabled: boolean): void => {
    setModuleState(module_name, enabled);

    /* N3: a runtime enable catches up through the same runner. */
    if (enabled) {
      void RECONCILE.run('enable', { module_name });
    }
  },
});

BOT.nano = REGISTRY;

const MS_PER_DAY = 86400000;
const RECONCILE = new ReconcileRunner({
  bot: BOT,
  registry: REGISTRY,
  scheduler: SCHEDULER,
  database: DATABASE,
  max_lookback_ms: CONFIG.reconcile.max_lookback_d * MS_PER_DAY,
});

BOT.services = {
  cooldowns: COOLDOWNS,
  scheduler: SCHEDULER,
  cache: CACHE,
  lifecycle: LIFECYCLE,
  database: DATABASE,
  guild_store: GUILD_STORE,
  vitals: VITALS,
  reconcile: RECONCILE,
};

installProcessGuards({
  onFatal: (): Promise<void> => {
    return LIFECYCLE.shutdown();
  },
});
LIFECYCLE.bindClientEvents();
LIFECYCLE.installSignalHandlers();
/* Shutdown runs LIFO: the DB close is registered FIRST so it runs
   LAST — the scheduler must stop while the DB is still open. */
if (DATABASE) {
  LIFECYCLE.addShutdownTask((): void => {
    DATABASE.close();
  });
}

LIFECYCLE.addShutdownTask((): void => {
  SCHEDULER.stopAll();
});

/* P8 V2: the heartbeat rides an unref'd timer — observability never
   keeps the process alive or decides restarts (exit-driven, N15). */
VITALS.startHeartbeat(CONFIG.observability.heartbeat_interval_s);
LIFECYCLE.addShutdownTask((): void => {
  VITALS.stopHeartbeat();
});

/* The kernel (dispatcher + /module manager) is protected: always on. */
await REGISTRY.register(KERNEL_MODULE, 'core', true);
await REGISTRY.register(CORE_MODULE, 'core');

for (const _external of EXTERNAL_MODULES) {
  await REGISTRY.register(_external.module, _external.origin);
}

/* PF6: persisted one-shots re-arm at ClientReady inside the boot
   reconcile pass — never against a logged-out client. */

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
    process.exit(EXIT_CODE_LOGIN_FAILED);
  }
} else {
  getLogger().error('No token provided — bot login skipped.');
}
