import type { Client } from 'discord.js';

import { getLogger } from '@/services/logger.js';

export default {
  name: 'clientReady',
  description: 'Logs the bot identity and guild count once the ' +
    'gateway session is ready.',
  once: true,

  execute(bot: Client<true>): void {
    const GUILDS = bot.guilds.cache.size;
    getLogger().info(
      `nano-core online — ${bot.user.tag} · ${GUILDS} guild(s)`
    );
    /* PF6: the boot catch-up pass (incl. persisted-job re-arm) runs
       AFTER login; failures inside never block readiness. */
    void bot.services?.reconcile?.run('boot');
  },
};
