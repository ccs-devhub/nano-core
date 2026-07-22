import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

import { getStyle } from '@/registry/nano-style.js';
import { Spinner } from '@/tui/components/spinner.js';
import { Window } from '@/tui/components/window.js';
import type { CommandInfo } from '@/tui/state/commands-info.js';
import { listCommandInfo } from '@/tui/state/commands-info.js';

export function CommandsView(): ReactElement {
  const [commands, set_commands] = useState<CommandInfo[] | null>(null);
  const [cursor, set_cursor] = useState(0);

  useEffect((): void => {
    listCommandInfo()
      .then((result): void => {
        set_commands(result);
      })
      .catch((): void => {
        set_commands([]);
      });
  }, []);

  useInput((input, key): void => {
    if (!commands) {
      return;
    }

    if (input === 'j' || key.downArrow) {
      set_cursor(Math.min(cursor + 1, Math.max(commands.length - 1, 0)));
    } else if (input === 'k' || key.upArrow) {
      set_cursor(Math.max(cursor - 1, 0));
    } else if (input === 'g') {
      set_cursor(0);
    } else if (input === 'G') {
      set_cursor(Math.max(commands.length - 1, 0));
    }
  });

  if (!commands) {
    return (
      <Window title="Slash commands" grow>
        <Spinner label="loading module definitions" />
      </Window>
    );
  }

  const SELECTED = commands[cursor];

  return (
    <Window title={`Slash commands (${commands.length})`} grow>
      <Box flexDirection="column">
        {commands.map((command, index): ReactElement => {
          const ACTIVE = index === cursor;
          return (
            <Box key={`${command.module}:${command.name}`} gap={1}>
              <Text
                color={ACTIVE ? getStyle().palette.primary : undefined}
                bold={ACTIVE}
              >
                {'  '}/{command.name}
              </Text>
              <Text dimColor>({command.module})</Text>
            </Box>
          );
        })}
      </Box>
      <Text> </Text>
      {SELECTED
        ? (
          <Box flexDirection="column" paddingLeft={2}>
            <Text>{SELECTED.description}</Text>
            {SELECTED.subcommands.map((sub): ReactElement => {
              return (
                <Text key={sub.name} dimColor>
                  /{SELECTED.name} {sub.name} — {sub.description}
                </Text>
              );
            })}
            <Text dimColor>
              {[
                SELECTED.cooldown ? `cooldown ${SELECTED.cooldown}` : null,
                SELECTED.defer ? 'deferred reply' : null,
                SELECTED.has_autocomplete ? 'autocomplete' : null,
              ].filter(Boolean).join(' · ') || 'no extras'}
            </Text>
          </Box>
        )
        : null}
    </Window>
  );
}
