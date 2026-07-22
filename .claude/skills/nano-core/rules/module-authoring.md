---
title: NanoModule Authoring — the Complete Contract and Reference Implementation
impact: CRITICAL
impactDescription: A module missing contract fields silently loses commands, events, or intents; this rule is the exhaustive surface a module can implement.
tags: module, NanoModule, commands, events, components, tasks, cooldown, defer, autocomplete, intents, healthCheck, onEnable, onDisable, nano-tui, synapse, embed-styler, authoring, plugin
---

A module is a plain object default-exported from its entry file.
`modules/synapse/index.ts` exercises EVERY surface below — copy it.
Modules may use ANY license (core is MPL-2.0); declare it.

## The full contract (src/lib/types/nano-module.ts)

```typescript
const MODULE: NanoModule = {
  name: 'my-module',            // unique kebab-case (the install key)
  version: '0.1.0',
  description: 'One line.',
  license: 'MIT',

  commands: [{
    data: new SlashCommandBuilder()...,   // anything with name + toJSON
    cooldown: { scope: 'user', delay_ms: 5000, limit: 2 },  // optional
    defer: true,                // or 'ephemeral' — dispatcher defers
                                // immediately; handler MUST use
                                // editReply/followUp afterwards
    async execute(interaction) {},        // union type: slash + context menu;
                                          // narrow with isChatInputCommand()
    async autocomplete(interaction) {},   // optional; respond() <3s, never reply
  }],

  events: [{
    name: 'guildMemberAdd',     // discord.js event name
    once: false,                // optional
    intents: ['GuildMembers'],  // REQUIRED when the event needs an
                                // intent — the core derives the Client
                                // intent set from these declarations
    execute(...args) {},
  }],

  components: {                 // customId routing `my-module:<action>:...args`
    rescan(interaction, args) {},   // buttons, selects, modals
  },

  tasks: {                      // named handlers; persistent scheduler
    remind(payload) {},         // one-shots re-arm through these on boot
  },

  onEnable(bot) {},             // registration (when enabled) + /module enable
  onDisable(bot) {},            // /module disable + removal
  healthCheck(bot) {            // feeds /module health and /synapse vitals
    return { status: 'healthy' };    // healthy | degraded | down
  },
};
export default MODULE;
```

## What modules import

From `@ccs-devhub/nano-core` (inside this repo: the `@/` aliases):

| Need | Import |
|---|---|
| Server data (plain ids -> JSON) | `getGuildSnapshot`, `listChannels`, `listRoles`, `listMembers`, `sendMessage`, ... from `@/api/*` |
| Styled embeds | `buildEmbed(spec, theme?)`, `successEmbed/errorEmbed/infoEmbed`; register palettes with `registerTheme` in `onEnable` |
| Components | `buttonRow`, `selectRow`, `buildModal`, `confirmRow` (auto module:action ids), `paginate(interaction, pages)` |
| Services at runtime | `interaction.client.services` — cooldowns, scheduler, cache (`.namespace(name)`), lifecycle (`getHealth`), database |
| Logging | `getModuleLogger('my-module')` |
| Persisted settings | `getModuleConfig/setModuleConfig` (the TUI panel writes here too) |

Database: prefix tables `mod_<name>_*`, ship drizzle-kit migrations,
register with `database.runModuleMigrations(name, migrations_dir)`.

## TUI panel (optional, declarative only)

Ship `nano-tui.json` next to the entry file:
`{ "title": "...", "fields": [{ "key", "label", "type":
"text|secret|number|boolean|select", "options?", "default?",
"help?" }] }`. The TUI validates and renders it; module CODE never
runs in the TUI process. Values persist under
`module_config.<name>` in nano.config.json.

## What the registry enforces

- Unique module names (duplicate register is an error) and unique
  command names (duplicates skipped with a warning).
- Disabled module: events gated, commands answer "disabled module",
  components refuse, tasks unresolvable — but listeners stay bound.
- Import failure of an external module: logged and skipped, never
  fatal to the bot.
- The `nano` kernel is protected: cannot disable or remove.

## Distribution and lifecycle

- Develop locally in `modules/<name>/` + a `./modules/<name>` entry
  in nano.config.json.
- Release as an npm package or GitHub repo (tag `v<version>`).
- Store validation: PR to the nano-store registry (one entry per PR,
  SUBMISSIONS.md checklist). Until then users need
  `--allow-external`.
- After enable/disable at runtime: `/module sync` refreshes slash
  commands.
