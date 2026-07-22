import { Text } from 'ink';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

import { getStyle } from '@/registry/nano-style.js';

/**
 * Minimal braille loader (opencode-style). Accent-colored, one cell.
 */
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export function Spinner({ label }: { label?: string }): ReactElement {
  const [frame, set_frame] = useState(0);
  const STYLE = getStyle();

  useEffect((): (() => void) => {
    const TIMER = setInterval((): void => {
      set_frame((previous): number => {
        return (previous + 1) % FRAMES.length;
      });
    }, INTERVAL_MS);
    return (): void => {
      clearInterval(TIMER);
    };
  }, []);

  return (
    <Text>
      <Text color={STYLE.palette.accent}>{FRAMES[frame]}</Text>
      {label ? <Text dimColor> {label}</Text> : null}
    </Text>
  );
}

/** Status glyphs shared by the runner and check lists. */
export function StatusDot(
  { state }: { state: 'ok' | 'fail' | 'idle' }
): ReactElement {
  const STYLE = getStyle();

  if (state === 'ok') {
    return <Text color={STYLE.palette.success}>●</Text>;
  }

  if (state === 'fail') {
    return <Text color={STYLE.palette.error}>●</Text>;
  }
  return <Text dimColor>○</Text>;
}
