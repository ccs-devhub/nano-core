import { syncCommands } from '@/misc/utility/command-sync.js';
import { getLogger } from '@/services/logger.js';
import type { NanoCommand } from '@/types/nano-module.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * Back-compat wrapper over the command synchronizer: global scope,
 * diff-then-PUT. Prefer syncCommands() directly for guild scope.
 */
export async function registerGlobalCommands(
  commands: NanoCommand[],
  token: string,
  client_id: string
): Promise<NanoResult<number>> {
  if (commands.length === 0) {
    getLogger().info('No commands to register globally');
    return ok(0);
  }

  const RESULT = await syncCommands(commands, { token, client_id });

  if (!RESULT.ok) {
    return err(RESULT.error);
  }
  return ok(RESULT.data.count);
}
