import { createRouter, createWebHistory } from 'vue-router';

import GuildOverview from './views/guild-overview.vue';
import GuildPicker from './views/guild-picker.vue';
import GuildShell from './views/guild-shell.vue';
import ModuleWindow from './views/module-window.vue';

/** History base /app/ — the host serves the shell for /app/*. */
export const router = createRouter({
  history: createWebHistory('/app/'),
  routes: [
    { path: '/', component: GuildPicker },
    {
      path: '/guilds/:gid',
      component: GuildShell,
      children: [
        { path: '', component: GuildOverview },
        { path: 'modules/:mid', component: ModuleWindow },
      ],
    },
  ],
});
