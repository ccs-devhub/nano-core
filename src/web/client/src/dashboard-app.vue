<script setup lang="ts">
import { onMounted, watch } from 'vue';

import LangToggle from './components/lang-toggle.vue';
import TierBadge from './components/tier-badge.vue';
import UiSkeleton from './components/ui-skeleton.vue';
import { postLogout } from './lib/api';
import { CHROME_LANGUAGES, locale, setLocale, t } from './lib/i18n';
import { ensureSession, loginUrl, session } from './stores/session';

onMounted(async (): Promise<void> => {
  await ensureSession();
});

/* The document itself follows the interface language. */
watch(locale, (code: string): void => {
  document.documentElement.lang = code;
  document.title = `nano-core ${t('dashboard')}`;
}, { immediate: true });

async function logout(): Promise<void> {
  await postLogout();
  window.location.href = '/app/';
  session.authenticated = false;
  session.me = null;
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <h1 class="brand">
        nano-core <span class="dim">{{ t('dashboard') }}</span>
      </h1>
      <nav
        class="user"
        :aria-label="t('interface_language')"
      >
        <lang-toggle
          :options="CHROME_LANGUAGES"
          :model-value="locale"
          :label="t('interface_language')"
          @update:model-value="setLocale"
        />
        <template v-if="session.authenticated && session.me">
          <span class="dim">{{ session.me.user.username }}</span>
          <tier-badge v-if="session.me.host_owner" />
          <button @click="logout">
            {{ t('log_out') }}
          </button>
        </template>
      </nav>
    </header>

    <main class="content">
      <template v-if="!session.ready">
        <ui-skeleton
          :lines="3"
          height="48px"
        />
      </template>
      <template v-else-if="!session.authenticated">
        <section class="pane login">
          <h2>{{ t('log_in') }}</h2>
          <p class="dim">
            {{ t('login_blurb') }}
          </p>
          <a :href="loginUrl()">
            <button>{{ t('log_in_discord') }}</button>
          </a>
        </section>
      </template>
      <router-view v-else />
    </main>
  </div>
</template>

<style lang="scss">
@use './styles/base';
@use './styles/tokens' as t;

.shell {
  max-width: 960px;
  margin: 0 auto;
  padding: calc(t.$grid * 3);
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: t.$hair;
  padding-bottom: calc(t.$grid * 2);
  margin-bottom: calc(t.$grid * 3);

  .brand {
    font-size: 16px;
  }

  .user {
    display: flex;
    align-items: center;
    gap: t.$grid;
  }
}

.dim {
  color: t.$muted;
}

.pane {
  border: t.$hair;
  padding: calc(t.$grid * 3);
}

</style>
