<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import GearIcon from '../components/gear-icon.vue';
import LiveStats from '../components/live-stats.vue';
import UiSkeleton from '../components/ui-skeleton.vue';
import UiSwitch from '../components/ui-switch.vue';
import {
  cachedConfig,
  cachedDescriptor,
  cachedInstance,
  cachedModules,
  cachedStats,
  invalidateModuleConfig,
  warmModule
} from '../lib/api-cache';
import type { StatBar, StatTile } from '../lib/api';
import { putConfig } from '../lib/api';
import { t } from '../lib/i18n';
import type {
  DashboardField,
  InstanceInfo,
  ModuleRow
} from '../lib/types';

/**
 * The guild overview: the nano-core summary first (guild-relevant
 * facts only), then every module card with its guild-level enabled
 * toggle (when the module's descriptor declares one) and a
 * configure button.
 */
const route = useRoute();
const guild_id = String(route.params.gid);
const instance = ref<InstanceInfo | null>(null);
const modules = ref<ModuleRow[]>([]);
const error = ref('');
const loading = ref(true);
/** module name -> guild-level enabled state (undefined = no switch) */
const enabled_state = ref<Record<string, boolean | undefined>>({});
const stats = ref<StatTile[]>([]);
const stat_bars = ref<StatBar[]>([]);
const stats_updated = ref('');
const toggling = ref<Record<string, boolean>>({});
const notice = ref('');

function openable(row: ModuleRow): boolean {
  return row.has_descriptor && row.available;
}

async function loadToggles(): Promise<void> {
  for (const _row of modules.value) {
    if (!openable(_row)) {
      continue;
    }

    const [DESCRIPTOR, CONFIG] = await Promise.all([
      cachedDescriptor(guild_id, _row.name),
      cachedConfig(guild_id, _row.name),
    ]);

    const HAS_SWITCH = DESCRIPTOR.ok &&
      DESCRIPTOR.data?.manifest.config.fields.some(
        (field: DashboardField): boolean => {
          return field.key === 'enabled' && field.type === 'boolean';
        }
      );

    if (HAS_SWITCH && CONFIG.ok && CONFIG.data) {
      enabled_state.value = {
        ...enabled_state.value,
        [_row.name]: CONFIG.data.config.enabled === true,
      };
    }
  }
}

onMounted(async (): Promise<void> => {
  const [INSTANCE, MODULES] = await Promise.all([
    cachedInstance(guild_id),
    cachedModules(guild_id),
  ]);

  loading.value = false;

  if (INSTANCE.ok && INSTANCE.data) {
    instance.value = INSTANCE.data;
  } else {
    error.value = INSTANCE.error ?? t('load_failed');
  }

  if (MODULES.ok && MODULES.data) {
    modules.value = MODULES.data.modules;
    void loadToggles();
  }

  const STATS = await cachedStats(guild_id);

  if (STATS.ok && STATS.data) {
    stats.value = STATS.data.tiles;
    stat_bars.value = STATS.data.bars ?? [];
    stats_updated.value = new Date().toLocaleTimeString();
  }
});

async function toggleModule(row: ModuleRow): Promise<void> {
  const CURRENT = enabled_state.value[row.name];

  if (CURRENT === undefined || toggling.value[row.name]) {
    return;
  }

  toggling.value = { ...toggling.value, [row.name]: true };

  const CONFIG = await cachedConfig(guild_id, row.name);

  if (!CONFIG.ok || !CONFIG.data) {
    toggling.value = { ...toggling.value, [row.name]: false };
    return;
  }

  const RESULT = await putConfig(guild_id, row.name, {
    ...CONFIG.data.config,
    enabled: !CURRENT,
  });

  toggling.value = { ...toggling.value, [row.name]: false };

  if (RESULT.ok) {
    invalidateModuleConfig(guild_id, row.name);
    enabled_state.value = {
      ...enabled_state.value,
      [row.name]: !CURRENT,
    };
    notice.value = `${row.name}: ${
      !CURRENT ? t('enabled') : t('disabled')}`;
  } else {
    notice.value = `${row.name}: ${
      RESULT.error ?? t('toggle_failed')}`;
  }
}
</script>

