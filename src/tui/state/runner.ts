import { spawn } from 'node:child_process';

/**
 * The task runner behind the Run view: every script the project
 * exposes, runnable inside the TUI with streamed output. `doctor` and
 * `store` run in-process; the rest spawn their real commands.
 */
export type RunnerTaskId =
  | 'doctor'
  | 'lint'
  | 'build'
  | 'test'
  | 'store';

export interface RunnerTask {
  id: RunnerTaskId;
  label: string;
  description: string;
  command?: string[];
}

export const RUNNER_TASKS: RunnerTask[] = [
  {
    id: 'doctor',
    label: 'doctor',
    description: 'check every layer the bot depends on',
  },
  {
    id: 'store',
    label: 'store sync',
    description: 'refresh the nano-store registry cache',
  },
  {
    id: 'lint',
    label: 'lint',
    description: 'eslint over the whole repo',
    command: ['npx', 'eslint', '.'],
  },
  {
    id: 'build',
    label: 'build',
    description: 'tsc strict build with declarations',
    command: ['npx', 'tsc', '-p', 'tsconfig.build.json'],
  },
  {
    id: 'test',
    label: 'test',
    description: 'vitest suite',
    command: ['npx', 'vitest', 'run'],
  },
];

/* Built from char codes to satisfy no-control-regex. stripAnsi drops
   every CSI sequence; sanitizeOutput KEEPS colors (SGR, ending in 'm')
   and drops only cursor moves / line clears / carriage returns, so
   streamed tool output stays colored but never repaints the pane. */
const ESCAPE_CODE = 27;
const CSI_PATTERN = new RegExp(
  `${String.fromCharCode(ESCAPE_CODE)}\\[[0-9;?]*[A-Za-z]`,
  'g'
);
const NON_COLOR_CSI_PATTERN = new RegExp(
  `${String.fromCharCode(ESCAPE_CODE)}\\[[0-9;?]*[A-Za-ln-z]`,
  'g'
);
const CARRIAGE_RETURN_CODE = 13;
const CR_PATTERN = new RegExp(
  String.fromCharCode(CARRIAGE_RETURN_CODE),
  'g'
);
const MAX_LOG_LINES = 200;

export function stripAnsi(text: string): string {
  return text.replace(CSI_PATTERN, '').replace(CR_PATTERN, '');
}

/** Keep colors; remove repaint sequences so lines stream cleanly. */
export function sanitizeOutput(text: string): string {
  return text.replace(NON_COLOR_CSI_PATTERN, '').replace(CR_PATTERN, '');
}

/**
 * Spawn a task command, streaming clean lines to `on_line`. Resolves
 * with the exit code. Never rejects — spawn errors become log lines.
 */
export function runCommand(
  command: string[],
  on_line: (line: string) => void,
  cwd: string = process.cwd()
): Promise<number> {
  return new Promise((resolve: (code: number) => void): void => {
    const [BIN, ...ARGS] = command;
    /* CI keeps reporters sequential (no repainting); FORCE_COLOR
       keeps their output colored even though stdout is a pipe. */
    const CHILD = spawn(BIN, ARGS, {
      cwd,
      env: { ...process.env, CI: 'true', FORCE_COLOR: '1' },
    });
    let buffer = '';

    const FLUSH = (chunk: string): void => {
      buffer += chunk;
      const LINES = buffer.split('\n');
      buffer = LINES.pop() ?? '';

      for (const _line of LINES) {
        const CLEAN = sanitizeOutput(_line).trimEnd();

        if (stripAnsi(CLEAN).trim()) {
          on_line(CLEAN);
        }
      }
    };

    CHILD.stdout.on('data', (chunk: Buffer): void => {
      FLUSH(chunk.toString());
    });
    CHILD.stderr.on('data', (chunk: Buffer): void => {
      FLUSH(chunk.toString());
    });
    CHILD.on('error', (error: Error): void => {
      on_line(`spawn failed: ${error.message}`);
      resolve(1);
    });
    CHILD.on('close', (code: number | null): void => {
      const REST = sanitizeOutput(buffer).trimEnd();

      if (stripAnsi(REST).trim()) {
        on_line(REST);
      }
      resolve(code ?? 1);
    });
  });
}

/** Keep the newest lines only, bounded. */
export function appendLog(log: string[], line: string): string[] {
  const NEXT = [...log, line];
  return NEXT.length > MAX_LOG_LINES
    ? NEXT.slice(NEXT.length - MAX_LOG_LINES)
    : NEXT;
}
