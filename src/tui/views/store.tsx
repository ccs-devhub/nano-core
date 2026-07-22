import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';

import { loadConfig } from '@/registry/nano-config.js';
import { getStyle } from '@/registry/nano-style.js';
import { installFromStore } from '@/store/installer.js';
import type { StoreModule } from '@/store/store-client.js';
import { StoreClient } from '@/store/store-client.js';
import { Spinner } from '@/tui/components/spinner.js';
import { Window } from '@/tui/components/window.js';
import { listModuleRows } from '@/tui/state/module-rows.js';

type StoreStatus =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'installing'; name: string }
  | { kind: 'message'; text: string; error: boolean };

export function StoreView(): ReactElement {
  const [modules, set_modules] = useState<StoreModule[]>([]);
  const [status, set_status] = useState<StoreStatus>({ kind: 'loading' });
  const [cursor, set_cursor] = useState(0);
  const INSTALLED = new Set(listModuleRows().map((row): string => {
    return row.name;
  }));

  const load = (refresh: boolean): void => {
    set_status({ kind: 'loading' });
    const CONFIG = loadConfig();
    const CLIENT = new StoreClient({
      registry_url: CONFIG.store.registry_url,
      cache_ttl_hours: CONFIG.store.cache_ttl_hours,
    });
    CLIENT.getRegistry(refresh)
      .then((result): void => {
        if (result.ok) {
          set_modules(result.data.modules);
          set_status({ kind: 'ready' });
        } else {
          set_status({
            kind: 'message',
            text: result.error,
            error: true,
          });
        }
      })
      .catch((error: unknown): void => {
        set_status({
          kind: 'message',
          text: String(error),
          error: true,
        });
      });
  };

  useEffect((): void => {
    load(false);
    /* Load once on mount; r re-fetches. */
  }, []);

  useInput((input, key): void => {
    if (status.kind === 'installing') {
      return;
    }

    if (input === 'j' || key.downArrow) {
      set_cursor(Math.min(cursor + 1, Math.max(modules.length - 1, 0)));
    } else if (input === 'k' || key.upArrow) {
      set_cursor(Math.max(cursor - 1, 0));
    } else if (input === 'r') {
      load(true);
    } else if (key.return && modules[cursor]) {
      const NAME = modules[cursor].name;
      set_status({ kind: 'installing', name: NAME });
      const CONFIG = loadConfig();
      const CLIENT = new StoreClient({
        registry_url: CONFIG.store.registry_url,
        cache_ttl_hours: CONFIG.store.cache_ttl_hours,
      });
      installFromStore(CLIENT, NAME)
        .then((result): void => {
          set_status({
            kind: 'message',
            text: result.ok
              ? `Installed ${NAME}@${result.data.version} (validated).`
              : result.error,
            error: !result.ok,
          });
        })
        .catch((error: unknown): void => {
          set_status({
            kind: 'message',
            text: String(error),
            error: true,
          });
        });
    }
  });

  return (
    <Window title="nano-store (validated modules only)" grow>
      {status.kind === 'loading'
        ? <Spinner label="loading registry" />
        : null}
      {status.kind === 'installing'
        ? <Spinner label={`installing ${status.name}`} />
        : null}
      {status.kind === 'message'
        ? (
          <Text
            color={status.error
              ? getStyle().palette.error
              : getStyle().palette.success}
          >
            {status.text}
          </Text>
        )
        : null}
      <Box flexDirection="column">
        {modules.map((module, index): ReactElement => {
          const ACTIVE = index === cursor;
          return (
            <Box key={module.name} flexDirection="column">
              <Box gap={1}>
                <Text
                  color={ACTIVE ? getStyle().palette.primary : undefined}
                  bold={ACTIVE}
                >
                  {'  '}{module.name}@{module.version}
                </Text>
                <Text dimColor>
                  by {module.author} · validated {module.validated_at}
                </Text>
                {INSTALLED.has(module.name)
                  ? <Text color={getStyle().palette.accent}>[installed]</Text>
                  : null}
              </Box>
              {ACTIVE
                ? <Text dimColor>    {module.description}</Text>
                : null}
            </Box>
          );
        })}
      </Box>
      <Text> </Text>
      <Text dimColor>
        unlisted modules install via CLI with --allow-external
        (unreviewed, at your own risk)
      </Text>
    </Window>
  );
}
