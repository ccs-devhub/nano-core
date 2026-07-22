---
title: Core Architecture Map — Layers, Boot Order, Services, and Extension Points
impact: HIGH
impactDescription: Prevents misplaced code (features in core, services bypassed, duplicate listeners) and wrong boot-order changes that break intent derivation or persistence.
tags: architecture, services, lifecycle, scheduler, cooldown, permission, cache, database, drizzle, sqlite, logger, pino, errors, kernel, dispatcher, registry, loader, intents, boot, index, barrel
---

## Repo map

| Path | Layer |
|---|---|
| `src/index.ts` | Composition root: the ONLY place services are wired |
| `src/core/kernel/` | Protected `nano` module: interaction dispatcher, client-ready, `/module` manager command |
| `src/core/commands|events/` | Folder-scanned `core` module (drop-in files) |
| `src/lib/types/` | Contracts: nano-module, nano-result, nano-services, nano-tui, discord-augment (Client.commands/.nano/.services) |
| `src/lib/registry/` | ModuleRegistry, module-loader, nano-config (zod) |
| `src/lib/services/` | lifecycle, logger, scheduler, cooldown, permission, cache, database, errors |
| `src/lib/api/` | Plain-ids discord.js wrappers: guild, channel, role, member, message, embed+theme, component, paginate |
| `src/lib/store/` | StoreClient + installer (see store-registry rule) |
| `src/lib/misc/utility/` | custom-id, command-sync, resolve-intents, format, register-global-commands |
| `src/lib/index.ts` | The npm barrel (package main) — every new public symbol gets exported here |
| `src/cli/nano-cli.ts` | `npm run module -- <cmd>` |
| `src/tui/` | Ink TUI (see tui rule) |
| `modules/` | In-repo modules: synapse (reference), embed-styler |
| `tests/` | vitest suites, one per subsystem |

## Boot order in src/index.ts (do not reorder casually)

1. `loadConfig()` then `createLogger(config.logging)`.
2. Load ALL module DEFINITIONS first (kernel, core folder scan,
   externals from config) — pure data, no client yet.
3. `deriveIntents(config.intents, all_definitions)` — unions
   config intents with each event's declared `intents`; warns on
   privileged (GuildMembers, GuildPresences, MessageContent). The
   Client MUST be constructed after this (intents are fixed at
   construction).
4. Construct Client, `commands` Collection, services
   (DatabaseService.open, NanoScheduler + persistence adapter,
   CooldownManager, NanoCache, LifecycleManager) and attach
   `BOT.services`.
5. ModuleRegistry with `{disabled, cooldowns, onStateChange}` →
   `BOT.nano`. Process guards, lifecycle client events, signal
   handlers, shutdown tasks (scheduler stop, db close).
6. Register kernel PROTECTED, then core, then externals.
7. `rearmPersistedJobs` (scheduler one-shots from the DB, resolved
   through each module's `tasks` map).
8. `syncCommands` (diff-then-PUT; guild scope when
   `bot.dev_guild_id` set) and `LIFECYCLE.login(token)`.

## Service invariants

- Lifecycle: stable names over discord.js events; after `invalidated`
  the process must restart — never re-login the same client.
- Registry: one owner per command name; disabled modules keep
  listeners bound but gated; every listener has a disposer (no
  duplicate listeners on reload); the kernel cannot be disabled or
  removed.
- Dispatcher: ONE interactionCreate listener total. Slash/context
  gate on module state, consume cooldowns, optional immediate defer
  (`command.defer`), errors through `replyWithError` (the only
  correct replied/deferred guard). Autocomplete responds within 3s,
  never replies. Components route by `module:action:args` customIds
  (100-char limit enforced by `buildCustomId`); non-conventional ids
  stay silent (collectors own them).
- Command sync: always GET + diff before PUT (200 global
  creates/day cap); registration is never bound to clientReady.
- Database: better-sqlite3 + Drizzle (WAL, `data/nano.db` default);
  Postgres is a documented seam, not bundled. Module tables are
  `mod_<name>_*` with per-module migration journals
  `__migrations_<module>`; core NEVER auto-drops module tables
  (`purgeModuleData` is explicit).
- Cache: module-computed data only; discord.js managers already
  cache entities — expose sweeper knobs, do not duplicate.
- Cooldowns: user-facing command throttling only; @discordjs/rest
  already queues 429s.

## Extension points

New service: file in `src/lib/services/` + wire in `src/index.ts` +
add to `NanoServices` (`src/lib/types/nano-services.ts`) + export in
the barrel + test file. New API domain: file in `src/lib/api/`
returning NanoResult with plain-JSON summaries + barrel export +
tests. New config section: extend `NANO_CONFIG_SCHEMA` in
`src/lib/registry/nano-config.ts` (zod, defaults, env-secrets never
persisted).
