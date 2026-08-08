import type { DashboardField } from './types';

/** A sensible empty value for a widget the user just added. */
export function defaultFor(field: DashboardField): unknown {
  if (field.type === 'boolean') {
    return field.default ?? false;
  }

  if (field.type === 'number') {
    return field.default ?? field.min ?? 0;
  }

  if (field.type === 'text' || field.type === 'template') {
    return field.default ?? '';
  }

  if (field.type === 'color') {
    return field.default ?? '#000000';
  }

  if (field.type === 'select') {
    return field.default ?? field.options[0] ?? '';
  }

  if (field.type === 'snowflake') {
    return '';
  }

  if (field.type === 'snowflake_list') {
    return [];
  }

  if (field.type === 'group') {
    const VALUE: Record<string, unknown> = {};

    for (const CHILD of field.fields) {
      VALUE[CHILD.key] = defaultFor(CHILD);
    }
    return VALUE;
  }

  if (field.type === 'array') {
    return [];
  }

  const FIRST = field.variants[0];
  const VALUE: Record<string, unknown> = {
    [field.discriminator]: FIRST?.value ?? '',
  };

  for (const CHILD of FIRST?.fields ?? []) {
    VALUE[CHILD.key] = defaultFor(CHILD);
  }
  return VALUE;
}
