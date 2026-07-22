---
title: Code Conventions — the ESLint Casing Matrix, NanoResult Law, and Verification Gates
impact: CRITICAL
impactDescription: Violations fail the strict ESLint config or tsc build immediately; code written without these conventions cannot land.
tags: conventions, eslint, naming, casing, snake_case, UPPER_CASE, camelCase, kebab-case, NanoResult, aliases, imports, no-emoji, git, verification, lint, build, test
---

Every file in this repo is governed by a strict ESLint config
(eslint.config.mjs) with zero-tolerance CI expectations. Write
compliant code on the first pass using this matrix.

## The casing matrix (@typescript-eslint/naming-convention)

| Thing | Format | Example |
|---|---|---|
| Functions, methods | camelCase | `loadConfig`, `getModuleLogger` |
| const (single word or no lowercase-snake tail) | UPPER_CASE | `const CONFIG`, `const REGISTRY` |
| const with embedded lowercase snake tail | snake_case allowed | `const entry_path` |
| const/loop var with leading underscore | free form | `for (const _entry of ...)` |
| let variables, parameters | snake_case | `module_name`, `guild_id` |
| Types, interfaces, classes, enums | PascalCase | `ModuleRegistry`, `NanoResult` |
| Filenames | kebab-case | `module-registry.ts` |
| Object/type properties | free form | API payload keys stay as-is |

Practical recipe: name locals either `UPPER_CASE` or `_prefixed`;
name multi-word locals `snake_case`; never single-word lowercase
consts (`const guild` fails — use `const GUILD`).

## Structural rules

- Explicit return types on EVERY function including arrow callbacks:
  `(role: Role): string => { return role.id; }`. Parameters always
  typed (`@typescript-eslint/typedef`).
- `arrow-body-style: always` — every arrow needs braces + `return`.
- `curly: all`, `no-else-return`, `eqeqeq`, `prefer-template`.
- Max line 80. Two-space indent. Single quotes. Multiline
  comma-dangle on arrays/objects; never on imports/functions.
- Magic numbers get named consts (`const MS_PER_HOUR = 3600000`) —
  only 0, 1, -1 are free.
- No `console.*`: CLI paths use `process.stdout.write`; everything
  else uses the pino logger (`getModuleLogger(module_id)` from
  `@/services/logger.js`).
- Imports: NO parent-relative (`../`) — use aliases: `@/api/*`,
  `@/registry/*`, `@/services/*`, `@/store/*`, `@/types/*`,
  `@/misc/*`, `@/constants/*`, and `@/*` for anything under src/.
  NodeNext resolution: specifiers end in `.js` even importing TS.
  `import type` is a separate statement (consistent-type-imports).
  simple-import-sort orders: node: builtins, external packages, `@/`
  aliases, side-effect imports, relative.
- EXCEPTION zone `src/tui/**` (and `tests/**/*.tsx`): PascalCase
  functions/consts allowed (React), parameter typedefs off,
  import-plugin export-map rules off. Nothing else is relaxed.

## The NanoResult law

Every fallible public operation returns
`NanoResult<T> = { ok: true, data: T } | { ok: false, error: string }`
from `@/types/nano-result.js` (`ok()`, `err()`, `runSafe()`).
Never throw across a public API boundary. Public surfaces take plain
ids (strings) and return plain-JSON summaries so AI/MCP consumers can
drive them without discord.js knowledge.

## Hard prohibitions

- NO git write operations ever: commit, push, tag, merge, rebase,
  reset --hard, clean, branch -D, gh pr create/merge. Read-only git
  (status, diff, log, clone) is fine. The owner commits.
- NO emojis anywhere.
- NO features in core: moderation, leveling, economy, music, welcome
  flows, dashboards, translations, entity caches, REST rate-limit
  queues (discord.js handles caching and 429s) — those are modules.

## Verification gates (a task is not done until all pass)

```
npm run lint        # eslint . — must print nothing (0 problems)
npm run build       # tsc -p tsconfig.build.json — strict, declarations
npx vitest run      # full suite green
timeout 30 npx tsx src/index.ts   # smoke boot without token: modules
                                  # register, login skips gracefully
```
