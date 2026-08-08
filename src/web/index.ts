import type { Client } from 'discord.js';

import type { NanoConfig } from '@/registry/nano-config.js';
import { startWebServer } from '@/web/server.js';

/**
 * Boot entry for the web connection. The composition root calls this
 * AFTER services attach and modules register, BEFORE login — and only
 * imports this file when `web.enabled` is true, so a disabled web
 * host costs the boot path nothing.
 */
export async function startWebIfEnabled(
  bot: Client,
  config: NanoConfig
): Promise<void> {
  if (!config.web.enabled) {
    return;
  }
  await startWebServer(bot, { config });
}
