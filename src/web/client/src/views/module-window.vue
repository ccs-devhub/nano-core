<script setup lang="ts">
import { computed, onMounted, provide, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import CommandCards from '../components/command-cards.vue';
import HelpMark from '../components/help-mark.vue';
import LangToggle from '../components/lang-toggle.vue';
import type {
  StatBarItem,
  StatTileItem
} from '../components/live-stats.vue';
import LiveStats from '../components/live-stats.vue';
import ModuleAbout from '../components/module-about.vue';
import RunRows from '../components/run-rows.vue';
import TierBadge from '../components/tier-badge.vue';
import UiSkeleton from '../components/ui-skeleton.vue';
import UiSwitch from '../components/ui-switch.vue';
import UiTable from '../components/ui-table.vue';
import WidgetHost from '../components/widget-host.vue';
import type { DescriptorData } from '../lib/api';
import {
  getData,
  postAction,
  putCommandGates,
  putConfig
} from '../lib/api';
import {
  cachedCommands,
  cachedConfig,
  cachedDescriptor,
  cachedGuilds,
  cachedReference,
  invalidateModuleCommands,
  invalidateModuleConfig
} from '../lib/api-cache';
import {
  LANG_PREFER_KEY,
  locale,
  localized,
  moduleLocale,
  setModuleLocale,
  t
} from '../lib/i18n';
import { GUILD_ID_KEY } from '../lib/member-names';
import type {
  CommandGate,
  ConfigObject,
  DashboardAction,
  DashboardField,
  DataView,
  GuildReference,
  LocalizedText,
  ModuleCommandsData
} from '../lib/types';
import { session } from '../stores/session';

/**
 * One module's window, SECTIONED: the shell's tree picks a config
 * field, a data view, or the action bar via ?s=; content renders
 * in-page (never modals). The edit model is still the WHOLE config
 * (the GET body edited in place), so the round-trip invariant and
 * the C5 placeholder law hold regardless of which section is
 * visible, and one save bar serves every config section.
 */
const route = useRoute();
const guild_id = String(route.params.gid);
const module_id = String(route.params.mid);

const descriptor = ref<DescriptorData | null>(null);

/** This module's language chain: reader pick, global, default. */
function langPrefer(): string[] {
  const LANGS = descriptor.value?.manifest.languages ?? [];
  return [moduleLocale(module_id), locale.value, LANGS[0] ?? ''];
}

provide(LANG_PREFER_KEY, langPrefer);
provide(GUILD_ID_KEY, guild_id);

/** Module descriptor text through the language chain. */
function mtext(text: LocalizedText | undefined): string {
  return localized(text, langPrefer());
}

const module_languages = computed((): string[] => {
  return descriptor.value?.manifest.languages ?? [];
});

/** Module asset filenames resolve through the host asset route. */
const asset_base = computed((): string => {
  return `/api/guilds/${guild_id}/modules/${module_id}/assets`;
});
const reference = ref<GuildReference | null>(null);
const config = ref<ConfigObject | null>(null);
const loading = ref(true);
const error = ref('');
const issues = ref<{ path: string; message: string }[]>([]);
const saving = ref(false);
const saved_keys = ref<string[]>([]);
const offers = ref<string[]>([]);
const action_notice = ref('');
const data_results = ref<Record<string, unknown>>({});
const action_params = ref<Record<string, Record<string, unknown>>>({});
const data_params = ref<Record<string, Record<string, unknown>>>({});
const commands_data = ref<ModuleCommandsData | null>(null);
const command_gates = ref<Record<string, CommandGate>>({});
const gates_busy = ref(false);
const gates_notice = ref('');

const host_owner = computed((): boolean => {
  return session.me?.host_owner === true;
});

const guild_name = ref(guild_id);

void cachedGuilds().then((result): void => {
  if (result.ok && result.data) {
    const HIT = result.data.guilds.find(
      (guild: { id: string }): boolean => {
        return guild.id === guild_id;
      }
    );

    if (HIT) {
      guild_name.value = HIT.name;
    }
  }
});

/**
 * Fields the CURRENT session may see: the module on/off boolean
 * lives on the overview card (never here), and host-tier fields
 * exist only for the env-configured bot owner.
 */
const visible_fields = computed((): DashboardField[] => {
  return (descriptor.value?.manifest.config.fields ?? [])
    .filter((field: DashboardField): boolean => {
      if (field.key === 'enabled' && field.type === 'boolean') {
        return false;
      }
      return field.tier !== 'host' || host_owner.value;
    });
});

/** A card is toggleable when the functionality has its own switch. */
function toggleKeyFor(field: DashboardField): string | null {
  if (field.type === 'boolean') {
    return field.key;
  }

  if (field.type === 'group') {
    const CHILD = field.fields.find(
      (child: DashboardField): boolean => {
        return child.key === 'enabled' && child.type === 'boolean';
      }
    );
    return CHILD ? `${field.key}.enabled` : null;
  }
  return null;
}

function toggleValue(field: DashboardField): boolean {
  const KEY = toggleKeyFor(field);

  if (!KEY || !config.value) {
    return false;
  }

  if (KEY.includes('.')) {
    const [PARENT, CHILD] = KEY.split('.');
    const GROUP = config.value[PARENT];
    return GROUP !== null && typeof GROUP === 'object' &&
      (GROUP as Record<string, unknown>)[CHILD] === true;
  }
  return config.value[KEY] === true;
}

const toggling_feature = ref<Record<string, boolean>>({});

async function toggleFeature(field: DashboardField): Promise<void> {
  const KEY = toggleKeyFor(field);

  if (!KEY || !config.value || toggling_feature.value[field.key]) {
    return;
  }

  toggling_feature.value = {
    ...toggling_feature.value,
    [field.key]: true,
  };

  const NEXT = structuredClone(config.value);

  if (KEY.includes('.')) {
    const [PARENT, CHILD] = KEY.split('.');
    const GROUP = NEXT[PARENT];

    if (GROUP !== null && typeof GROUP === 'object') {
      (GROUP as Record<string, unknown>)[CHILD] =
        !toggleValue(field);
    }
  } else {
    NEXT[KEY] = !toggleValue(field);
  }

  const RESULT = await putConfig(guild_id, module_id, NEXT);

  toggling_feature.value = {
    ...toggling_feature.value,
    [field.key]: false,
  };
  invalidateModuleConfig(guild_id, module_id);

  if (RESULT.ok && RESULT.data) {
    config.value = structuredClone(RESULT.data.config);
  } else {
    error.value = RESULT.error ?? t('toggle_failed');
  }
}

const version_mismatch = computed((): boolean => {
  const LOADED = descriptor.value;
  return LOADED !== null &&
    LOADED.registered_config_version !== null &&
    LOADED.manifest.config_version !==
      LOADED.registered_config_version;
});

/** Empty = the functionality-cards landing view. */
const selected = computed((): string => {
  return String(route.query.s ?? '');
});

const selected_field = computed((): DashboardField | null => {
  if (!selected.value.startsWith('f:')) {
    return null;
  }

  const KEY = selected.value.slice('f:'.length);
  return visible_fields.value.find(
    (field: DashboardField): boolean => {
      return field.key === KEY;
    }
  ) ?? null;
});

/**
 * The rendered section: when a group's on/off already lives on its
 * functionality card, the switch is NOT shown again inside the
 * panel (the model keeps the key, so saves lose nothing).
 */
const section_field = computed((): DashboardField | null => {
  const FIELD = selected_field.value;

  if (!FIELD) {
    return null;
  }

  if (FIELD.type === 'group' && toggleKeyFor(FIELD)) {
    return {
      ...FIELD,
      fields: FIELD.fields.filter(
        (child: DashboardField): boolean => {
          return !(child.key === 'enabled' &&
            child.type === 'boolean');
        }
      ),
    };
  }
  return FIELD;
});

const selected_view = computed((): DataView | null => {
  if (!selected.value.startsWith('data:')) {
    return null;
  }

  const ID = selected.value.slice('data:'.length);
  return descriptor.value?.manifest.data?.find(
    (view: DataView): boolean => {
      return view.id === ID;
    }
  ) ?? null;
});

onMounted(async (): Promise<void> => {
  const [DESCRIPTOR, CONFIG, REFERENCE, COMMANDS] = await Promise.all([
    cachedDescriptor(guild_id, module_id),
    cachedConfig(guild_id, module_id),
    cachedReference(guild_id),
    cachedCommands(guild_id, module_id),
  ]);

  if (COMMANDS.ok && COMMANDS.data) {
    commands_data.value = COMMANDS.data;
    command_gates.value = { ...COMMANDS.data.gates };
  }

  loading.value = false;

  if (!DESCRIPTOR.ok || !DESCRIPTOR.data) {
    error.value = DESCRIPTOR.error ?? t('descriptor_failed');
    return;
  }

  descriptor.value = DESCRIPTOR.data;

  if (CONFIG.ok && CONFIG.data) {
    config.value = structuredClone(CONFIG.data.config);
  } else {
    error.value = CONFIG.error ?? t('config_failed');
  }

  if (REFERENCE.ok && REFERENCE.data) {
    reference.value = REFERENCE.data;
  }
});

/* Auto-load a paramless data view when its section opens —
   never a manual one (the member-fetch law). */
watch(selected_view, (view: DataView | null): void => {
  if (view && !view.manual &&
      !(view.params && view.params.length > 0) &&
      data_results.value[view.id] === undefined) {
    void loadView(view);
  }
});

/* The landing shows every view inline: auto-load the paramless
   ones as soon as the descriptor arrives. */
watch(descriptor, (loaded: DescriptorData | null): void => {
  for (const _view of loaded?.manifest.data ?? []) {
    if (!_view.manual &&
        !(_view.params && _view.params.length > 0) &&
        data_results.value[_view.id] === undefined) {
      void loadView(_view);
    }
  }
});

/** C5: a widget renders only when its key exists in the config. */
function present(field: DashboardField): boolean {
  return config.value !== null && field.key in config.value;
}

function fieldValue(field: DashboardField): unknown {
  return config.value?.[field.key];
}

function updateField(field: DashboardField, value: unknown): void {
  if (config.value) {
    config.value = { ...config.value, [field.key]: value };
  }
}

async function save(): Promise<void> {
  if (!config.value || !descriptor.value) {
    return;
  }

  saving.value = true;
  issues.value = [];
  error.value = '';
  saved_keys.value = [];
  offers.value = [];

  const RESULT = await putConfig(guild_id, module_id, config.value);

  saving.value = false;

  if (!RESULT.ok) {
    error.value = RESULT.error ?? t('save_failed');
    issues.value = RESULT.issues ?? [];
    return;
  }

  invalidateModuleConfig(guild_id, module_id);

  if (RESULT.data) {
    config.value = structuredClone(RESULT.data.config);
    saved_keys.value = RESULT.data.changed_keys ?? [];

    /* D7: propagation is lazy — offer the follow-up actions the
       changed fields declare. */
    const OFFERED = new Set<string>();

    for (const FIELD of descriptor.value.manifest.config.fields) {
      if (saved_keys.value.includes(FIELD.key)) {
        for (const ACTION of FIELD.offer_actions ?? []) {
          OFFERED.add(ACTION);
        }
      }
    }

    offers.value = [...OFFERED];
  }
}

/** Instant gate writes: PUT the whole object, the server diffs. */
async function saveGates(
  next: Record<string, CommandGate>
): Promise<void> {
  if (gates_busy.value) {
    return;
  }

  gates_busy.value = true;

  const PREVIOUS = command_gates.value;

  command_gates.value = next;

  const RESULT = await putCommandGates(guild_id, module_id, next);

  gates_busy.value = false;
  invalidateModuleCommands(guild_id, module_id);

  if (RESULT.ok && RESULT.data) {
    command_gates.value = { ...RESULT.data.gates };
    gates_notice.value = RESULT.data.changed_paths.length > 0
      ? `${t('saved')} ${RESULT.data.changed_paths.join(', ')}`
      : '';
  } else {
    command_gates.value = PREVIOUS;
    gates_notice.value = RESULT.error ?? t('save_failed');
  }
}

function issueFor(field: DashboardField): string | null {
  const HIT = issues.value.find(
    (issue: { path: string }): boolean => {
      return issue.path === field.key ||
        issue.path.startsWith(`${field.key}.`);
    }
  );
  return HIT ? HIT.message : null;
}

function otherIssues(): { path: string; message: string }[] {
  const FIELD = selected_field.value;

  if (!FIELD) {
    return issues.value;
  }
  return issues.value.filter(
    (issue: { path: string }): boolean => {
      return issue.path !== FIELD.key &&
        !issue.path.startsWith(`${FIELD.key}.`);
    }
  );
}

/** The run zone renders through the GLOBAL run-rows component;
    this view only filters visibility and executes the emits. */
const visible_actions = computed((): DashboardAction[] => {
  return (descriptor.value?.manifest.actions ?? [])
    .filter(actionVisible);
});

async function runGrouped(
  action: DashboardAction,
  params: Record<string, unknown>
): Promise<void> {
  if (action.confirm !== undefined && action.confirm !== false) {
    const MESSAGE = action.confirm === true
      ? t('confirm_run', { label: mtext(action.label) })
      : mtext(action.confirm);

    if (!window.confirm(MESSAGE)) {
      return;
    }
  }

  action_notice.value = t('running', { id: action.id });

  const RESULT = await postAction(
    guild_id,
    module_id,
    action.id,
    params
  );

  action_notice.value = RESULT.ok
    ? `${action.id}: ${t('done')}`
    : `${action.id}: ${RESULT.error ?? t('failed')}`;
}

function scrollToView(view_id: string): void {
  document.getElementById(`live-${view_id}`)?.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
}

function actionByName(action_id: string): DashboardAction | null {
  return (descriptor.value?.manifest.actions ?? []).find(
    (action: DashboardAction): boolean => {
      return action.id === action_id;
    }
  ) ?? null;
}

function actionVisible(action: DashboardAction): boolean {
  return (action.actor_gate ?? 'ops') !== 'host' || host_owner.value;
}

function paramsFor(
  store: Record<string, Record<string, unknown>>,
  id: string
): Record<string, unknown> {
  if (!store[id]) {
    store[id] = {};
  }
  return store[id];
}

async function runAction(action: DashboardAction): Promise<void> {
  if (action.confirm !== undefined && action.confirm !== false) {
    const MESSAGE = action.confirm === true
      ? t('confirm_run', { label: mtext(action.label) })
      : mtext(action.confirm);

    if (!window.confirm(MESSAGE)) {
      return;
    }
  }

  action_notice.value = t('running', { id: action.id });

  const RESULT = await postAction(
    guild_id,
    module_id,
    action.id,
    paramsFor(action_params.value, action.id)
  );

  action_notice.value = RESULT.ok
    ? `${action.id}: ${t('done')}`
    : `${action.id}: ${RESULT.error ?? t('failed')}`;
}

async function runOffer(action_id: string): Promise<void> {
  const ACTION = actionByName(action_id);

  if (ACTION) {
    await runAction(ACTION);
  }
}

const view_loading = ref<Record<string, boolean>>({});
const view_updated = ref<Record<string, string>>({});

/** Providers may return {tiles:[{label,value,hint?}]} for counters. */
function viewTiles(view: DataView): StatTileItem[] {
  const RESULT = data_results.value[view.id];

  if (RESULT !== null && typeof RESULT === 'object' &&
      Array.isArray((RESULT as { tiles?: unknown }).tiles)) {
    return (RESULT as { tiles: StatTileItem[] }).tiles;
  }
  return [];
}

/** The optional {bars} half of the same provider convention. */
function viewBars(view: DataView): StatBarItem[] {
  const RESULT = data_results.value[view.id];

  if (RESULT !== null && typeof RESULT === 'object' &&
      Array.isArray((RESULT as { bars?: unknown }).bars)) {
    return (RESULT as { bars: StatBarItem[] }).bars;
  }
  return [];
}

async function loadView(view: DataView): Promise<void> {
  /* In-flight guard: the descriptor watcher and the section watcher
     can both reach a view before its first result lands; a second
     request would trip the server's core throttle floor and replace
     good data with a cooldown error. */
  if (view_loading.value[view.id]) {
    return;
  }

  view_loading.value = { ...view_loading.value, [view.id]: true };

  const RAW = paramsFor(data_params.value, view.id);
  const QUERY: Record<string, string> = {};

  for (const [_key, _value] of Object.entries(RAW)) {
    if (_value !== undefined && _value !== null && _value !== '') {
      QUERY[_key] = String(_value);
    }
  }

  const RESULT = await getData(guild_id, module_id, view.id, QUERY);

  data_results.value = {
    ...data_results.value,
    [view.id]: RESULT.ok
      ? RESULT.data
      : { error: RESULT.error },
  };
  view_loading.value = { ...view_loading.value, [view.id]: false };
  view_updated.value = {
    ...view_updated.value,
    [view.id]: new Date().toLocaleTimeString(),
  };
}

function viewRows(view: DataView): Record<string, unknown>[] {
  const RESULT = data_results.value[view.id];

  if (RESULT === undefined || RESULT === null) {
    return [];
  }

  if (Array.isArray(RESULT)) {
    return RESULT as Record<string, unknown>[];
  }

  const VALUES = Object.values(RESULT as Record<string, unknown>);
  const FIRST_LIST = VALUES.find((value: unknown): boolean => {
    return Array.isArray(value);
  });
  return Array.isArray(FIRST_LIST)
    ? FIRST_LIST as Record<string, unknown>[]
    : [];
}

function viewRaw(view: DataView): string {
  const RESULT = data_results.value[view.id];
  return RESULT === undefined ? '' : JSON.stringify(RESULT, null, 2);
}
</script>

<template>
  <section>
    <template v-if="loading">
      <ui-skeleton
        height="14px"
        width="40%"
      />
      <div class="feature-grid skeleton-gap">
        <ui-skeleton
          v-for="index in 6"
          :key="index"
          height="88px"
        />
      </div>
    </template>

    <template v-else-if="descriptor">
      <nav
        class="crumbs"
        :aria-label="t('breadcrumb')"
      >
        <router-link
          class="crumb-link"
          to="/"
        >
          {{ t('guilds') }}
        </router-link>
        <span class="dim sep">/</span>
        <router-link
          class="crumb-link"
          :to="`/guilds/${guild_id}`"
        >
          {{ guild_name }}
        </router-link>
        <span class="dim sep">/</span>
        <router-link
          class="crumb-link"
          :to="{ path: route.path }"
        >
          {{ mtext(descriptor.manifest.title).toLowerCase() }}
        </router-link>
        <template v-if="selected">
          <span class="dim sep">/</span>
          <span class="crumb-here">
            {{ selected_field
              ? mtext(selected_field.label).toLowerCase()
              : selected_view
                ? mtext(selected_view.title).toLowerCase()
                : selected === 'commands'
                  ? t('commands')
                  : t('actions') }}
          </span>
        </template>
        <span
          v-if="module_languages.length > 1"
          class="crumb-tools"
        >
          <lang-toggle
            :options="module_languages"
            :model-value="moduleLocale(module_id)"
            :label="t('module_language')"
            auto
            :auto-label="t('follow_global')"
            @update:model-value="setModuleLocale(module_id, $event)"
          />
        </span>
      </nav>

      <p v-if="selected">
        <router-link
          class="dim back-link"
          :to="{ path: route.path }"
        >
          &lt; {{ t('back_to', {
            name: mtext(descriptor.manifest.title).toLowerCase(),
          }) }}
        </router-link>
      </p>

      <p
        v-if="version_mismatch"
        class="warn banner"
      >
        {{ t('version_mismatch', {
          a: descriptor.manifest.config_version,
          b: descriptor.registered_config_version ?? '',
        }) }}
      </p>

      <p
        v-if="error"
        class="error banner"
      >
        {{ error }}
      </p>

      <p
        v-if="!loading && !reference"
        class="dim reference-note"
      >
        {{ t('reference_missing') }}
      </p>

      <!-- The landing: the about header first, then the run
           strip, the functionality cards, the live data. -->
      <module-about
        v-if="!selected && descriptor.manifest.about"
        :about="descriptor.manifest.about"
        :asset-base="asset_base"
      />

      <template v-if="!selected && visible_actions.length > 0">
        <div
          v-if="descriptor.manifest.about"
          class="live-divider"
        >
          <span class="dim">{{ t('run') }}</span>
        </div>
        <run-rows
          :actions="visible_actions"
          :groups="descriptor.manifest.action_groups"
          :views="descriptor.manifest.data"
          :reference="reference"
          :host-owner="host_owner"
          :notice="action_notice"
          @run="runGrouped"
          @see="scrollToView"
        />
        <div class="live-divider">
          <span class="dim">{{ t('configure') }}</span>
        </div>
      </template>

      <div
        v-if="!selected"
        class="feature-grid"
      >
        <router-link
          v-for="field in visible_fields"
          :key="field.key"
          class="feature-card"
          :to="{ path: route.path, query: { s: `f:${field.key}` } }"
        >
          <div class="feature-head">
            <span class="feature-name">{{ mtext(field.label) }}</span>
            <span
              v-if="toggleKeyFor(field)"
              class="card-switch"
              @click.stop.prevent
            >
              <ui-switch
                :model-value="toggleValue(field)"
                :disabled="toggling_feature[field.key]"
                :label="t('on_off', { name: mtext(field.label) })"
                @update:model-value="toggleFeature(field)"
              />
            </span>
            <tier-badge
              v-else-if="(field.tier ?? 'discord') === 'host'"
            />
          </div>
          <p
            v-if="field.help"
            class="dim feature-desc"
          >
            {{ mtext(field.help) }}
          </p>
          <p
            v-else-if="field.propagation"
            class="dim feature-desc"
          >
            {{ mtext(field.propagation) }}
          </p>
        </router-link>
        <router-link
          v-if="(commands_data?.counts.commands ?? 0) > 0"
          class="feature-card"
          :to="{ path: route.path, query: { s: 'commands' } }"
        >
          <div class="feature-head">
            <span class="feature-name">{{ t('commands') }}</span>
            <span class="dim tiny-count">
              {{ commands_data?.counts.commands }} /
              {{ commands_data?.counts.subcommands }}
            </span>
          </div>
          <p class="dim feature-desc">
            {{ t('commands_card_desc') }}
          </p>
        </router-link>
      </div>

      <!-- Live data: not cards — a divider, then every view inline. -->
      <template v-if="!selected && (descriptor.manifest.data?.length)">
        <div
          v-if="visible_actions.length > 0 || visible_fields.length > 0"
          class="live-divider"
        >
          <span class="dim">{{ t('live') }}</span>
        </div>
        <div
          v-for="view in descriptor.manifest.data"
          :id="`live-${view.id}`"
          :key="view.id"
          class="live-view"
        >
          <div class="data-head">
            <span class="live-title">
              <span class="accent-bar" />{{
                mtext(view.title).toLowerCase() }}
              <help-mark
                v-if="view.help"
                :tip="mtext(view.help)"
              />
            </span>
            <button
              class="mini"
              @click="loadView(view)"
            >
              {{ data_results[view.id] === undefined
                ? t('load')
                : t('reload') }}
            </button>
          </div>
          <div
            v-if="view.params?.length"
            class="view-params"
          >
            <widget-host
              v-for="param in view.params"
              :key="param.key"
              :field="param"
              :model-value="paramsFor(data_params, view.id)[param.key]"
              :reference="reference"
              :host-owner="host_owner"
              @update:model-value="
                paramsFor(data_params, view.id)[param.key] = $event"
            />
          </div>
          <ui-skeleton
            v-if="view_loading[view.id]"
            :lines="2"
            height="16px"
          />

          <!-- counters: the shared open-strip presentation -->
          <live-stats
            v-else-if="viewTiles(view).length > 0 ||
              viewBars(view).length > 0"
            :tiles="viewTiles(view)"
            :bars="viewBars(view)"
            :updated-at="view_updated[view.id] ?? ''"
          />

          <!-- tables: searchable + paginated -->
          <ui-table
            v-else-if="view.columns && viewRows(view).length > 0"
            :columns="view.columns.map(
              (column: { key: string; label: LocalizedText }):
                { key: string; label: string } => {
                return {
                  key: column.key,
                  label: mtext(column.label),
                };
              })"
            :rows="viewRows(view)"
            :updated-at="view_updated[view.id] ?? ''"
          />

          <!-- raw payloads: the data beside its explanation -->
          <div
            v-else-if="viewRaw(view)"
            class="raw-split"
          >
            <pre class="raw">{{ viewRaw(view) }}</pre>
            <div class="raw-explain">
              <p
                v-if="view.explain ?? view.help"
                class="dim"
              >
                {{ mtext(view.explain ?? view.help) }}
              </p>
              <p
                v-else
                class="dim"
              >
                {{ t('raw_fallback') }}
              </p>
              <router-link
                v-if="descriptor.manifest.actions?.length"
                :to="{ path: route.path, query: { s: 'actions' } }"
              >
                <button class="mini">
                  {{ t('open_actions') }}
                </button>
              </router-link>
              <p
                v-if="view_updated[view.id]"
                class="stamp dim"
              >
                {{ t('updated', {
                  time: view_updated[view.id],
                }) }}
              </p>
            </div>
          </div>
        </div>
      </template>

      <!-- One config section at a time; ONE save bar for all. -->
      <div
        v-else-if="selected_field && config"
        class="config-pane"
      >
        <template v-if="present(selected_field)">
          <widget-host
            :field="section_field ?? selected_field"
            :model-value="fieldValue(selected_field)"
            :reference="reference"
            :host-owner="host_owner"
            @update:model-value="updateField(selected_field, $event)"
          />
          <p
            v-if="issueFor(selected_field)"
            class="error issue"
          >
            {{ issueFor(selected_field) }}
          </p>
        </template>
        <div
          v-else
          class="placeholder"
        >
          <span class="dim">
            {{ t('not_present', {
              label: mtext(selected_field.label),
            }) }}
          </span>
        </div>

        <p
          v-for="issue in otherIssues()"
          :key="issue.path"
          class="error issue"
        >
          {{ issue.path }}: {{ issue.message }}
        </p>

        <div class="save-bar">
          <button
            :disabled="saving"
            @click="save"
          >
            {{ saving ? t('saving') : t('save_changes') }}
          </button>
          <span class="dim">{{ t('saves_every') }}</span>
          <span
            v-if="saved_keys.length > 0"
            class="ok"
          >
            {{ t('saved') }} {{ saved_keys.join(', ') }}
          </span>
        </div>

        <div
          v-if="offers.length > 0"
          class="offers"
        >
          <span class="dim">{{ t('apply_now') }}</span>
          <button
            v-for="offer in offers"
            :key="offer"
            @click="runOffer(offer)"
          >
            {{ actionByName(offer)
              ? mtext(actionByName(offer)!.label)
              : offer }}
          </button>
        </div>
      </div>

      <!-- One data view at a time. -->
      <div
        v-else-if="selected_view"
        class="data-view"
      >
        <div
          v-if="selected_view.params?.length"
          class="view-params"
        >
          <widget-host
            v-for="param in selected_view.params"
            :key="param.key"
            :field="param"
            :model-value="
              paramsFor(data_params, selected_view.id)[param.key]"
            :reference="reference"
            :host-owner="host_owner"
            @update:model-value="
              paramsFor(data_params, selected_view.id)[param.key] =
                $event"
          />
        </div>
        <div class="data-head">
          <span class="dim">{{ mtext(selected_view.title) }}</span>
          <button @click="loadView(selected_view)">
            {{ data_results[selected_view.id] === undefined
              ? t('load')
              : t('reload') }}
          </button>
        </div>
        <live-stats
          v-if="viewTiles(selected_view).length > 0 ||
            viewBars(selected_view).length > 0"
          :tiles="viewTiles(selected_view)"
          :bars="viewBars(selected_view)"
          :updated-at="view_updated[selected_view.id] ?? ''"
        />
        <ui-table
          v-else-if="selected_view.columns &&
            viewRows(selected_view).length > 0"
          :columns="selected_view.columns.map(
            (column: { key: string; label: LocalizedText }):
              { key: string; label: string } => {
              return {
                key: column.key,
                label: mtext(column.label),
              };
            })"
          :rows="viewRows(selected_view)"
          :updated-at="view_updated[selected_view.id] ?? ''"
        />
        <pre
          v-else-if="viewRaw(selected_view)"
          class="raw"
        >{{ viewRaw(selected_view) }}</pre>
      </div>

      <!-- The command surface, deep-linked (?s=commands). -->
      <template v-else-if="selected === 'commands' && commands_data">
        <command-cards
          :guild-id="guild_id"
          :commands="commands_data.commands"
          :gates="command_gates"
          :ungateable="commands_data.ungateable"
          :reference="reference"
          :counts="commands_data.counts"
          :busy="gates_busy"
          @update:gates="saveGates"
        />
        <p
          v-if="gates_notice"
          class="dim run-notice"
        >
          {{ gates_notice }}
        </p>
      </template>

      <!-- The run strip, deep-linked (?s=actions). -->
      <template v-else-if="selected === 'actions'">
        <div class="live-divider">
          <span class="dim">{{ t('run') }}</span>
        </div>
        <run-rows
          :actions="visible_actions"
          :groups="descriptor.manifest.action_groups"
          :views="descriptor.manifest.data"
          :reference="reference"
          :host-owner="host_owner"
          :notice="action_notice"
          @run="runGrouped"
          @see="scrollToView"
        />
      </template>
    </template>

    <p
      v-else-if="error"
      class="error"
    >
      {{ error }}
    </p>
  </section>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.crumbs {
  display: flex;
  align-items: center;
  gap: t.$grid;
  font-size: 13px;
  margin-bottom: t.$grid;

  .crumb-tools {
    margin-left: auto;
  }

  .crumb-link {
    text-decoration: none;
    color: t.$muted;

    &:hover {
      color: t.$accent;
    }
  }

  .crumb-here {
    font-family: t.$font-sans;
  }
}

