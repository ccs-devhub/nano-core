<script setup lang="ts">
import { computed, inject } from 'vue';

import { LANG_PREFER_KEY, localized, t } from '../lib/i18n';
import { GUILD_ID_KEY, memberLabel, memberResolved } from
  '../lib/member-names';
import type {
  DashboardField,
  GroupField,
  GuildReference,
  LocalizedText,
  VariantCase,
  VariantField
} from '../lib/types';
import { defaultFor } from '../lib/widget-defaults';
import HelpMark from './help-mark.vue';
import TierBadge from './tier-badge.vue';
import UiSelect from './ui-select.vue';
import UiSwitch from './ui-switch.vue';

/**
 * The descriptor-driven widget renderer: one recursive component per
 * field, dispatching on `type`. Laws carried here: tier badges on
 * every field, HOST-tier fields disabled unless the session is the
 * bot owner (C6 — the server enforces the same rule on PUT), and
 * pickers fed from the guild reference instead of raw ids where the
 * kind allows.
 */
const props = defineProps<{
  field: DashboardField;
  modelValue: unknown;
  reference: GuildReference | null;
  hostOwner: boolean;
  disabled?: boolean;
  /** Skip the label row (array items are titled by their header). */
  hideHead?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: unknown): void;
}>();

const LANG_PREFER = inject<() => string[]>(LANG_PREFER_KEY, ():
string[] => {
  return [];
});

const GUILD_ID = inject<string>(GUILD_ID_KEY, '');

function mt(text: LocalizedText | undefined): string {
  return localized(text, LANG_PREFER());
}

const locked = computed((): boolean => {
  if (props.disabled) {
    return true;
  }
  return props.field.tier === 'host' && !props.hostOwner;
});

const tier = computed((): string => {
  return props.field.tier ?? 'discord';
});

const slots_hint = computed((): string => {
  const FIELD = props.field;

  if (FIELD.type !== 'template' || !FIELD.slots?.length) {
    return '';
  }
  return FIELD.slots.map((slot: string): string => {
    return `{${slot}}`;
  }).join(' ');
});

function update(value: unknown): void {
  emit('update:modelValue', value);
}

function groupValue(): Record<string, unknown> {
  return (props.modelValue ?? {}) as Record<string, unknown>;
}

function updateGroupChild(child_key: string, value: unknown): void {
  update({ ...groupValue(), [child_key]: value });
}

function arrayValue(): unknown[] {
  return Array.isArray(props.modelValue) ? props.modelValue : [];
}

function arrayAdd(): void {
  const FIELD = props.field;

  if (FIELD.type !== 'array') {
    return;
  }

  update([...arrayValue(), defaultFor(FIELD.item)]);
}

function arrayRemove(index: number): void {
  const NEXT = [...arrayValue()];

  NEXT.splice(index, 1);
  update(NEXT);
}

function arrayMove(index: number, delta: number): void {
  const NEXT = [...arrayValue()];
  const TARGET = index + delta;

  if (TARGET < 0 || TARGET >= NEXT.length) {
    return;
  }

  const [ITEM] = NEXT.splice(index, 1);

  NEXT.splice(TARGET, 0, ITEM);
  update(NEXT);
}

function arrayUpdate(index: number, value: unknown): void {
  const NEXT = [...arrayValue()];

  NEXT[index] = value;
  update(NEXT);
}

function variantField(): VariantField {
  return props.field as VariantField;
}

function variantValue(): Record<string, unknown> {
  return (props.modelValue ?? {}) as Record<string, unknown>;
}

function activeCase(): VariantCase | null {
  const FIELD = variantField();
  const CURRENT = variantValue()[FIELD.discriminator];
  return FIELD.variants.find((item: VariantCase): boolean => {
    return item.value === CURRENT;
  }) ?? null;
}

function switchCase(value: string): void {
  const FIELD = variantField();
  const CASE = FIELD.variants.find((item: VariantCase): boolean => {
    return item.value === value;
  });
  const NEXT: Record<string, unknown> = {
    [FIELD.discriminator]: value,
  };

  for (const CHILD of CASE?.fields ?? []) {
    NEXT[CHILD.key] = defaultFor(CHILD);
  }

  update(NEXT);
}

