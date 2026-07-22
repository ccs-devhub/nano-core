import { Text } from 'ink';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { setModuleState } from '@/registry/nano-config.js';
import type { ToggleRow } from '@/tui/components/toggle-list.js';
import { ToggleList } from '@/tui/components/toggle-list.js';
import { Window } from '@/tui/components/window.js';
import { useRoute } from '@/tui/router.js';
import type { TuiModuleRow } from '@/tui/state/module-rows.js';
import { listModuleRows } from '@/tui/state/module-rows.js';

export function ModulesView(): ReactElement {
  const [rows, set_rows] = useState<TuiModuleRow[]>(listModuleRows());
  const { navigate } = useRoute();

  const toggle = (name: string): void => {
    const ROW = rows.find((row): boolean => {
      return row.name === name;
    });

    if (ROW) {
      setModuleState(name, !ROW.enabled);
      set_rows(listModuleRows());
    }
  };

  const open = (name: string): void => {
    const ROW = rows.find((row): boolean => {
      return row.name === name;
    });

    if (ROW?.manifest_path) {
      navigate('module-panel', {
        name: ROW.name,
        manifest: ROW.manifest_path,
      });
    }
  };

  return (
    <Window title="Installed modules" grow>
      <ToggleList
        rows={rows.map((row): ToggleRow => {
          return {
            id: row.name,
            label: row.name,
            detail: `${row.source}` +
              `${row.version ? ` v${row.version}` : ''}` +
              `${row.trusted ? '' : ' UNREVIEWED'}`,
            on: row.enabled,
            openable: Boolean(row.manifest_path),
          };
        })}
        onToggle={toggle}
        onOpen={open}
      />
      <Text> </Text>
      <Text dimColor>
        kernel and core are always on and not listed here
      </Text>
    </Window>
  );
}