.back-link {
  font-size: 12px;
  text-decoration: none;

  &:hover {
    color: t.$accent;
  }
}

.card-switch {
  display: inline-flex;
}

.skeleton-gap {
  margin-top: calc(t.$grid * 2);
}

.feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: t.$grid;
}

.feature-card {
  display: block;
  border: t.$hair;
  padding: calc(t.$grid * 2);
  text-decoration: none;

  &:hover {
    border-color: t.$accent;
  }
}

.feature-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: t.$grid;

  .feature-name {
    font-family: t.$font-sans;
    font-size: 13px;
  }
}

.feature-desc {
  font-size: 11px;
  margin: t.$grid 0 0;
  line-height: 1.5;
}

.banner {
  border: t.$hair;
  padding: t.$grid;
}

.warn {
  color: t.$warn;
  border-color: t.$warn;
}

.error {
  color: t.$danger;
}

.ok {
  color: t.$ok;
}

.tiny-count {
  font-size: 10px;
}

.run-notice {
  font-size: 11px;
  margin: t.$grid 0 0;
}

.config-pane {
  border: t.$hair;
  padding: calc(t.$grid * 2);
  margin-bottom: calc(t.$grid * 3);
}

.placeholder {
  border: 1px dashed t.$hairline;
  padding: t.$grid;
  margin-bottom: t.$grid;
}

