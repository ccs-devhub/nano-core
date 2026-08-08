<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * The Kyonax dropdown: native <option> popups cannot be styled, so
 * the trigger opens a hairline panel of option rows in our own look.
 * Click-outside and Escape close it; the trigger is a real button.
 */
import { t } from '../lib/i18n';

const props = defineProps<{
  options: { id: string; label: string; color?: string }[];
  modelValue: string | null;
  placeholder?: string;
  disabled?: boolean;
  /** Allow picking nothing (renders a (none) row emitting null). */
  clearable?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string | null): void;
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function current(): { label: string; color?: string } {
  const HIT = props.options.find(
    (option: { id: string }): boolean => {
      return option.id === props.modelValue;
    }
  );
  return HIT ?? {
    label: props.placeholder ?? t('select_placeholder'),
  };
}

/** Discord serializes colorless roles as #000000 — no swatch. */
function swatch(color?: string): string | null {
  return color && color !== '#000000' ? color : null;
}

function pick(value: string | null): void {
  open.value = false;
  emit('update:modelValue', value);
}

function onDocumentClick(event: MouseEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) {
    open.value = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    open.value = false;
  }
}

onMounted((): void => {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount((): void => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div
    ref="root"
    class="ui-select"
    :class="{ open }"
  >
    <button
      type="button"
      class="trigger"
      :class="{ placeholder: !modelValue }"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="trigger-label">
        <span
          v-if="modelValue && swatch(current().color)"
          class="opt-swatch"
          :style="{ background: swatch(current().color) ?? '' }"
        />
        {{ current().label }}
      </span>
      <span class="caret">{{ open ? '-' : '+' }}</span>
    </button>
    <div
      v-if="open"
      class="options"
      role="listbox"
    >
      <button
        v-if="clearable"
        type="button"
        class="option none"
        @click="pick(null)"
      >
        {{ t('none_option') }}
      </button>
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        class="option"
        :class="{ selected: option.id === modelValue }"
        @click="pick(option.id)"
      >
        <span
          v-if="swatch(option.color)"
          class="opt-swatch"
          :style="{ background: swatch(option.color) ?? '' }"
        />
        {{ option.label }}
      </button>
      <span
        v-if="options.length === 0"
        class="option none"
      >{{ t('nothing_to_pick') }}</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.ui-select {
  position: relative;
  width: 100%;
}

.trigger {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: t.$grid;
  text-align: left;
  padding: t.$grid;
  background: t.$surface;

  &.placeholder .trigger-label {
    color: t.$dim;
  }

  .trigger-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caret {
    color: t.$dim;
    flex-shrink: 0;
  }
}

.options {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  background: t.$bg;
  border: t.$hair;
  z-index: 20;
  display: flex;
  flex-direction: column;
}

.opt-swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  flex-shrink: 0;
}

.option {
  border: none;
  border-bottom: t.$hair;
  text-align: left;
  padding: t.$grid;
  background: t.$bg;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: t.$surface-raised;
    border-color: t.$hairline;
  }

  &.selected {
    color: t.$ok;
  }

  &.none {
    color: t.$dim;
  }
}
</style>
