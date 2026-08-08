<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import GuildCard from '../components/guild-card.vue';
import UiSkeleton from '../components/ui-skeleton.vue';
import type { DescriptorData } from '../lib/api';
import {
  cachedCommands,
  cachedDescriptor,
  cachedGuilds,
  cachedModules,
  ICON_SIZE,
  warmGuild,
  warmGuilds,
  warmModule
} from '../lib/api-cache';
import { guildIconUrl } from '../lib/guild-icons';
import { locale, localized, moduleLocale, t } from '../lib/i18n';
import type {
  ClassifiedGuild,
  DashboardField,
  ModuleRow
} from '../lib/types';
import { session } from '../stores/session';

/**
 * The guild shell: one left tree for everything inside a guild —
 * the guild card on top, the overview, every module, and (when a
 * module is open) that module's config sections, data views, and
 * actions. Content renders in the nested router-view; sections are
 * in-page (never modals).
 */
const route = useRoute();
const guild_id = computed((): string => {
  return String(route.params.gid);
});
const module_id = computed((): string | null => {
  return route.params.mid ? String(route.params.mid) : null;
});

const guild = ref<ClassifiedGuild | null>(null);
const modules = ref<ModuleRow[]>([]);
const descriptor = ref<DescriptorData | null>(null);

async function loadGuild(): Promise<void> {
  const RESULT = await cachedGuilds();

  if (RESULT.ok && RESULT.data) {
    guild.value = RESULT.data.guilds.find(
      (item: ClassifiedGuild): boolean => {
        return item.id === guild_id.value;
      }
    ) ?? null;
  }
}

async function loadModules(): Promise<void> {
  const RESULT = await cachedModules(guild_id.value);

  modules.value = RESULT.ok && RESULT.data
    ? RESULT.data.modules
    : [];
}

const commands_count = ref(0);

async function loadDescriptor(): Promise<void> {
  if (!module_id.value) {
    descriptor.value = null;
    commands_count.value = 0;
    return;
  }

  const [RESULT, COMMANDS] = await Promise.all([
    cachedDescriptor(guild_id.value, module_id.value),
    cachedCommands(guild_id.value, module_id.value),
  ]);

  descriptor.value = RESULT.ok && RESULT.data ? RESULT.data : null;
  commands_count.value = COMMANDS.ok && COMMANDS.data
    ? COMMANDS.data.counts.commands
    : 0;
}

watch(guild_id, (): void => {
  void loadGuild();
  void loadModules();
}, { immediate: true });

watch(module_id, (): void => {
  void loadDescriptor();
}, { immediate: true });

function openable(row: ModuleRow): boolean {
  return row.has_descriptor && row.available;
}

interface SectionLink {
  id: string;
  label: string;
}

const config_sections = computed((): SectionLink[] => {
  return (descriptor.value?.manifest.config.fields ?? [])
    .filter((field: DashboardField): boolean => {
      /* The module on/off slider lives on the overview card; host
         fields exist only for the env-configured bot owner. */
      if (field.key === 'enabled' && field.type === 'boolean') {
        return false;
      }
      return field.tier !== 'host' || session.me?.host_owner === true;
    })
    .map((field: DashboardField): SectionLink => {
      return {
        id: `f:${field.key}`,
        label: localized(field.label, sectionLangs()),
      };
    });
});

/** The open module's language chain: pick, global, its default. */
function sectionLangs(): string[] {
  const LANGS = descriptor.value?.manifest.languages ?? [];
  return [
    module_id.value ? moduleLocale(module_id.value) : '',
    locale.value,
    LANGS[0] ?? '',
  ];
}

const has_actions = computed((): boolean => {
  return (descriptor.value?.manifest.actions ?? []).length > 0;
});

function sectionActive(section_id: string): boolean {
  return String(route.query.s ?? '') === section_id;
}

function icon(): string | null {
  return guild.value
    ? guildIconUrl(guild.value.id, guild.value.icon, ICON_SIZE)
    : null;
}
</script>