.issue {
  font-size: 11px;
  margin: 0 0 t.$grid calc(t.$grid * 2);
}

.save-bar {
  display: flex;
  gap: calc(t.$grid * 2);
  align-items: center;
  margin-top: calc(t.$grid * 2);
  border-top: t.$hair;
  padding-top: calc(t.$grid * 2);
}

.offers {
  display: flex;
  gap: t.$grid;
  align-items: center;
  margin-top: t.$grid;
}

.data-view {
  border: t.$hair;
  padding: t.$grid;
  margin-bottom: t.$grid;
}

.live-divider {
  display: flex;
  align-items: center;
  gap: t.$grid;
  margin: calc(t.$grid * 3) 0 calc(t.$grid * 2);

  span {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  &::after {
    content: '';
    flex: 1;
    border-top: t.$hair;
  }
}

.live-view {
  margin-bottom: calc(t.$grid * 3);

  .live-title {
    font-family: t.$font-sans;
    font-size: 13px;
    display: inline-flex;
    align-items: center;
  }
}

.raw-split {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(200px, 2fr);
  gap: calc(t.$grid * 2);
  align-items: start;

  .raw {
    margin: 0;
    border: t.$hair;
    padding: t.$grid;
    max-height: 320px;
    overflow: auto;
  }

  .raw-explain {
    display: flex;
    flex-direction: column;
    gap: t.$grid;
    font-size: 12px;
  }
}

.mini {
  padding: 2px 8px;
  font-size: 11px;
}

.view-params {
  margin-bottom: t.$grid;
}

.data-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: t.$grid;
}

.raw {
  font-size: 11px;
  color: t.$muted;
  overflow-x: auto;
}

/* The live view heads: the accent tick before each title and the
   raw-view update stamp. */
.accent-bar {
  display: inline-block;
  width: 3px;
  height: 12px;
  background: t.$accent;
  margin-right: t.$grid;
}

.reference-note {
  font-size: 11px;
  margin: 0 0 t.$grid;
}

.stamp {
  font-size: 10px;
  letter-spacing: 0.5px;
  text-align: right;
  margin: calc(t.$grid / 2) 0 0;
}
</style>
