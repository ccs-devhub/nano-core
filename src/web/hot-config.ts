import type { NanoConfig } from '@/registry/nano-config.js';
import { loadConfig } from '@/registry/nano-config.js';

export type WebConfig = NanoConfig['web'];

/**
 * The hot/frozen config split (A4): per-request reads take the file's
 * current state, but a throwing loadConfig (the owner mid-edit) falls
 * back to the boot snapshot instead of turning every request into a
 * 500.
 */
export function resolveWebConfig(
  root: string,
  frozen: NanoConfig
): WebConfig {
  try {
    return loadConfig(root).web;
  } catch {
    return frozen.web;
  }
}
