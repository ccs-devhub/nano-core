import { Box, Text } from 'ink';
import type { ReactElement } from 'react';
import { useSyncExternalStore } from 'react';

import { NANO_VERSION } from '@/constants/nano.js';
import { getStyle } from '@/registry/nano-style.js';
import type { TuiView } from '@/tui/router.js';
import { useRoute } from '@/tui/router.js';
import { getBotSnapshot, subscribeBot } from
  '@/tui/state/bot-process.js';

const ITEMS: { view: TuiView; label: string; key: string }[] = [
  { view: 'dashboard', label: 'dashboard', key: '1' },
  { view: 'bot', label: 'bot', key: '2' },
  { view: 'config', label: 'config', key: '3' },
  { view: 'modules', label: 'modules', key: '4' },
  { view: 'store', label: 'store', key: '5' },
  { view: 'commands', label: 'commands', key: '6' },
  { view: 'run', label: 'run', key: '7' },
  { view: 'logs', label: 'logs', key: '8' },
];

export function Sidebar(): ReactElement {
  const { route } = useRoute();
  const STYLE = getStyle();
  const BOT = useSyncExternalStore(subscribeBot, getBotSnapshot);
  let bot_dot_color = STYLE.palette.warning;

  if (BOT.status === 'online') {
    bot_dot_color = STYLE.palette.success;
  }

  return (
    <Box
      flexDirection="column"
      width={22}
      paddingX={2}
      paddingY={1}
      borderStyle="single"
      borderColor="gray"
      borderTop={false}
      borderBottom={false}
      borderLeft={false}
      borderDimColor
    >
      <Text bold color={STYLE.palette.primary}>nano-core</Text>
      <Text dimColor>v{NANO_VERSION}</Text>
      <Text> </Text>
      {ITEMS.map((item): ReactElement => {
        const ACTIVE = route.view === item.view ||
          (item.view === 'modules' && route.view === 'module-panel');
        return (
          <Box key={item.view} height={1}>
            <Text
              bold={ACTIVE}
              color={ACTIVE ? STYLE.palette.primary : undefined}
              dimColor={!ACTIVE}
              wrap="truncate"
            >
              {'  '}{item.key} {item.label}
            </Text>
            {item.view === 'bot' && BOT.status !== 'stopped'
              ? <Text color={bot_dot_color}> ●</Text>
              : null}
          </Box>
        );
      })}
      <Text> </Text>
      <Box height={1}>
        <Text
          bold={route.view === 'help'}
          color={route.view === 'help' ? STYLE.palette.primary : undefined}
          dimColor={route.view !== 'help'}
          wrap="truncate"
        >
          {'  '}? help
        </Text>
      </Box>
    </Box>
  );
}
