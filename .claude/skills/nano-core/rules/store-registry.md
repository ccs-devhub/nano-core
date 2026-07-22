---
title: nano-store Registry and Install Flows — Curation, Pinning, and the Trust Boundary
impact: HIGH
impactDescription: Wrong flows here either break the MELPA-style trust model (unreviewed code installed silently) or the pinning guarantees (unpinned versions defeating review).
tags: store, registry, nano-store, install, update, outdated, provenance, trusted, external, risk-warning, melpa, curation, npm, github, cli, StoreClient, installer
---

The store is ONE curated `registry.json` in the `ccs-devhub/nano-store`
repo (scaffolded as a sibling folder to this repo until pushed). Only
owner-merged entries appear; `module install <name>` resolves it like
Emacs `package-install` resolves MELPA.

## Registry entry schema (nano-store/registry.schema.json)

| Field | Meaning |
|---|---|
| `name` | unique kebab-case install key |
| `description`, `author`, `license` | display metadata |
| `source` | `npm` (needs `package`) or `github` (needs `repo` owner/name) |
| `version` | EXACT reviewed version (github: tag `v<version>` must exist) |
| `commit` | optional SHA pin for github sources (verified after clone) |
| `min_core` | minimum NANO_VERSION (loose numeric compare) |
| `validated_at` | the date THIS version was reviewed — the whole claim |

Curation flow: PR adds/bumps one entry; CI validates against the JSON
schema + duplicate names; owner merge = validated. Entry removal is
the kill switch (installed copies unaffected; `outdated` reports
"removed from store").

## Client behavior (src/lib/store/store-client.ts)

- `getRegistry(refresh?)`: fresh cache (`.nano/store-cache.json`,
  TTL `store.cache_ttl_hours`, default 24h) -> network
  (`store.registry_url` from nano.config.json) -> STALE cache when
  offline (with a warning). zod-validated; invalid registry is an
  error, not a crash.
- `resolve(name)`: exact match; near-miss names suggested in the
  error. `search(text)`: name/description/tags.
- `checkMinCore(min, NANO_VERSION)`: dotted-numeric compare;
  non-numeric passes open.

## Install flows (src/lib/store/installer.ts)

- `installFromStore`: resolve -> min_core gate -> `npm install
  pkg@version` (pinned) or `git clone --depth 1 --branch v<version>`
  into `modules/<name>` with commit-pin verification (mismatch
  deletes the clone and aborts) -> provenance upsert in
  nano.config.json:
  `{name, source: 'store', spec, version, installed_at, trusted: true}`.
- `installExternal(spec, confirmed)`: local paths (`./x`) install
  freely (`trusted: true`, source `local`); npm specs REFUSE until
  confirmed with the risk warning (`EXTERNAL_RISK_WARNING` — names
  real capabilities: token, guilds, filesystem, network) and record
  `trusted: false`, source `external`.
- `listOutdated` / `updateModule`: registry-version diff; update
  re-installs the current validated version. NEVER auto-update.
- Bare-string config entries remain valid everywhere
  (`moduleEntrySpec`/`moduleEntryName` normalize).
- Injectable deps for tests: `{exec, root, now}` — never spawn real
  npm/git in tests.

## CLI surface (npm run module -- ...)

| Command | Behavior |
|---|---|
| `install <name>` | store install (validated) |
| `add <spec>` | local path, or external npm with `--allow-external` |
| `search [text]` | browse store |
| `outdated` / `update <name>` | version drift / pinned update |
| `remove <entry>` | unregister + npm uninstall when applicable |
| `enable/disable <name>` | persisted in `disabled[]` |
| `list` | entries with provenance + UNREVIEWED tags |
| `--refresh` | bypass the registry cache |

## Trust model (state it honestly)

Exact-version pinning + per-version `validated_at` + lockfile/SHA
integrity + loud opt-in for unreviewed code. The store claims "this
exact version was reviewed on this date" — never ongoing supervision.
