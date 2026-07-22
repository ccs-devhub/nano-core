import { Box, Text, useInput, useStdout } from 'ink';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { loadConfig } from '@/registry/nano-config.js';
import { getStyle } from '@/registry/nano-style.js';
import type { DoctorCheck } from '@/services/doctor.js';
import { runDoctor } from '@/services/doctor.js';
import { StoreClient } from '@/store/store-client.js';
import { Spinner, StatusDot } from '@/tui/components/spinner.js';
import { Window } from '@/tui/components/window.js';
import type { RunnerTask, RunnerTaskId } from '@/tui/state/runner.js';
import { appendLog, runCommand, RUNNER_TASKS } from
  '@/tui/state/runner.js';

type TaskState = 'idle' | 'running' | 'ok' | 'fail';

interface RunState {
  active: RunnerTaskId | null;
  last: RunnerTaskId | null;
  states: Partial<Record<RunnerTaskId, TaskState>>;
  log: string[];
  checks: DoctorCheck[] | null;
  seconds: Partial<Record<RunnerTaskId, number>>;
}

const OUTPUT_RESERVED_ROWS = 16;
const MS_PER_SECOND = 1000;
const TENTHS = 10;
const MIN_OUTPUT_ROWS = 6;
const MAX_OUTPUT_ROWS = 18;
const FALLBACK_ROWS = 30;

function outputTitle(
  active: RunnerTask | undefined,
  last: RunnerTaskId | null
): string {
  if (active) {
    return `output — ${active.label}`;
  }

  if (last) {
    return `output — ${last}`;
  }
  return 'output';
}

function RunOutput(
  { run, visible }: { run: RunState; visible: number }
): ReactElement {
  if (run.checks) {
    return (
      <Box flexDirection="column">
        {run.checks.map((check): ReactElement => {
          return (
            <Box key={check.name} gap={1}>
              <StatusDot state={check.ok ? 'ok' : 'fail'} />
              <Box width={12}>
                <Text>{check.name}</Text>
              </Box>
              <Text dimColor>{check.detail}</Text>
            </Box>
          );
        })}
      </Box>
    );
  }

  if (run.log.length === 0 && !run.active) {
    return <Text dimColor>enter runs the selected task</Text>;
  }

  return (
    <Box flexDirection="column">
      {run.log.slice(-visible).map((line, index): ReactElement => {
        return (
          <Text key={index}>
            {line}
          </Text>
        );
      })}
    </Box>
  );
}

export function RunView(): ReactElement {
  const [cursor, set_cursor] = useState(0);
  const [run, set_run] = useState<RunState>({
    active: null,
    last: null,
    states: {},
    log: [],
    checks: null,
    seconds: {},
  });
  const { stdout } = useStdout();
  const STYLE = getStyle();

  const start = (task: RunnerTask): void => {
    if (run.active) {
      return;
    }

    const STARTED = Date.now();
    set_run((previous): RunState => {
      return {
        ...previous,
        active: task.id,
        last: task.id,
        states: { ...previous.states, [task.id]: 'running' },
        log: [],
        checks: null,
      };
    });

    const FINISH = (ok: boolean): void => {
      set_run((previous): RunState => {
        return {
          ...previous,
          active: null,
          states: { ...previous.states, [task.id]: ok ? 'ok' : 'fail' },
          seconds: {
            ...previous.seconds,
            [task.id]:
              Math.round(
                (Date.now() - STARTED) / MS_PER_SECOND * TENTHS
              ) / TENTHS,
          },
        };
      });
    };
    const LOG_LINE = (line: string): void => {
      set_run((previous): RunState => {
        return { ...previous, log: appendLog(previous.log, line) };
      });
    };

    if (task.id === 'doctor') {
      runDoctor()
        .then((checks): void => {
          set_run((previous): RunState => {
            return { ...previous, checks };
          });
          FINISH(checks.every((check): boolean => {
            return check.ok;
          }));
        })
        .catch((error: unknown): void => {
          LOG_LINE(String(error));
          FINISH(false);
        });
      return;
    }

    if (task.id === 'store') {
      const CONFIG = loadConfig();
      new StoreClient({
        registry_url: CONFIG.store.registry_url,
        cache_ttl_hours: CONFIG.store.cache_ttl_hours,
      })
        .getRegistry(true)
        .then((result): void => {
          LOG_LINE(result.ok
            ? `${result.data.modules.length} validated module(s) listed.`
            : result.error);
          FINISH(result.ok);
        })
        .catch((error: unknown): void => {
          LOG_LINE(String(error));
          FINISH(false);
        });
      return;
    }

    runCommand(task.command ?? [], LOG_LINE)
      .then((code): void => {
        LOG_LINE(code === 0 ? 'done' : `exit code ${code}`);
        FINISH(code === 0);
      });
  };

  useInput((input, key): void => {
    if (input === 'j' || key.downArrow) {
      set_cursor(Math.min(cursor + 1, RUNNER_TASKS.length - 1));
    } else if (input === 'k' || key.upArrow) {
      set_cursor(Math.max(cursor - 1, 0));
    } else if (input === 'g') {
      set_cursor(0);
    } else if (input === 'G') {
      set_cursor(RUNNER_TASKS.length - 1);
    } else if (key.return) {
      start(RUNNER_TASKS[cursor]);
    }
  });

  const ACTIVE_TASK = RUNNER_TASKS.find((task): boolean => {
    return task.id === run.active;
  });
  const LAST = run.last ? run.states[run.last] : undefined;
  const LAST_SECS = run.last ? run.seconds[run.last] : undefined;

  /* Fixed output height: running a task never resizes the layout. */
  const OUTPUT_ROWS = Math.min(
    Math.max(
      (stdout.rows ?? FALLBACK_ROWS) - OUTPUT_RESERVED_ROWS,
      MIN_OUTPUT_ROWS
    ),
    MAX_OUTPUT_ROWS
  );
  let trailing;

  if (run.active) {
    trailing = <Spinner />;
  } else if (LAST === 'ok' || LAST === 'fail') {
    trailing = (
      <Text dimColor>
        <StatusDot state={LAST} />
        {LAST_SECS !== undefined ? ` ${LAST_SECS}s` : ''}
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      <Window title="run">
        {RUNNER_TASKS.map((task, index): ReactElement => {
          const ACTIVE = index === cursor;
          const STATE = run.states[task.id] ?? 'idle';
          const SECS = run.seconds[task.id];
          return (
            <Box key={task.id}>
              <Text>{'  '}</Text>
              {STATE === 'running'
                ? <Spinner />
                : <StatusDot state={STATE === 'idle' ? 'idle' : STATE} />}
              <Box width={13}>
                <Text
                  bold={ACTIVE}
                  color={ACTIVE ? STYLE.palette.primary : undefined}
                  dimColor={!ACTIVE}
                >
                  {' '}{task.label}
                </Text>
              </Box>
              <Text dimColor>
                {task.description}
                {SECS !== undefined && STATE !== 'running'
                  ? `  ${SECS}s`
                  : ''}
              </Text>
            </Box>
          );
        })}
      </Window>
      <Window
        title={outputTitle(ACTIVE_TASK, run.last)}
        trailing={trailing}
      >
        <Box
          flexDirection="column"
          height={OUTPUT_ROWS}
          overflow="hidden"
          borderStyle="single"
          borderColor="gray"
          borderDimColor
          borderTop={false}
          borderBottom={false}
          borderRight={false}
          paddingLeft={1}
        >
          <RunOutput run={run} visible={OUTPUT_ROWS} />
        </Box>
      </Window>
    </Box>
  );
}
