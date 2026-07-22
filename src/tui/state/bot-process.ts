import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';

import { appendLog, sanitizeOutput, stripAnsi } from
  '@/tui/state/runner.js';

/**
 * The bot process manager behind the TUI Bot view: spawns
 * `tsx src/index.ts` exactly like `npm run dev`, streams its colored
 * log lines into a bounded buffer, tracks the lifecycle
 * (starting -> online -> stopped), and always kills the child when
 * the TUI exits. Singleton — one bot per TUI session.
 */
export type BotStatus = 'stopped' | 'starting' | 'online' | 'stopping';

export interface BotSnapshot {
  status: BotStatus;
  pid?: number;
  started_at?: number;
  exit_code?: number | null;
  log: string[];
}

let child: ChildProcess | null = null;
let restart_pending = false;
let cleanup_registered = false;
let snapshot: BotSnapshot = { status: 'stopped', log: [] };
const LISTENERS = new Set<() => void>();

function update(patch: Partial<BotSnapshot>): void {
  snapshot = { ...snapshot, ...patch };

  for (const _listener of LISTENERS) {
    _listener();
  }
}

function pushLine(line: string): void {
  update({ log: appendLog(snapshot.log, line) });
}

/** Subscribe to state changes (useSyncExternalStore contract). */
export function subscribeBot(listener: () => void): () => void {
  LISTENERS.add(listener);
  return (): void => {
    LISTENERS.delete(listener);
  };
}

export function getBotSnapshot(): BotSnapshot {
  return snapshot;
}

/** Start the bot (no-op while a child is alive). */
export function startBot(root: string = process.cwd()): void {
  if (child) {
    return;
  }

  registerCleanup();
  update({
    status: 'starting',
    log: [],
    exit_code: undefined,
    started_at: Date.now(),
  });

  /* Same entry as `npm run dev`; the banner is skipped because the
     Bot view renders its own status header. */
  child = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      FORCE_COLOR: '1',
      NANO_SKIP_BANNER: '1',
    },
  });
  update({ pid: child.pid });

  let buffer = '';
  const FLUSH = (chunk: string): void => {
    buffer += chunk;
    const LINES = buffer.split('\n');
    buffer = LINES.pop() ?? '';

    for (const _line of LINES) {
      const CLEAN = sanitizeOutput(_line).trimEnd();

      if (!stripAnsi(CLEAN).trim()) {
        continue;
      }

      pushLine(CLEAN);

      if (
        snapshot.status === 'starting' &&
        stripAnsi(CLEAN).includes('nano-core online')
      ) {
        update({ status: 'online' });
      }
    }
  };

  child.stdout?.on('data', (chunk: Buffer): void => {
    FLUSH(chunk.toString());
  });
  child.stderr?.on('data', (chunk: Buffer): void => {
    FLUSH(chunk.toString());
  });
  child.on('error', (error: Error): void => {
    pushLine(`spawn failed: ${error.message}`);
    child = null;
    update({ status: 'stopped', exit_code: 1 });
  });
  child.on('close', (code: number | null): void => {
    child = null;
    update({ status: 'stopped', exit_code: code });
    pushLine(`process exited (code ${code ?? 'unknown'})`);

    if (restart_pending) {
      restart_pending = false;
      startBot(root);
    }
  });
}

/** Graceful stop (SIGTERM — the bot shuts down cleanly). */
export function stopBot(): void {
  if (!child) {
    return;
  }

  update({ status: 'stopping' });
  child.kill('SIGTERM');
}

/** Restart: stop, then start again once the child has exited. */
export function restartBot(): void {
  if (!child) {
    startBot();
    return;
  }

  restart_pending = true;
  stopBot();
}

function registerCleanup(): void {
  if (cleanup_registered) {
    return;
  }
  cleanup_registered = true;

  process.on('exit', (): void => {
    child?.kill('SIGTERM');
  });
}
