import { NANO_VERSION } from '@/constants/nano.js';
import type { NanoHealthReport, NanoModule } from '@/types/nano-module.js';
import { webHealth } from '@/web/status.js';

import module_manager_command from './commands/module-manager.js';
import client_ready_event from './events/client-ready.js';
import interaction_create_event from './events/interaction-create.js';

/**
 * The always-on kernel module: command dispatcher, ready log, and the
 * /module manager. Registered as protected so it can never be disabled
 * or removed at runtime. Its healthCheck carries the core CONNECTION
 * states (A11): today that is the web host — disabled is healthy,
 * enabled-but-not-listening is degraded.
 */
export function createKernelModule(): NanoModule {
  return {
    name: 'nano',
    version: NANO_VERSION,
    description: 'The nano-core kernel, dispatcher and module manager.',
    license: 'MPL-2.0',
    commands: [module_manager_command],
    events: [interaction_create_event, client_ready_event],
    healthCheck: (): NanoHealthReport => {
      return webHealth();
    },
  };
}