<template>
  <section>
    <template v-if="loading">
      <ui-skeleton
        height="120px"
        width="100%"
      />
      <div class="module-grid skeleton-gap">
        <ui-skeleton
          v-for="index in 4"
          :key="index"
          height="56px"
        />
      </div>
    </template>
    <p
      v-else-if="error"
      class="error"
    >
      {{ error }}
    </p>
    <template v-else-if="instance">
      <div class="core-window">
        <div class="core-head">
          <h2 class="section-title">
            nano-core
          </h2>
          <span class="dim">v{{ instance.version }}</span>
        </div>
        <table>
          <tbody>
            <tr>
              <th>{{ t('bot') }}</th>
              <td>
                {{ instance.bot_username ?? instance.bot_name }}
              </td>
            </tr>
            <tr v-if="instance.intents">
              <th>{{ t('capabilities') }}</th>
              <td>{{ instance.intents.join(', ') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 class="section-title">
        {{ t('modules') }}
      </h2>
      <div class="module-grid">
        <div
          v-for="row in modules"
          :key="row.name"
          class="module-card"
          :class="{
            muted: !openable(row),
            clickable: enabled_state[row.name] !== undefined,
          }"
          :role="enabled_state[row.name] !== undefined
            ? 'button'
            : undefined"
          :tabindex="enabled_state[row.name] !== undefined
            ? 0
            : undefined"
          @mouseenter="openable(row) &&
            warmModule(guild_id, row.name)"
          @click="toggleModule(row)"
          @keydown.enter.prevent="toggleModule(row)"
          @keydown.space.prevent="toggleModule(row)"
        >
          <span class="name">{{ row.name }}</span>
          <div class="module-controls">
            <ui-switch
              v-if="enabled_state[row.name] !== undefined"
              :model-value="enabled_state[row.name] === true"
              :disabled="toggling[row.name]"
              :label="t('on_off', { name: row.name })"
              @click.stop
              @update:model-value="toggleModule(row)"
            />
            <router-link
              v-if="openable(row)"
              class="gear-link"
              :to="`/guilds/${guild_id}/modules/${row.name}`"
              :title="t('configure_name', { name: row.name })"
              @click.stop
            >
              <gear-icon />
            </router-link>
            <span
              v-else
              class="dim tiny"
            >
              {{ row.has_descriptor
                ? (row.reason ?? t('unavailable'))
                : t('no_dashboard') }}
            </span>
          </div>
        </div>
        <p
          v-if="modules.length === 0"
          class="dim"
        >
          {{ t('no_modules') }}
        </p>
      </div>
      <p
        v-if="notice"
        class="dim"
      >
        {{ notice }}
      </p>

      <template v-if="stats.length > 0">
        <h2 class="section-title stats-title">
          {{ t('guild_stats') }}
        </h2>
        <live-stats
          :tiles="stats"
          :bars="stat_bars"
          :updated-at="stats_updated"
        />
      </template>
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

.core-window {
  border: t.$hair;
  padding: calc(t.$grid * 2);
  margin-bottom: calc(t.$grid * 3);

  .core-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;

    .section-title {
      margin-bottom: t.$grid;
    }
  }

  th {
    width: 120px;
    color: t.$muted;
    font-weight: 400;
  }
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: t.$grid;
  margin-bottom: t.$grid;
}

.skeleton-gap {
  margin-top: calc(t.$grid * 3);
}

.module-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: t.$grid;
  border: t.$hair;
  padding: calc(t.$grid * 2);

  &:hover:not(.muted) {
    border-color: t.$accent;
  }

  &.clickable {
    cursor: pointer;
    user-select: none;
  }

  &.muted .name {
    color: t.$dim;
  }

  .name {
    font-family: t.$font-sans;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.module-controls {
  display: flex;
  align-items: center;
  gap: t.$grid;
  flex-shrink: 0;
}

.gear-link {
  display: flex;
  align-items: center;
  color: t.$muted;
  border: t.$hair;
  padding: 2px;

  &:hover {
    color: t.$accent;
    border-color: t.$accent;
  }
}

.tiny {
  font-size: 10px;
}

.error {
  color: t.$danger;
}

.stats-title {
  margin-top: calc(t.$grid * 3);
}


</style>
