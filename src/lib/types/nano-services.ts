import type { NanoCache } from '@/services/cache.js';
import type { CooldownManager } from '@/services/cooldown.js';
import type { DatabaseService } from '@/services/database.js';
import type { LifecycleManager } from '@/services/lifecycle.js';
import type { NanoScheduler } from '@/services/scheduler.js';

/**
 * The service bundle wired onto the Client at boot. Modules reach it
 * via `interaction.client.services` (or the bot instance they receive
 * in lifecycle hooks).
 */
export interface NanoServices {
  cooldowns: CooldownManager;
  scheduler: NanoScheduler;
  cache: NanoCache;
  lifecycle: LifecycleManager;
  database: DatabaseService | null;
}
