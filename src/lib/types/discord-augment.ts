import type { Collection } from 'discord.js';

import type { ModuleRegistry } from '@/registry/module-registry.js';
import type { NanoCommand } from '@/types/nano-module.js';
import type { NanoServices } from '@/types/nano-services.js';

declare module 'discord.js' {
  interface Client {
    commands: Collection<string, NanoCommand>;
    nano: ModuleRegistry;
    services: NanoServices;
  }
}

export {};
