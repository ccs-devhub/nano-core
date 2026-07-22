import { Box, Text } from 'ink';
import type { ReactElement } from 'react';

import { getStyle } from '@/registry/nano-style.js';
import { Window } from '@/tui/components/window.js';
import { getAbout } from '@/tui/state/about.js';

const KEYS: [string, string][] = [
  ['1-8', 'jump to a view'],
  ['h / l', 'previous / next view'],
  ['j / k', 'move down / up'],
  ['g / G', 'first / last entry'],
  ['enter', 'select · edit · toggle · run'],
  ['space', 'toggle a module on/off'],
  ['s', 'save a form / start the bot (Bot view)'],
  ['b / esc', 'back (module panel)'],
  ['r', 'reload (Store, Logs) / restart bot'],
  ['?', 'this help'],
  ['q', 'quit'],
];

const TERMINAL_COMMANDS: [string, string][] = [
  ['npm run doctor', 'check every layer of the bot'],
  ['npm run dev', 'start the bot (banner + logs)'],
  ['npm run ui', 'this window'],
  ['npm run module -- search', 'browse the store'],
  ['npm run module -- install <x>', 'install a store module'],
  ['npm run module -- add ./mod', 'add a local module'],
  ['npm run module -- list', 'entries + provenance'],
  ['npm run lint / build / test', 'development gates'],
];

const DISCORD_COMMANDS: [string, string][] = [
  ['/module <sub>', 'list, enable, disable, health, sync'],
  ['/synapse scan', 'full server snapshot'],
  ['/synapse vitals', 'core + module health'],
  ['/synapse roles|members|channels', 'server data'],
  ['/embed', 'themed embed (embed-styler)'],
];

function TableRows(
  { rows }: { rows: [string, string][] }
): ReactElement {
  return (
    <Box flexDirection="column">
      {rows.map(([left, right]): ReactElement => {
        return (
          <Box key={left} gap={1} height={1}>
            <Box width={32} flexShrink={0}>
              <Text color={getStyle().palette.accent} wrap="truncate">
                {left}
              </Text>
            </Box>
            <Text dimColor wrap="truncate">{right}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function HelpView(): ReactElement {
  const ABOUT = getAbout();

  return (
    <Box flexDirection="column" gap={0}>
      <Window title="Keys">
        <TableRows rows={KEYS} />
      </Window>
      <Window title="Terminal commands">
        <TableRows rows={TERMINAL_COMMANDS} />
      </Window>
      <Window title="Discord commands">
        <TableRows rows={DISCORD_COMMANDS} />
      </Window>
      <Window title="maintainers">
        <TableRows
          rows={ABOUT.maintainers.map(
            (person): [string, string] => {
              return [person.name, person.url ?? ''];
            }
          )}
        />
      </Window>
      <Box paddingX={1} justifyContent="flex-end">
        <Text color={getStyle().palette.primary}>{'▣ '}</Text>
        <Text dimColor>Cyber Code Syndicate (CCS)</Text>
      </Box>
    </Box>
  );
}
