<script setup lang="ts">
import { onMounted, ref } from 'vue';

import GuildCard from '../components/guild-card.vue';
import UiSkeleton from '../components/ui-skeleton.vue';
import { cachedGuilds, ICON_SIZE, warmGuild } from '../lib/api-cache';
import { guildIconUrl } from '../lib/guild-icons';
import { t } from '../lib/i18n';
import { retainImageUrl } from '../lib/warm';
import type { ClassifiedGuild } from '../lib/types';

const guilds = ref<ClassifiedGuild[]>([]);
const error = ref('');
const loading = ref(true);
const ready_icons = ref<Set<string>>(new Set());

onMounted(async (): Promise<void> => {
  const RESULT = await cachedGuilds();

  loading.value = false;

  if (RESULT.ok && RESULT.data) {
    guilds.value = RESULT.data.guilds;
  } else {
    error.value = RESULT.error ?? t('load_guilds_failed');
  }
});

function configurable(): ClassifiedGuild[] {
  return guilds.value.filter((guild: ClassifiedGuild): boolean => {
    return guild.state === 'configurable';
  });
}

function invitable(): ClassifiedGuild[] {
  return guilds.value.filter((guild: ClassifiedGuild): boolean => {
    return guild.state === 'invitable';
  });
}

function icon(guild: ClassifiedGuild): string | null {
  return guildIconUrl(guild.id, guild.icon, ICON_SIZE);
}

function markReady(guild_id: string, el: HTMLImageElement): void {
  ready_icons.value = new Set([...ready_icons.value, guild_id]);
  retainImageUrl(el.currentSrc || el.src);
}
</script>

<template>
  <section>
    <h2 class="section-title">
      {{ t('your_guilds') }}
    </h2>
    <div
      v-if="loading"
      class="guild-grid"
    >
      <ui-skeleton
        v-for="index in 6"
        :key="index"
        height="180px"
      />
    </div>
    <p
      v-else-if="error"
      class="error"
    >
      {{ error }}
    </p>
    <template v-else>
      <div class="guild-grid">
        <router-link
          v-for="guild in configurable()"
          :key="guild.id"
          class="guild-card"
          :to="`/guilds/${guild.id}`"
          :title="`${guild.name} - ${t('configurable')}`"
          @mouseenter="warmGuild(guild.id)"
          @focus="warmGuild(guild.id)"
        >
          <guild-card
            :name="guild.name"
            :icon="icon(guild)"
            :icon-ready="ready_icons.has(guild.id)"
            @icon-ready="(el: HTMLImageElement): void => {
              markReady(guild.id, el);
            }"
          />
        </router-link>
      </div>

      <template v-if="invitable().length > 0">
        <h2 class="section-title invite-title">
          {{ t('invite_bot') }}
        </h2>
        <div class="guild-grid">
          <a
            v-for="guild in invitable()"
            :key="guild.id"
            class="guild-card"
            :href="guild.invite_url"
            target="_blank"
            rel="noreferrer"
            :aria-label="`${guild.name} - ${t('invite_bot')}`"
            :data-tip="t('invite_bot')"
          >
            <guild-card
              :name="guild.name"
              :icon="icon(guild)"
              dimmed
            />
          </a>
        </div>
      </template>

      <p
        v-if="guilds.length === 0"
        class="dim"
      >
        {{ t('no_guilds') }}
      </p>
    </template>
  </section>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.section-title {
  font-size: 14px;
  color: t.$muted;
  margin-bottom: calc(t.$grid * 2);
}

.invite-title {
  margin-top: calc(t.$grid * 4);
}

.guild-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: calc(t.$grid * 2);
}

.guild-card {
  display: block;
  border: t.$hair;
  text-decoration: none;

  &:hover {
    border-color: t.$accent;
  }
}

.error {
  color: t.$danger;
}
</style>
