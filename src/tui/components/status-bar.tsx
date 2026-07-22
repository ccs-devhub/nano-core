import { Box, Text } from 'ink';
import type { ReactElement } from 'react';

import { getStyle } from '@/registry/nano-style.js';

const VIEW_HINTS: Record<string, string> = {
  dashboard: 'npm run doctor verifies every layer',
  bot: 's start · x stop · r restart',
  config: 'j/k field · enter edit/toggle · s save',
  modules: 'space toggle · enter panel · /module sync after',
  'module-panel': 'j/k field · enter edit · s save · b back',
  store: 'enter install · r refresh',
  commands: 'j/k move · g/G first/last',
  run: 'enter run task · j/k select',
  logs: 'j/k scroll · u/d page · g/G ends · r reload',
  help: 'h/l or 1-8 to leave',
};

/**
 * One footer line: compact keys on the left, the view hint on the
 * right (bottom-right placement keeps the left corner quiet).
 */
export function StatusBar({ view }: { view: string }): ReactElement {
  const STYLE = getStyle();
  const HINT = VIEW_HINTS[view];

  return (
    <Box
      paddingX={2}
      paddingBottom={0}
      marginTop={1}
      justifyContent="space-between"
      gap={2}
    >
      <Text dimColor>h/l · j/k · ? · q</Text>
      {HINT
        ? (
          <Text color={STYLE.palette.accent} wrap="truncate">
            {HINT}
          </Text>
        )
        : null}
    </Box>
  );
}
