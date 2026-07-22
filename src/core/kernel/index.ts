import { NANO_VERSION } from '@/constants/nano.js';
import type { NanoModule } from '@/types/nano-module.js';

import module_manager_command from './commands/module-manager.js';
import client_ready_event from './events/client-ready.js';
import interaction_create_event from './events/interaction-create.js';

/**
 * The always-on kernel module: command dispatcher, ready log, and the
 * /module manager. Registered as protected so it can never be disabled
 * or removed at runtime.
 */
export function createKernelModule(): NanoModule {
  return {
    name: 'nano',
    version: NANO_VERSION,
    description: 'nano-core kernel: dispatcher and module manager.',
    license: 'MPL-2.0',
    commands: [module_manager_command],
    events: [interaction_create_event, client_ready_event],
  };
}
