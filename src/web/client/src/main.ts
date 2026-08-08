import { createApp } from 'vue';

import DashboardApp from './dashboard-app.vue';
import { router } from './router';

createApp(DashboardApp).use(router)
  .mount('#app');
