---
title: Ink TUI — Structure, the Declarative Panel Security Rule, and the Conventions Delta
impact: HIGH
impactDescription: Keeps React quarantined from the bot runtime, module panels data-only (no code execution), and TUI code inside its relaxed-but-bounded lint zone.
tags: tui, ink, react, fullscreen, views, dashboard, config, modules, store, logs, module-panel, form, toggle-list, nano-tui, manifest, clack, tty, ui
---

`npm run ui` opens the full-screen management window (opencode-style).
It is a CONFIG SURFACE: it reads/writes nano.config.json and talks to
the store — the bot process runs separately (`npm run dev`).

## Locked stack decisions

- Ink v6 + @inkjs/ui + fullscreen-ink + React 19 on Node >= 20.
- OpenTUI (opencode's own stack) rejected: needs Bun or Node 26
  experimental FFI. Go Bubble Tea rejected: second toolchain.
- @clack/prompts renders the non-TTY fallback (guard:
  `process.stdout.isTTY && process.stdin.isTTY`).
- React is QUARANTINED in `src/tui/`: nothing under `src/` outside
  it may import react/ink; the bot runtime never loads them.

## Design language (minimal/futuristic)

One outer frame only (app shell, `tui.border_style`); interior
borderless. Sections = accent `▍` + lowercase title (`Window`
component with optional `trailing` node). Sidebar = dim right rule;
status bar = single dim line. Glyphs: `●` ok/fail (`StatusDot`), `○`
idle, braille `Spinner` (components/spinner.tsx) for every loading
state. Views (keys 1-7): dashboard, config, modules, store, commands,
run, logs; `?` help.

## The Run view (in-TUI task runner)

`views/run.tsx` + `state/runner.ts`. `RUNNER_TASKS`: doctor + store
(in-process), lint/build/test (spawned via `runCommand` — ANSI-strip,
line streaming, 200-line bounded log, exit code decides `●` state,
elapsed seconds shown). Doctor renders `DoctorCheck[]` as a glyph
checklist. One task at a time.

## Structure (src/tui/)

| File | Role |
|---|---|
| `index.tsx` | entry: TTY guard -> `withFullScreen(<App/>)`; clack fallback otherwise |
| `app.tsx` | providers + shell (Sidebar / content / StatusBar); global keys 1-5 switch views, q quits |
| `router.tsx` | view context: dashboard, config, modules, store, logs, module-panel(params) |
| `state/ui-state.tsx` | `editing` flag: while a text input captures keys, global nav/quit keys are inert — every new text-input surface MUST set it |
| `state/module-rows.ts` | config -> render rows (enabled, provenance, manifest discovery) |
| `components/form.tsx` | generic `FormFieldSpec[]` renderer: j/k select, enter edit/toggle/cycle, s save. Renders BOTH the Config view and module panels |
| `components/toggle-list.tsx` | space toggles, enter opens panel |
| `views/*` | dashboard (read-only summary), config (writes nano.config.json), modules (setModuleState + panel nav), store (registry browse + install), logs (tails `logging.file`) |

## The panel security rule (never weaken)

Module panels are DATA: `nano-tui.json` manifests validated by
`NANO_TUI_MANIFEST_SCHEMA` (`src/lib/types/nano-tui.ts`) and rendered
by the shared Form. Field types: text, secret, number, boolean,
select. Values persist to `module_config.<name>` via
`setModuleConfig`. NO module code executes in the TUI process, ever.
Manifest discovery: `<module-dir>/nano-tui.json` for local entries,
`node_modules/<pkg>/nano-tui.json` for npm entries.

## Styling rule (nano.style.toml)

Colors, palettes, logo paths, logo max width, banner and TUI layout
thresholds ALL live in `nano.style.toml` (root), parsed with smol-toml
and zod-validated in `src/lib/registry/nano-style.ts`. Access via
`getStyle()` / `getLogoLines()` / `ansiColor()` (module-level cache;
`resetStyleCache()` in tests). Never hardcode colors or size
thresholds in banner or TUI code. Default artwork is the small logo
`.github/logo-nano-core-small.txt` (18x35); `@/constants/logo.js`
embeds both sizes as fallbacks because npm packages ship only dist/.

## Secrets rule

DISCORD_TOKEN / CLIENT_ID are environment-only. The Config view shows
an instruction, never an input that persists a token to JSON.

## Conventions delta (eslint override for src/tui/**)

Relaxed: casing (PascalCase components/consts), parameter typedefs,
padding-line rule, import-plugin export-map rules (fullscreen-ink's
exports map breaks the legacy resolver). Still enforced: 80 cols,
single quotes, explicit return types (`ReactElement`), no emojis,
kebab-case filenames.

## Verification

`npx vitest run tests/tui.test.tsx` (ink-testing-library `render`,
`lastFrame()`, `stdin.write` with ~10ms sleeps between keys);
`npm run ui </dev/null` exercises the fallback; manual `npm run ui`
needs a real terminal.