function updateVariantChild(child_key: string, value: unknown): void {
  update({ ...variantValue(), [child_key]: value });
}

function snowflakeOptions(): {
  id: string;
  label: string;
  color?: string;
}[] {
  const FIELD = props.field;

  if (FIELD.type !== 'snowflake' && FIELD.type !== 'snowflake_list') {
    return [];
  }

  if (!props.reference || FIELD.kind === 'user') {
    return [];
  }

  if (FIELD.kind === 'role') {
    return props.reference.roles.map(
      (role: { id: string; name: string; color: string }): {
        id: string;
        label: string;
        color?: string;
      } => {
        return { id: role.id, label: role.name, color: role.color };
      }
    );
  }
  return props.reference.channels.map(
    (channel: { id: string; name: string }): {
      id: string;
      label: string;
    } => {
      return { id: channel.id, label: channel.name };
    }
  );
}

function listLabel(entry: string): string {
  const FIELD = props.field;
  const HIT = snowflakeOptions().find(
    (option: { id: string }): boolean => {
      return option.id === entry;
    }
  );

  if (HIT) {
    return HIT.label;
  }

  if (
    (FIELD.type === 'snowflake_list' || FIELD.type === 'snowflake') &&
    FIELD.kind === 'user'
  ) {
    return memberLabel(GUILD_ID, entry);
  }
  return entry;
}

function listSwatch(entry: string): string | null {
  const COLOR = snowflakeOptions().find(
    (option: { id: string }): boolean => {
      return option.id === entry;
    }
  )?.color;
  return COLOR && COLOR !== '#000000' ? COLOR : null;
}

function listValue(): string[] {
  return Array.isArray(props.modelValue)
    ? props.modelValue as string[]
    : [];
}

function listAdd(value: string): void {
  if (!value || listValue().includes(value)) {
    return;
  }

  update([...listValue(), value]);
}

function listRemove(index: number): void {
  const NEXT = [...listValue()];

  NEXT.splice(index, 1);
  update(NEXT);
}

function asGroup(field: DashboardField): GroupField {
  return field as GroupField;
}

/** Small widgets sit side by side inside a group; big ones span. */
function spans(field: DashboardField): boolean {
  return field.type === 'template' || field.type === 'group' ||
    field.type === 'array' || field.type === 'variant' ||
    field.type === 'snowflake_list';
}
</script>

