import { Box, Text } from 'ink';
import type { ReactElement, ReactNode } from 'react';

import { getStyle } from '@/registry/nano-style.js';

/**
 * Minimal section (opencode-style): an accent bar glyph + lowercase
 * title, content indented below. No inner borders — the app shell
 * draws the single outer frame.
 */
export function Window({
  title,
  children,
  grow,
  color,
  trailing,
}: {
  title: string;
  children: ReactNode;
  grow?: boolean;
  color?: string;
  trailing?: ReactNode;
}): ReactElement {
  const STYLE = getStyle();
  const ACCENT = color ?? STYLE.palette.primary;

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
      flexGrow={grow ? 1 : undefined}
    >
      <Box gap={1}>
        <Text bold color={ACCENT}>{'▍'}</Text>
        <Text bold>{title.toLowerCase()}</Text>
        {trailing ?? null}
      </Box>
      <Text> </Text>
      <Box flexDirection="column" paddingLeft={2}>
        {children}
      </Box>
    </Box>
  );
}
