import type { Client } from 'discord.js';

import { getLogger } from '@/services/logger.js';

export default {
  name: 'clientReady',
  once: true,

  execute(bot: Client<true>): void {
    const GUILDS = bot.guilds.cache.size;
    getLogger().info(
      `nano-core online — ${bot.user.tag} · ${GUILDS} guild(s)`
    );
  },
};