<template>
  <div
    class="widget"
    :class="{ locked }"
  >
    <div
      v-if="!hideHead"
      class="widget-head"
    >
      <label
        class="widget-label"
        :class="{ 'section-label': field.type === 'group' ||
          field.type === 'array' || field.type === 'variant' }"
      >{{ mt(field.label) }}</label>
      <help-mark
        v-if="field.help"
        :tip="mt(field.help)"
      />
      <tier-badge v-if="tier === 'host'" />
      <span
        v-if="locked && field.tier === 'host'"
        class="dim lock-note"
      >{{ t('owner_only') }}</span>
    </div>

    <!-- boolean: the slider, same as everywhere else -->
    <ui-switch
      v-if="field.type === 'boolean'"
      :model-value="modelValue === true"
      :disabled="locked"
      :label="mt(field.label)"
      @update:model-value="update($event)"
    />

    <!-- number -->
    <input
      v-else-if="field.type === 'number'"
      type="number"
      :value="modelValue ?? ''"
      :aria-label="mt(field.label)"
      :min="field.min"
      :max="field.max"
      :step="field.step"
      :disabled="locked"
      @input="update(Number(($event.target as HTMLInputElement).value))"
    >

    <!-- text / color-as-text -->
    <input
      v-else-if="field.type === 'text' || field.type === 'color'"
      type="text"
      :value="modelValue ?? ''"
      :aria-label="mt(field.label)"
      :placeholder="field.type === 'color'
        ? '#rrggbb'
        : mt(field.placeholder)"
      :disabled="locked"
      @input="update(($event.target as HTMLInputElement).value)"
    >

    <!-- template: a real message box — multiline, Discord markdown
         (enclosures, mentions, newlines) passes through verbatim -->
    <template v-else-if="field.type === 'template'">
      <textarea
        class="message-box"
        rows="4"
        :value="String(modelValue ?? '')"
        :aria-label="mt(field.label)"
        :placeholder="field.placeholder
          ? mt(field.placeholder)
          : t('template_placeholder')"
        :disabled="locked"
        @input="update(($event.target as HTMLTextAreaElement).value)"
      />
      <p
        v-if="slots_hint"
        class="dim slots-hint"
      >
        {{ t('slots') }} {{ slots_hint }}
      </p>
    </template>

    <!-- select -->
    <ui-select
      v-else-if="field.type === 'select'"
      :options="field.options.map((option: string):
        { id: string; label: string } => {
        return { id: option, label: option };
      })"
      :model-value="String(modelValue ?? '')"
      :disabled="locked"
      @update:model-value="update($event ?? '')"
    />

    <!-- snowflake: clearing emits null (nullable schema keys). -->
    <template v-else-if="field.type === 'snowflake'">
      <ui-select
        v-if="snowflakeOptions().length > 0"
        :options="snowflakeOptions()"
        :model-value="modelValue ? String(modelValue) : null"
        :placeholder="t('none_option')"
        clearable
        :disabled="locked"
        @update:model-value="update($event)"
      />
      <input
        v-else
        type="text"
        :value="modelValue ?? ''"
        :aria-label="mt(field.label)"
        :placeholder="field.placeholder
          ? mt(field.placeholder)
          : t('snowflake_id')"
        :disabled="locked"
        @input="update(($event.target as HTMLInputElement).value)"
      >
      <p
        v-if="field.kind === 'user' && modelValue &&
          memberResolved(GUILD_ID, String(modelValue))"
        class="resolved-name"
      >
        {{ t('resolves_to', {
          name: memberLabel(GUILD_ID, String(modelValue)),
        }) }}
      </p>
    </template>

    <!-- snowflake_list -->
    <div
      v-else-if="field.type === 'snowflake_list'"
      class="snowflake-list"
    >
      <div
        v-for="(entry, index) in listValue()"
        :key="`${entry}-${index}`"
        class="list-row"
      >
        <code class="list-label">
          <span
            v-if="listSwatch(entry)"
            class="list-swatch"
            :style="{ background: listSwatch(entry) ?? '' }"
          />
          {{ listLabel(entry) }}
        </code>
        <button
          class="mini danger"
          :data-tip="t('remove_from_list')"
          :disabled="locked"
          @click="listRemove(index)"
        >
          &times;
        </button>
      </div>
      <div class="list-row add-row">
        <ui-select
          v-if="snowflakeOptions().length > 0"
          :options="snowflakeOptions().filter(
            (option: { id: string }): boolean => {
              return !listValue().includes(option.id);
            })"
          :model-value="null"
          :placeholder="t('add_ellipsis')"
          :disabled="locked"
          @update:model-value="$event && listAdd($event)"
        />
        <input
          v-else
          type="text"
          :aria-label="t('add_to', { label: mt(field.label) })"
          :placeholder="t('add_id_enter')"
          :disabled="locked"
          @keydown.enter="
            listAdd(($event.target as HTMLInputElement).value);
            ($event.target as HTMLInputElement).value = ''"
        >
      </div>
    </div>

    <!-- group: small fields flow side by side, big ones span -->
    <div
      v-else-if="field.type === 'group'"
      class="group group-grid"
    >
      <widget-host
        v-for="child in asGroup(field).fields"
        :key="child.key"
        :field="child"
        :model-value="groupValue()[child.key]"
        :reference="reference"
        :host-owner="hostOwner"
        :disabled="locked"
        :class="{ 'span-all': spans(child) }"
        @update:model-value="updateGroupChild(child.key, $event)"
      />
    </div>

    <!-- array -->
    <div
      v-else-if="field.type === 'array'"
      class="array"
    >
      <div
        v-for="(item, index) in arrayValue()"
        :key="index"
        class="array-item"
      >
        <div class="array-controls">
          <span class="item-title">
            {{ mt(field.item.label).toLowerCase() }} {{ index + 1 }}
          </span>
          <span class="item-buttons">
            <template v-if="field.ordered">
              <button
                class="mini"
                :data-tip="t('move_up')"
                :disabled="locked || index === 0"
                @click="arrayMove(index, -1)"
              >
                &uarr;
              </button>
              <button
                class="mini"
                :data-tip="t('move_down')"
                :disabled="locked || index === arrayValue().length - 1"
                @click="arrayMove(index, 1)"
              >
                &darr;
              </button>
            </template>
            <button
              class="mini danger"
              :data-tip="t('remove_entry')"
              :disabled="locked"
              @click="arrayRemove(index)"
            >
              &times;
            </button>
          </span>
        </div>
        <widget-host
          :field="field.item"
          :model-value="item"
          :reference="reference"
          :host-owner="hostOwner"
          :disabled="locked"
          hide-head
          @update:model-value="arrayUpdate(index, $event)"
        />
      </div>
      <button
        :disabled="locked ||
          (field.max !== undefined && arrayValue().length >= field.max)"
        @click="arrayAdd"
      >
        {{ t('add_item', {
          label: mt(field.item.label).toLowerCase(),
        }) }}
      </button>
    </div>

    <!-- variant -->
    <div
      v-else-if="field.type === 'variant'"
      class="variant"
    >
      <ui-select
        :options="variantField().variants.map(
          (variant: VariantCase):
            { id: string; label: string } => {
            return {
              id: variant.value,
              label: variant.label
                ? mt(variant.label)
                : variant.value,
            };
          })"
        :model-value="String(
          variantValue()[variantField().discriminator] ?? '')"
        :disabled="locked"
        @update:model-value="$event && switchCase($event)"
      />
      <div
        v-if="activeCase()"
        class="group"
      >
        <widget-host
          v-for="child in activeCase()!.fields"
          :key="child.key"
          :field="child"
          :model-value="variantValue()[child.key]"
          :reference="reference"
          :host-owner="hostOwner"
          :disabled="locked"
          @update:model-value="updateVariantChild(child.key, $event)"
        />
      </div>
    </div>

    <p
      v-if="field.propagation"
      class="dim help"
    >
      {{ mt(field.propagation) }}
    </p>
  </div>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.widget {
  padding: t.$grid 0;

  &.locked > .widget-head .widget-label {
    color: t.$dim;
  }
}

