import { Box, Text, useInput, useStdout } from 'ink';
import type { ReactElement } from 'react';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { loadConfig } from '@/registry/nano-config.js';
import { getStyle } from '@/registry/nano-style.js';
import { Spinner, StatusDot } from '@/tui/components/spinner.js';
import { Window } from '@/tui/components/window.js';
import type { BotStatus } from '@/tui/state/bot-process.js';
import {
  getBotSnapshot,
  restartBot,
  startBot,
  stopBot,
  subscribeBot
} from '@/tui/state/bot-process.js';

/**
 * The bot console: start/stop/restart the real bot process and watch
 * its log stream live, exactly as the terminal would show it.
 */
const RESERVED_ROWS = 14;
const MIN_PANE_ROWS = 6;
const MAX_PANE_ROWS = 24;
const FALLBACK_ROWS = 30;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const UPTIME_TICK_MS = 1000;

const STATUS_TEXT: Record<BotStatus, string> = {
  stopped: 'stopped',
  starting: 'starting',
  online: 'online',
  stopping: 'stopping',
};

function uptime(started_at?: number): string {
  if (!started_at) {
    return '';
  }

  const TOTAL = Math.floor((Date.now() - started_at) / MS_PER_SECOND);
  const MINUTES = Math.floor(TOTAL / SECONDS_PER_MINUTE);
  const SECONDS = TOTAL % SECONDS_PER_MINUTE;
  return MINUTES > 0 ? `${MINUTES}m ${SECONDS}s` : `${SECONDS}s`;
}

export function BotView(): ReactElement {
  const BOT = useSyncExternalStore(subscribeBot, getBotSnapshot);
  const [, set_tick] = useState(0);
  const { stdout } = useStdout();
  const STYLE = getStyle();
  const CONFIG = loadConfig();
  const RUNNING = BOT.status === 'starting' || BOT.status === 'online';

  /* Tick the uptime while the bot runs. */
  useEffect((): (() => void) | undefined => {
    if (!RUNNING) {
      return undefined;
    }

    const TIMER = setInterval((): void => {
      set_tick((previous): number => {
        return previous + 1;
      });
    }, UPTIME_TICK_MS);
    return (): void => {
      clearInterval(TIMER);
    };
  }, [RUNNING]);

  useInput((input): void => {
    if (input === 's') {
      startBot();
    } else if (input === 'x') {
      stopBot();
    } else if (input === 'r') {
      restartBot();
    }
  });

  const PANE_ROWS = Math.min(
    Math.max(
      (stdout.rows ?? FALLBACK_ROWS) - RESERVED_ROWS,
      MIN_PANE_ROWS
    ),
    MAX_PANE_ROWS
  );

  let status_glyph;

  if (BOT.status === 'starting' || BOT.status === 'stopping') {
    status_glyph = <Spinner />;
  } else {
    status_glyph = (
      <StatusDot state={BOT.status === 'online' ? 'ok' : 'idle'} />
    );
  }

  return (
    <Box flexDirection="column">
      <Window
        title={`bot — ${CONFIG.bot.name}`}
        trailing={status_glyph}
      >
        <Box gap={2}>
          <Text
            bold
            color={BOT.status === 'online'
              ? STYLE.palette.success
              : undefined}
            dimColor={BOT.status === 'stopped'}
          >
            {STATUS_TEXT[BOT.status]}
          </Text>
          {RUNNING && BOT.pid
            ? <Text dimColor>pid {BOT.pid}</Text>
            : null}
          {RUNNING
            ? <Text dimColor>up {uptime(BOT.started_at)}</Text>
            : null}
          {BOT.status === 'stopped' && BOT.exit_code !== undefined
            ? <Text dimColor>exit code {BOT.exit_code ?? 'unknown'}</Text>
            : null}
        </Box>
        <Text> </Text>
        <Text dimColor>
          s start · x stop · r restart — logs stream below in real
          time
        </Text>
      </Window>
      <Window title="console" trailing={RUNNING ? <Spinner /> : undefined}>
        <Box
          flexDirection="column"
          height={PANE_ROWS}
          overflow="hidden"
          borderStyle="single"
          borderColor="gray"
          borderDimColor
          borderTop={false}
          borderBottom={false}
          borderRight={false}
          paddingLeft={1}
        >
          {BOT.log.length === 0
            ? (
              <Text dimColor>
                press s to start the bot (same as npm run dev)
              </Text>
            )
            : BOT.log.slice(-PANE_ROWS).map(
              (line, index): ReactElement => {
                return <Text key={index}>{line}</Text>;
              }
            )}
        </Box>
      </Window>
    </Box>
  );
}
