import { execSync } from 'node:child_process';

import { auditCommands, deleteAllCommands, syncCommands } from
  '@/misc/utility/command-sync.js';
import type { ModuleEntry } from '@/registry/nano-config.js';
import {
  loadConfig,
  moduleEntryName,
  moduleEntrySpec,
  removeModuleEntry,
  setModuleState
} from '@/registry/nano-config.js';
import { ansiColor, getStyle } from '@/registry/nano-style.js';
import type { DoctorCheck } from '@/services/doctor.js';
import { collectCommandDefinitions, runDoctor } from
  '@/services/doctor.js';
import type { OutdatedModule } from '@/store/installer.js';
import {
  installExternal,
  installFromStore,
  listOutdated,
  updateModule
} from '@/store/installer.js';
import { StoreClient } from '@/store/store-client.js';

import 'dotenv/config';

/**
 * The nano-core module manager CLI (`npm run module -- <command>`).
 * `install` resolves the curated store like package-install resolves
 * MELPA; `add` handles local paths and unreviewed externals (which
 * demand --allow-external after reading the risk warning).
 */
const USAGE = `Usage: npm run module -- <command> [target] [flags]

Commands:
  doctor               Check every layer the bot depends on
  commands             Audit slash-command registration: local
                       definitions vs the guild and global scopes
  install <name>       Install a validated module from the nano-store
  add <spec>           Add a local path (./modules/x) or external npm
                       package (unreviewed externals need
                       --allow-external)
  search [text]        Browse the store (optionally filtered)
  outdated             List store modules with newer validated versions
  update <name>        Re-install a store module at its latest version
  remove <entry>       Unregister (and npm uninstall) a module entry
  enable <name>        Re-enable a disabled module
  disable <name>       Disable a module without removing it
  list                 Show configured module entries and state

Flags:
  --refresh            Bypass the store cache
  --allow-external     Confirm the unreviewed-module risk warning
  --sync               (commands) Force re-register the active scope
  --clean-global       (commands) Delete every global command
`;

function createStore(): StoreClient {
  const CONFIG = loadConfig();
  return new StoreClient({
    registry_url: CONFIG.store.registry_url,
    cache_ttl_hours: CONFIG.store.cache_ttl_hours,
  });
}

function isLocalEntry(entry: string): boolean {
  return entry.startsWith('.') || entry.startsWith('/');
}