.widget-head {
  display: flex;
  align-items: center;
  gap: t.$grid;
  margin-bottom: calc(t.$grid / 2);
}

.widget-label {
  font-family: t.$font-sans;
  font-size: 13px;

  &.section-label {
    font-family: t.$font-mono;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: t.$muted;
  }
}

.mini {
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.4;
}

.help {
  font-size: 11px;
  margin: 2px 0 t.$grid;
}

.resolved-name {
  font-size: 10px;
  color: t.$ok;
  margin: calc(t.$grid / 2) 0 0;
}

.list-swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
}

.message-box {
  width: 100%;
  resize: vertical;
  line-height: 1.5;
}

.slots-hint {
  font-size: 10px;
  margin: 2px 0 0;
}

.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0 calc(t.$grid * 2);
  align-items: start;
}

.span-all {
  grid-column: 1 / -1;
}

.lock-note {
  font-size: 10px;
}

.group,
.array {
  margin-top: t.$grid;
}

.array-item {
  border: t.$hair;
  padding: t.$grid;
  margin-bottom: t.$grid;
}

.array-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: t.$grid;
  margin-bottom: t.$grid;
  border-bottom: t.$hair;
  padding-bottom: t.$grid;

  .item-title {
    font-family: t.$font-sans;
    font-size: 12px;
    color: t.$muted;
  }

  .item-buttons {
    display: flex;
    gap: calc(t.$grid / 2);
  }
}

.snowflake-list {
  border: t.$hair;
  padding: t.$grid;
}

.list-row {
  display: flex;
  justify-content: space-between;
  gap: t.$grid;
  align-items: center;
  padding: calc(t.$grid / 2) 0;

  &:not(:last-child) {
    border-bottom: t.$hair;
  }

  .list-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  &.add-row {
    border-bottom: none;

    select,
    input {
      width: 100%;
    }
  }
}

.widget input,
.widget select,
.widget textarea {
  width: 100%;
  max-width: 320px;
}

.widget .message-box {
  max-width: none;
}
</style>