<template>
  <div class="guild-shell">
    <aside class="tree">
      <router-link
        class="back dim"
        to="/"
        @mouseenter="warmGuilds()"
        @focus="warmGuilds()"
      >
        &lt; {{ t('guilds') }}
      </router-link>

      <ui-skeleton
        v-if="!guild"
        height="280px"
      />
      <div
        v-else
        class="tree-card"
      >
        <guild-card
          :name="guild?.name ?? guild_id"
          :icon="icon()"
          :monogram-size="40"
        />
      </div>

      <nav
        class="nav"
        :aria-label="t('guild_navigation')"
      >
        <router-link
          class="nav-item"
          :class="{ active: !module_id }"
          :to="`/guilds/${guild_id}`"
          @mouseenter="warmGuild(guild_id)"
          @focus="warmGuild(guild_id)"
        >
          {{ t('overview') }}
        </router-link>

        <span class="nav-group dim">{{ t('modules') }}</span>
        <template
          v-for="row in modules"
          :key="row.name"
        >
          <router-link
            v-if="openable(row)"
            class="nav-item"
            :class="{ active: module_id === row.name }"
            :to="`/guilds/${guild_id}/modules/${row.name}`"
            @mouseenter="warmModule(guild_id, row.name)"
            @focus="warmModule(guild_id, row.name)"
          >
            {{ row.name }}
          </router-link>
          <span
            v-else
            class="nav-item disabled"
          >
            {{ row.name }}
            <span class="dim tiny">
              {{ row.has_descriptor
                ? (row.reason ?? t('unavailable'))
                : t('no_dashboard') }}
            </span>
          </span>

          <template v-if="module_id === row.name && descriptor">
            <span
              v-if="config_sections.length > 0"
              class="nav-group dim indent"
            >{{ t('config') }}</span>
            <router-link
              v-for="section in config_sections"
              :key="section.id"
              class="nav-item child"
              :class="{ active: sectionActive(section.id) }"
              :to="{ path: `/guilds/${guild_id}/modules/${row.name}`,
                     query: { s: section.id } }"
            >
              {{ section.label.toLowerCase() }}
            </router-link>

            <router-link
              v-if="commands_count > 0"
              class="nav-item child"
              :class="{ active: sectionActive('commands') }"
              :to="{ path: `/guilds/${guild_id}/modules/${row.name}`,
                     query: { s: 'commands' } }"
            >
              {{ t('commands') }}
            </router-link>

            <template v-if="has_actions">
              <span class="nav-group dim indent">{{ t('run') }}</span>
              <router-link
                class="nav-item child"
                :class="{ active: sectionActive('actions') }"
                :to="{ path: `/guilds/${guild_id}/modules/${row.name}`,
                       query: { s: 'actions' } }"
              >
                {{ t('actions') }}
              </router-link>
            </template>
          </template>
        </template>
      </nav>
    </aside>

    <section class="pane-content">
      <router-view />
    </section>
  </div>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.guild-shell {
  display: flex;
  gap: calc(t.$grid * 3);
  align-items: flex-start;
}

.tree {
  width: 240px;
  flex-shrink: 0;
  border-right: t.$hair;
  padding-right: calc(t.$grid * 2);
  position: sticky;
  top: t.$grid;
}

.back {
  display: block;
  margin-bottom: calc(t.$grid * 2);
  text-decoration: none;
  font-size: 12px;
}

.tree-card {
  border: t.$hair;
  margin-bottom: calc(t.$grid * 2);
}

.nav {
  display: flex;
  flex-direction: column;
}

.nav-group {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: calc(t.$grid * 2) 0 calc(t.$grid / 2);

  &.indent {
    margin-left: calc(t.$grid * 2);
  }
}

.nav-item {
  display: block;
  padding: calc(t.$grid / 2) t.$grid;
  border-left: 2px solid transparent;
  text-decoration: none;
  font-size: 13px;
  color: t.$text;

  &:hover {
    border-left-color: t.$hairline;
  }

  &.active {
    border-left-color: t.$accent;
    background: t.$surface;
  }

  &.child {
    margin-left: calc(t.$grid * 2);
    font-size: 12px;
  }

  &.disabled {
    color: t.$dim;
    display: flex;
    justify-content: space-between;
    gap: t.$grid;
  }
}

.tiny {
  font-size: 10px;
}

.pane-content {
  flex: 1;
  min-width: 0;
}
</style>
