import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';
import { useState } from 'react';

import { getStyle } from '@/registry/nano-style.js';
import { useUiState } from '@/tui/state/ui-state.js';

import { PasswordInput, TextInput } from '@inkjs/ui';

/**
 * Generic keyboard-driven form: j/k selects a field, enter edits (or
 * toggles booleans / cycles selects), s saves. Field specs are plain
 * data — this is also what renders module nano-tui.json panels.
 */
export type FormValue = string | number | boolean;

export interface FormFieldSpec {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'number' | 'boolean' | 'select';
  options?: string[];
  help?: string;
  value: FormValue;
}

export function Form({
  fields,
  onSave,
}: {
  fields: FormFieldSpec[];
  onSave: (values: Record<string, FormValue>) => void;
}): ReactElement {
  const [values, set_values] = useState<Record<string, FormValue>>(
    Object.fromEntries(fields.map((field): [string, FormValue] => {
      return [field.key, field.value];
    }))
  );
  const [cursor, set_cursor] = useState(0);
  const [editing_key, set_editing_key] = useState<string | null>(null);
  const [saved, set_saved] = useState(false);
  const { setEditing } = useUiState();

  const commit = (key: string, value: FormValue): void => {
    set_values((previous): Record<string, FormValue> => {
      return { ...previous, [key]: value };
    });
    set_editing_key(null);
    setEditing(false);
    set_saved(false);
  };

  useInput((input, key): void => {
    if (editing_key) {
      return;
    }

    const FIELD = fields[cursor];

    if (input === 'j' || key.downArrow) {
      set_cursor(Math.min(cursor + 1, fields.length - 1));
    } else if (input === 'k' || key.upArrow) {
      set_cursor(Math.max(cursor - 1, 0));
    } else if (input === 's') {
      onSave(values);
      set_saved(true);
    } else if (key.return && FIELD) {
      if (FIELD.type === 'boolean') {
        commit(FIELD.key, !(values[FIELD.key] === true));
      } else if (FIELD.type === 'select') {
        const OPTIONS = FIELD.options ?? [];
        const CURRENT = OPTIONS.indexOf(String(values[FIELD.key]));
        const NEXT = OPTIONS[(CURRENT + 1) % Math.max(OPTIONS.length, 1)];

        if (NEXT !== undefined) {
          commit(FIELD.key, NEXT);
        }
      } else {
        set_editing_key(FIELD.key);
        setEditing(true);
        set_saved(false);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {fields.map((field, index): ReactElement => {
        const ACTIVE = index === cursor;
        const VALUE = values[field.key];
        const SHOWN = field.type === 'secret' && VALUE
          ? '********'
          : String(VALUE);

        if (editing_key === field.key) {
          const INPUT_PROPS = {
            defaultValue: field.type === 'secret' ? '' : String(VALUE),
            onSubmit: (raw: string): void => {
              commit(
                field.key,
                field.type === 'number' ? Number(raw) || 0 : raw
              );
            },
          };
          return (
            <Box key={field.key} gap={1}>
              <Text bold color={getStyle().palette.warning}>
                {field.label}:
              </Text>
              {field.type === 'secret'
                ? <PasswordInput {...INPUT_PROPS} />
                : <TextInput {...INPUT_PROPS} />}
            </Box>
          );
        }

        return (
          <Box key={field.key} flexDirection="column">
            <Box gap={1}>
              <Text
                color={ACTIVE ? getStyle().palette.success : undefined}
                bold={ACTIVE}
              >
                {ACTIVE ? '> ' : '  '}
                {field.label}:
              </Text>
              <Text dimColor={!ACTIVE}>{SHOWN}</Text>
            </Box>
            {ACTIVE && field.help
              ? <Text dimColor>    {field.help}</Text>
              : null}
          </Box>
        );
      })}
      <Text> </Text>
      <Text dimColor>
        enter edit/toggle · s save{saved ? '  — saved' : ''}
      </Text>
    </Box>
  );
}
