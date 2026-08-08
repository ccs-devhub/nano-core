<script setup lang="ts">
import { computed, inject, ref } from 'vue';

import { LANG_PREFER_KEY, localized, t } from '../lib/i18n';
import type {
  DashboardAction,
  DashboardActionGroup,
  DashboardField,
  DataView,
  GuildReference,
  LocalizedText
} from '../lib/types';

import WidgetHost from './widget-host.vue';

/**
 * The run zone, shared by every module window: descriptor actions
 * grouped into unboxed full-width rows separated by hairlines.
 * Complex groups (with shared inputs) lead, stacking title and
 * description as rows with the params grid beside a VERTICAL
 * button stack; one-click runs sit last as single-line rows.
 * Fully descriptor-driven — any module's actions render here with
 * no per-module markup. Params live in this component; each run
 * emit carries the group's typed params.
 */
export interface RunGroup {
  key: string;
  title: string;
  help: string;
  see: string;
  actions: DashboardAction[];
  params: DashboardField[];
}

const props = withDefaults(defineProps<{
  actions: DashboardAction[];
  groups?: DashboardActionGroup[];
  views?: DataView[];
  reference: GuildReference | null;
  hostOwner: boolean;
  notice?: string;
}>(), {
  groups: (): DashboardActionGroup[] => {
    return [];
  },
  views: (): DataView[] => {
    return [];
  },
  notice: '',
});

const emit = defineEmits<{
  (
    event: 'run',
    action: DashboardAction,
    params: Record<string, unknown>
  ): void;
  (event: 'see', view_id: string): void;
}>();

const LANG_PREFER = inject<() => string[]>(LANG_PREFER_KEY, ():
string[] => {
  return [];
});

function mt(text: LocalizedText | undefined): string {
  return localized(text, LANG_PREFER());
}

const group_params = ref<Record<string, Record<string, unknown>>>({});

function paramsFor(key: string): Record<string, unknown> {
  if (!group_params.value[key]) {
    group_params.value[key] = {};
  }
  return group_params.value[key];
}

/** Actions sharing a descriptor group render as ONE row with
    shared deduped inputs (every operation targeting one shared
    id). */
const run_groups = computed((): RunGroup[] => {
  const GROUPS = new Map<string, RunGroup>();

  for (const _action of props.actions) {
    const KEY = _action.group ?? _action.id;
    const EXISTING = GROUPS.get(KEY);

    if (!EXISTING) {
      const META = props.groups.find(
        (group: DashboardActionGroup): boolean => {
          return group.id === KEY;
        }
      );

      GROUPS.set(KEY, {
        key: KEY,
        title: mt(META?.title ?? _action.group ?? _action.label)
          .toLowerCase(),
        help: mt(META?.help ??
          (_action.group ? '' : _action.help)),
        see: META?.see ?? '',
        actions: [_action],
        params: [..._action.params ?? []],
      });
      continue;
    }

    EXISTING.actions.push(_action);

    for (const _param of _action.params ?? []) {
      if (!EXISTING.params.some(
        (existing: DashboardField): boolean => {
          return existing.key === _param.key;
        }
      )) {
        EXISTING.params.push(_param);
      }
    }
  }
  /* Complex groups (with inputs) lead, one-click runs sit last. */
  return [...GROUPS.values()].sort(
    (a: RunGroup, b: RunGroup): number => {
      return Number(b.params.length > 0) -
        Number(a.params.length > 0);
    }
  );
});

function seeView(group: RunGroup): DataView | null {
  if (!group.see) {
    return null;
  }
  return props.views.find(
    (view: DataView): boolean => {
      return view.id === group.see;
    }
  ) ?? null;
}
</script>

<template>
  <div class="run-rows">
    <div
      v-for="group in run_groups"
      :key="group.key"
      class="run-row"
      :class="group.params.length > 0 ? 'complex' : 'simple'"
    >
      <div class="run-info">
        <span class="run-title">{{ group.title }}</span>
        <p
          v-if="group.help"
          class="run-desc dim"
        >
          {{ group.help }}
        </p>
        <button
          v-if="seeView(group)"
          class="see-link"
          type="button"
          @click="emit('see', group.see)"
        >
          {{ t('find_ids', {
            view: mt(seeView(group)?.title).toLowerCase(),
          }) }}
        </button>
      </div>
      <div class="run-controls">
        <div
          v-if="group.params.length > 0"
          class="run-params"
        >
          <widget-host
            v-for="param in group.params"
            :key="param.key"
            :field="param"
            :model-value="paramsFor(group.key)[param.key]"
            :reference="props.reference"
            :host-owner="props.hostOwner"
            @update:model-value="
              paramsFor(group.key)[param.key] = $event"
          />
        </div>
        <div class="run-buttons">
          <button
            v-for="action in group.actions"
            :key="action.id"
            class="mini"
            :class="{ danger: action.danger }"
            :data-tip="mt(action.help)"
            @click="emit('run', action, paramsFor(group.key))"
          >
            {{ mt(action.label).toLowerCase() }}
          </button>
        </div>
      </div>
    </div>
    <p
      v-if="props.notice"
      class="dim run-notice"
    >
      {{ props.notice }}
    </p>
  </div>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

/* Unboxed full-width rows separated by hairlines only. */
.run-rows {
  display: flex;
  flex-direction: column;
}

.run-row {
  padding: calc(t.$grid * 2) 0;

  & + & {
    border-top: t.$hair;
  }

  &:first-child {
    padding-top: t.$grid;
  }
}

.run-info {
  display: flex;
  flex-direction: column;
  gap: t.$grid;
  min-width: 0;

  .run-title {
    font-family: t.$font-sans;
    font-size: 13px;
  }

  .run-desc {
    font-size: 12px;
    line-height: 1.5;
    margin: 0;
    max-width: 72ch;
  }
}

.see-link {
  background: none;
  border: 0;
  padding: 0;
  width: fit-content;
  font-family: t.$font-mono;
  font-size: 11px;
  color: t.$muted;
  text-decoration: underline;
  cursor: pointer;

  &:hover {
    color: t.$accent;
  }
}

.run-row.complex .run-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: calc(t.$grid * 2);
  align-items: start;
  margin-top: t.$grid;

  /* The widget root carries its own top padding; match it so the
     button stack starts level with the field label. */
  .run-buttons {
    padding-top: t.$grid;
  }
}

.run-row.simple {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: calc(t.$grid * 2);

  .run-controls {
    flex-shrink: 0;
  }
}

.run-params {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 0 calc(t.$grid * 2);
  min-width: 0;
}

/* The button stack is VERTICAL: one action per line, uniform
   width, so rows stay legible on narrow screens. */
.run-buttons {
  display: flex;
  flex-direction: column;
  gap: t.$grid;
  align-items: stretch;
}

.run-notice {
  font-size: 11px;
  margin: t.$grid 0 0;
}

.mini {
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.4;
}

@media (max-width: 760px) {
  .run-row.complex .run-controls {
    grid-template-columns: minmax(0, 1fr);

    .run-buttons {
      padding-top: 0;
    }
  }

  .run-row.simple {
    flex-direction: column;
    align-items: stretch;
    gap: t.$grid;
  }
}
</style>
