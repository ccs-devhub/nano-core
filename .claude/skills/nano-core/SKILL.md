---
name: nano-core
description: >-
  Development guide for the nano-core Discord bot framework (this repo,
  github.com/ccs-devhub/nano-core): a discord.js v14 modular core where
  the framework provides ALL general bot connections (lifecycle,
  loaders, interaction dispatcher, services, database, store, TUI) and
  product features live in installable NanoModules. Use for ANY work in
  this repo: writing or reviewing core code, authoring or fixing a
  NanoModule (commands, events, components, tasks, cooldowns, intents,
  healthCheck, nano-tui.json panels), the synapse or embed-styler
  modules, the nano-store curated registry and install flows, the Ink
  v6 TUI (views, Form, module panels), core services (lifecycle,
  logger, scheduler, cooldown, permission, cache, database, errors),
  the kernel dispatcher and customId routing, command REST sync,
  nano.config.json, or the CLI (npm run module). Enforces: NanoResult
  envelopes, the ESLint casing matrix, @/ path aliases, no emojis,
  connections-not-features, owner-only git writes.
metadata:
  author: Cristian D. Moreno - Kyonax (CCS)
  version: "1.0.0"
---

# nano-core Development Skill

nano-core is the "body" of a Discord bot — arms, legs, eyes, ears —
with zero product features. Modules plug into it like packages into a
Linux install. Every contribution must keep the core general, typed,
lint-clean, and AI-consumable (plain ids in, plain JSON out, NanoResult
everywhere).

## Hard laws (apply to every task, always)

- NEVER run git write operations (commit, push, tag, merge, reset,
  clean, gh pr create). The owner commits manually.
- No emojis in code, docs, output, or commit text.
- Done means verified: `npm run lint` (0 problems), `npm run build`,
  `npx vitest run` all green.
- The core gains connections, never features (no moderation, economy,
  dashboards, translations, entity caches, REST queues).

## When to Read Which Rules

| If working on... | Read |
|---|---|
| ANY code in this repo (first read for every task) | `rules/conventions.md` |
| Understanding or changing the core layout, boot order, services, kernel, registry | `rules/architecture.md` |
| Creating or editing a module (commands/events/components/tasks/health/panels), synapse, embed-styler | `rules/module-authoring.md` |
| The nano-store registry, install/update flows, trust model, CLI module commands | `rules/store-registry.md` |
| The Ink TUI: views, Form, ToggleList, nano-tui.json panels, TTY fallback | `rules/tui.md` |

## Quick Reference

| Rule | Description |
|---|---|
| `conventions` | The ESLint casing matrix, NanoResult law, @/ aliases with .js specifiers, structural rules, verification commands, git prohibition. |
| `architecture` | The full repo map (services, registry, kernel, api, store, tui), boot order in src/index.ts, the do-not-build list, extension points. |
| `module-authoring` | The complete NanoModule contract with every optional surface, the synapse reference, discovery/loading, registry enforcement, distribution paths. |
| `store-registry` | registry.json schema, StoreClient caching, installFromStore pinning, external risk warning, outdated/update, nano-store repo layout. |
| `tui` | Ink v6 stack decisions, view/component structure, the declarative panel security rule, conventions delta for src/tui. |
