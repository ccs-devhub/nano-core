import { Text, useInput } from 'ink';
import type { ReactElement } from 'react';

import { getModuleConfig, setModuleConfig } from
  '@/registry/nano-config.js';
import { getStyle } from '@/registry/nano-style.js';
import type { FormFieldSpec, FormValue } from '@/tui/components/form.js';
import { Form } from '@/tui/components/form.js';
import { Window } from '@/tui/components/window.js';
import { useRoute } from '@/tui/router.js';
import { useUiState } from '@/tui/state/ui-state.js';
import type { TuiField } from '@/types/nano-tui.js';
import { loadTuiManifest } from '@/types/nano-tui.js';

/**
 * A module's declarative config panel: nano-tui.json fields rendered
 * by the generic Form and persisted into the module_config section.
 * The module's own code never runs here.
 */
export function ModulePanel(): ReactElement {
  const { route, navigate } = useRoute();
  const { editing } = useUiState();
  const NAME = route.params?.name ?? '';
  const MANIFEST_PATH = route.params?.manifest ?? '';
  const MANIFEST = loadTuiManifest(MANIFEST_PATH);

  useInput((input, key): void => {
    if (!editing && (key.escape || input === 'b')) {
      navigate('modules');
    }
  });

  if (!MANIFEST.ok) {
    return (
      <Window title="Module panel" color={getStyle().palette.error} grow>
        <Text color={getStyle().palette.error}>{MANIFEST.error}</Text>
        <Text dimColor>b back to modules</Text>
      </Window>
    );
  }

  const SAVED = getModuleConfig<Record<string, FormValue>>(NAME) ?? {};
  const FIELDS: FormFieldSpec[] = MANIFEST.data.fields.map(
    (field: TuiField): FormFieldSpec => {
      return {
        key: field.key,
        label: field.label,
        type: field.type,
        options: field.options,
        help: field.help,
        value: SAVED[field.key] ?? field.default ?? '',
      };
    }
  );

  return (
    <Window title={MANIFEST.data.title ?? `${NAME} settings`} grow>
      <Form
        fields={FIELDS}
        onSave={(values: Record<string, FormValue>): void => {
          setModuleConfig(NAME, values);
        }}
      />
      <Text> </Text>
      <Text dimColor>b back to modules</Text>
    </Window>
  );
}
