import { existsSync, readFileSync } from 'node:fs';

import { Box, Text, useInput, useStdout } from 'ink';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { loadConfig } from '@/registry/nano-config.js';
import { Window } from '@/tui/components/window.js';

/**
 * Scrollable log history: loads the tail of the log file and lets you
 * walk back through it (j/k line, u/d half page, g/G ends). The pane
 * height is fixed so scrolling never moves the layout.
 */
const TAIL_LINES = 1000;
const RESERVED_ROWS = 10;
const MIN_PANE_ROWS = 6;
const MAX_PANE_ROWS = 24;
const FALLBACK_ROWS = 30;
const HALF_PAGE_DIVISOR = 2;

function readTail(): { path: string; lines: string[] } {
  const CONFIG = loadConfig();
  const PATH = CONFIG.logging.file ?? '.nano/nano.log';

  if (!existsSync(PATH)) {
    return { path: PATH, lines: [] };
  }

  const LINES = readFileSync(PATH, 'utf8')
    .split('\n')
    .filter(Boolean);
  return { path: PATH, lines: LINES.slice(-TAIL_LINES) };
}

export function LogsView(): ReactElement {
  const [tail, set_tail] = useState(readTail());
  /* Offset 0 = pinned to the newest lines; grows as you scroll back. */
  const [offset, set_offset] = useState(0);
  const { stdout } = useStdout();
  const PANE_ROWS = Math.min(
    Math.max(
      (stdout.rows ?? FALLBACK_ROWS) - RESERVED_ROWS,
      MIN_PANE_ROWS
    ),
    MAX_PANE_ROWS
  );
  const MAX_OFFSET = Math.max(tail.lines.length - PANE_ROWS, 0);
  const CLAMPED = Math.min(offset, MAX_OFFSET);
  const END = tail.lines.length - CLAMPED;
  const START = Math.max(END - PANE_ROWS, 0);
  const VIEWPORT = tail.lines.slice(START, END);

  useInput((input, key): void => {
    const HALF = Math.ceil(PANE_ROWS / HALF_PAGE_DIVISOR);

    if (input === 'r') {
      set_tail(readTail());
      set_offset(0);
    } else if (input === 'k' || key.upArrow) {
      set_offset(Math.min(CLAMPED + 1, MAX_OFFSET));
    } else if (input === 'j' || key.downArrow) {
      set_offset(Math.max(CLAMPED - 1, 0));
    } else if (input === 'u') {
      set_offset(Math.min(CLAMPED + HALF, MAX_OFFSET));
    } else if (input === 'd') {
      set_offset(Math.max(CLAMPED - HALF, 0));
    } else if (input === 'g') {
      set_offset(MAX_OFFSET);
    } else if (input === 'G') {
      set_offset(0);
    }
  });

  const POSITION = tail.lines.length === 0
    ? ''
    : `${START + 1}-${END} of ${tail.lines.length}` +
      `${CLAMPED === 0 ? ' · live end' : ''}`;

  return (
    <Window
      title={`logs — ${tail.path}`}
      trailing={<Text dimColor>{POSITION}</Text>}
      grow
    >
      {tail.lines.length === 0
        ? (
          <Text dimColor>
            No log file yet. Set Config &gt; Log file (e.g.
            .nano/nano.log) and run the bot; then press r to reload.
          </Text>
        )
        : (
          <Box
            flexDirection="column"
            height={PANE_ROWS}
            overflow="hidden"
          >
            {VIEWPORT.map((line, index): ReactElement => {
              return (
                <Text key={START + index} dimColor wrap="truncate">
                  {line}
                </Text>
              );
            })}
          </Box>
        )}
    </Window>
  );
}