async function installCommand(name: string): Promise<void> {
  const RESULT = await installFromStore(createStore(), name);

  if (!RESULT.ok) {
    process.stdout.write(`[ERROR] ${RESULT.error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `:: Installed '${RESULT.data.name}'@${RESULT.data.version} ` +
    'from the store (validated module).\n'
  );
}

function addCommand(spec: string, allow_external: boolean): void {
  const RESULT = installExternal(spec, allow_external);

  if (!RESULT.ok) {
    process.stdout.write(`[ERROR] ${RESULT.error}\n`);
    process.exitCode = 1;
    return;
  }

  const TAG = RESULT.data.trusted ? '' : ' [external — unreviewed]';
  process.stdout.write(
    `:: Module entry '${RESULT.data.spec}' registered${TAG}.\n`
  );
}

async function searchCommand(text?: string): Promise<void> {
  const RESULT = await createStore().search(text);

  if (!RESULT.ok) {
    process.stdout.write(`[ERROR] ${RESULT.error}\n`);
    process.exitCode = 1;
    return;
  }

  if (RESULT.data.length === 0) {
    process.stdout.write(':: No store modules match.\n');
    return;
  }

  for (const _module of RESULT.data) {
    const KIND_TAG = _module.kind ? ` [${_module.kind}]` : '';
    process.stdout.write(
      `  ${_module.name}@${_module.version}${KIND_TAG} — ` +
      `${_module.description} ` +
      `(by ${_module.author}, validated ${_module.validated_at})\n`
    );
  }
}

async function outdatedCommand(): Promise<void> {
  const RESULT = await listOutdated(createStore());

  if (!RESULT.ok) {
    process.stdout.write(`[ERROR] ${RESULT.error}\n`);
    process.exitCode = 1;
    return;
  }

  if (RESULT.data.length === 0) {
    process.stdout.write(':: Every store module is up to date.\n');
    return;
  }

  for (const _entry of RESULT.data as OutdatedModule[]) {
    process.stdout.write(
      `  ${_entry.name}: ${_entry.installed} -> ${_entry.latest}\n`
    );
  }
}

async function updateCommand(name: string): Promise<void> {
  const RESULT = await updateModule(createStore(), name);

  if (!RESULT.ok) {
    process.stdout.write(`[ERROR] ${RESULT.error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `:: Updated '${RESULT.data.name}' to ${RESULT.data.version}.\n`
  );
}

function removeCommand(entry: string): void {
  const CONFIG = loadConfig();
  const MATCH = CONFIG.modules.find((item: ModuleEntry): boolean => {
    return moduleEntrySpec(item) === entry ||
      moduleEntryName(item) === entry;
  });
  const REMOVED = removeModuleEntry(entry);

  if (!REMOVED) {
    process.stdout.write(`[ERROR] Entry '${entry}' is not registered.\n`);
    process.exitCode = 1;
    return;
  }

  const SPEC = MATCH ? moduleEntrySpec(MATCH) : entry;

  if (!isLocalEntry(SPEC)) {
    execSync(`npm uninstall ${SPEC}`, { stdio: 'inherit' });
  }

  process.stdout.write(`:: Module entry '${entry}' removed.\n`);
}

function toggleCommand(module_name: string, enabled: boolean): void {
  setModuleState(module_name, enabled);
  const STATE = enabled ? 'enabled' : 'disabled';
  process.stdout.write(`:: Module '${module_name}' ${STATE}.\n`);
}

const NAME_COLUMN = 12;
const ANSI_RESET = '\u001b[0m';
const ANSI_BOLD = '\u001b[1m';
const ANSI_DIM = '\u001b[2m';

function paint(code: string, text: string): string {
  return process.stdout.isTTY ? `${code}${text}${ANSI_RESET}` : text;
}

async function doctorCommand(): Promise<void> {
  const STYLE = getStyle();
  process.stdout.write(
    `\n${paint(ANSI_BOLD + ansiColor(STYLE.palette.primary),
      '▍ nano-core doctor')}\n\n`
  );
  const CHECKS = await runDoctor();
  let failures = 0;

  for (const _check of CHECKS as DoctorCheck[]) {
    if (!_check.ok) {
      failures += 1;
    }

    const DOT = paint(
      ansiColor(_check.ok ? STYLE.palette.success : STYLE.palette.error),
      '●'
    );
    process.stdout.write(
      `  ${DOT} ${_check.name.padEnd(NAME_COLUMN)} ` +
      `${paint(ANSI_DIM, _check.detail)}\n`
    );
  }

  process.stdout.write(
    failures === 0
      ? `\n  ${paint(ansiColor(STYLE.palette.success), '●')} all checks ` +
        'passed — run the bot with: npm run dev\n\n'
      : `\n  ${paint(ansiColor(STYLE.palette.error), '●')} ${failures} ` +
        'check(s) failed — fix them before running the bot\n\n'
  );

  process.stdout.write(
    `  ${paint(ansiColor(STYLE.palette.primary), '▣')} ` +
    `${paint(ANSI_DIM, 'Cyber Code Syndicate (CCS)')}\n\n`
  );

  if (failures > 0) {
    process.exitCode = 1;
  }
}

async function commandsCommand(flags: string[]): Promise<void> {
  const STYLE = getStyle();
  const CONFIG = loadConfig();
  const TOKEN = process.env.DISCORD_TOKEN;
  const CLIENT_ID = process.env.CLIENT_ID;

  if (!TOKEN || !CLIENT_ID) {
    process.stdout.write(
      '[ERROR] DISCORD_TOKEN and CLIENT_ID must be set (.env).\n'
    );
    process.exitCode = 1;
    return;
  }

  const LOCAL = await collectCommandDefinitions(CONFIG);
  const OPTIONS = {
    token: TOKEN,
    client_id: CLIENT_ID,
    guild_id: CONFIG.bot.dev_guild_id,
  };

  if (flags.includes('--clean-global')) {
    const CLEANED = await deleteAllCommands({
      token: TOKEN,
      client_id: CLIENT_ID,
    });

    if (!CLEANED.ok) {
      process.stdout.write(`[ERROR] ${CLEANED.error}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      ':: Global scope cleared — guild commands are untouched.\n'
    );
  }

  if (flags.includes('--sync')) {
    const SYNCED = await syncCommands(LOCAL, { ...OPTIONS, force: true });

    if (!SYNCED.ok) {
      process.stdout.write(`[ERROR] ${SYNCED.error}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `:: Registered ${SYNCED.data.count} command(s) ` +
      `(${SYNCED.data.scope} scope).\n`
    );
  }

  const AUDIT = await auditCommands(LOCAL, OPTIONS);

  if (!AUDIT.ok) {
    process.stdout.write(`[ERROR] ${AUDIT.error}\n`);
    process.exitCode = 1;
    return;
  }

  const REPORT = AUDIT.data;
  const GOOD = paint(ansiColor(STYLE.palette.success), '●');
  const BAD = paint(ansiColor(STYLE.palette.error), '●');
  const SCOPE_LABEL = REPORT.scope === 'guild'
    ? `guild ${CONFIG.bot.dev_guild_id}`
    : 'global';
  const ISSUES = [
    REPORT.missing.length > 0
      ? `missing: ${REPORT.missing.join(', ')}`
      : null,
    REPORT.extra.length > 0
      ? `stale: ${REPORT.extra.join(', ')}`
      : null,
  ].filter(Boolean);
  process.stdout.write(
    `\n${paint(ANSI_BOLD + ansiColor(STYLE.palette.primary),
      '▍ slash commands')}\n\n`
  );
  process.stdout.write(
    `  · ${'scope'.padEnd(NAME_COLUMN)} ` +
    `${paint(ANSI_DIM, SCOPE_LABEL)}\n`
  );
  process.stdout.write(
    `  · ${'local'.padEnd(NAME_COLUMN)} ` +
    `${paint(ANSI_DIM,
      `${REPORT.local.length} — ${REPORT.local.join(', ')}`)}\n`
  );
  let registered_detail = `${REPORT.registered.length} — in sync`;

  if (!REPORT.in_sync) {
    registered_detail = ISSUES.length > 0
      ? ISSUES.join('; ')
      : 'definitions drifted — re-register with --sync';
  }

  process.stdout.write(
    `  ${REPORT.in_sync ? GOOD : BAD} ` +
    `${'registered'.padEnd(NAME_COLUMN)} ` +
    `${paint(ANSI_DIM, registered_detail)}\n`
  );

  if (REPORT.scope === 'guild') {
    const STALE = REPORT.stale_global;
    process.stdout.write(
      `  ${STALE.length === 0 ? GOOD : BAD} ` +
      `${'global'.padEnd(NAME_COLUMN)} ` +
      `${paint(ANSI_DIM, STALE.length === 0
        ? 'clean — no stale global commands'
        : `${STALE.length} stale: ${STALE.join(', ')} — remove with ` +
          '--clean-global')}\n`
    );
  }
  process.stdout.write('\n');
}

function listCommand(): void {
  const CONFIG = loadConfig();

  if (CONFIG.modules.length === 0) {
    process.stdout.write(':: No external module entries configured.\n');
  }

  for (const _entry of CONFIG.modules) {
    const NAME = moduleEntryName(_entry);
    const DETAIL = typeof _entry === 'string'
      ? ''
      : ` [${_entry.source}${_entry.trusted === false ? ', unreviewed' : ''}` +
        `${_entry.version ? `, v${_entry.version}` : ''}]`;
    const STATE = CONFIG.disabled.includes(NAME) ? ' (disabled)' : '';
    process.stdout.write(`  - ${moduleEntrySpec(_entry)}${DETAIL}${STATE}\n`);
  }
}

const ARGV_COMMAND_OFFSET = 2;

async function main(): Promise<void> {
  const ARGS = process.argv.slice(ARGV_COMMAND_OFFSET);
  const FLAGS = ARGS.filter((arg: string): boolean => {
    return arg.startsWith('--');
  });
  const [COMMAND, TARGET] = ARGS.filter((arg: string): boolean => {
    return !arg.startsWith('--');
  });
  const ALLOW_EXTERNAL = FLAGS.includes('--allow-external');
  const STORE_COMMANDS = ['install', 'search', 'outdated', 'update'];

  if (FLAGS.includes('--refresh') && STORE_COMMANDS.includes(COMMAND)) {
    /* Force-refetch once; later calls read the fresh cache. */
    await createStore().getRegistry(true);
  }

  if (COMMAND === 'doctor') {
    await doctorCommand();
    return;
  }

  if (COMMAND === 'commands') {
    await commandsCommand(FLAGS);
    return;
  }

  if (COMMAND === 'list') {
    listCommand();
    return;
  }

  if (COMMAND === 'search') {
    await searchCommand(TARGET);
    return;
  }

  if (COMMAND === 'outdated') {
    await outdatedCommand();
    return;
  }

  if (!COMMAND || !TARGET) {
    process.stdout.write(USAGE);
    return;
  }

  if (COMMAND === 'install') {
    await installCommand(TARGET);
    return;
  }

  if (COMMAND === 'add') {
    addCommand(TARGET, ALLOW_EXTERNAL);
    return;
  }

  if (COMMAND === 'update') {
    await updateCommand(TARGET);
    return;
  }

  if (COMMAND === 'remove') {
    removeCommand(TARGET);
    return;
  }

  if (COMMAND === 'enable' || COMMAND === 'disable') {
    toggleCommand(TARGET, COMMAND === 'enable');
    return;
  }

  process.stdout.write(USAGE);
}

await main();
