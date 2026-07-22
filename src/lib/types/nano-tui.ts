import { existsSync, readFileSync } from 'node:fs';

import { z } from 'zod';

import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * The declarative TUI panel contract. A module ships a `nano-tui.json`
 * next to its entry file; the TUI validates it here and renders a
 * form. NO module code ever executes inside the TUI process — panels
 * are data, not scripts.
 */
export const TUI_FIELD_SCHEMA = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'secret', 'number', 'boolean', 'select']),
  options: z.array(z.string()).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  help: z.string().optional(),
});

export type TuiField = z.infer<typeof TUI_FIELD_SCHEMA>;

export const NANO_TUI_MANIFEST_SCHEMA = z.object({
  title: z.string().optional(),
  fields: z.array(TUI_FIELD_SCHEMA),
});

export type TuiManifest = z.infer<typeof NANO_TUI_MANIFEST_SCHEMA>;

/** Load and validate a module's nano-tui.json manifest. */
export function loadTuiManifest(path: string): NanoResult<TuiManifest> {
  if (!existsSync(path)) {
    return err(`No TUI manifest at '${path}'.`);
  }

  try {
    const PARSED = NANO_TUI_MANIFEST_SCHEMA.safeParse(
      JSON.parse(readFileSync(path, 'utf8'))
    );

    if (!PARSED.success) {
      return err(`Invalid TUI manifest '${path}'.`);
    }
    return ok(PARSED.data);
  } catch (error: unknown) {
    return err(error);
  }
}
