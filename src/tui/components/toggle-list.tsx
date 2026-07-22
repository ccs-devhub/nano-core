import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { getStyle } from '@/registry/nano-style.js';

/**
 * Scrollable-enough list with space-to-toggle rows and enter-to-open
 * (when a row has a panel). Drives the Modules view.
 */
export interface ToggleRow {
  id: string;
  label: string;
  detail?: string;
  on: boolean;
  openable?: boolean;
}

export function ToggleList({
  rows,
  onToggle,
  onOpen,
}: {
  rows: ToggleRow[];
  onToggle: (id: string) => void;
  onOpen?: (id: string) => void;
}): ReactElement {
  const [cursor, set_cursor] = useState(0);

  useInput((input, key): void => {
    const ROW = rows[cursor];

    if (input === 'j' || key.downArrow) {
      set_cursor(Math.min(cursor + 1, Math.max(rows.length - 1, 0)));
    } else if (input === 'k' || key.upArrow) {
      set_cursor(Math.max(cursor - 1, 0));
    } else if (input === 'g') {
      set_cursor(0);
    } else if (input === 'G') {
      set_cursor(Math.max(rows.length - 1, 0));
    } else if (input === ' ' && ROW) {
      onToggle(ROW.id);
    } else if (key.return && ROW?.openable && onOpen) {
      onOpen(ROW.id);
    }
  });

  if (rows.length === 0) {
    return <Text dimColor>Nothing here yet.</Text>;
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, index): ReactElement => {
        const ACTIVE = index === cursor;
        return (
          <Box key={row.id} gap={1}>
            <Text
              color={ACTIVE ? getStyle().palette.primary : undefined}
              bold={ACTIVE}
              dimColor={!ACTIVE && !row.on}
            >
              {'  '}[{row.on ? 'x' : ' '}] {row.label}
            </Text>
            {row.detail
              ? <Text dimColor>{row.detail}</Text>
              : null}
            {row.openable
              ? <Text color={getStyle().palette.accent}>[panel]</Text>
              : null}
          </Box>
        );
      })}
    </Box>
  );
}
