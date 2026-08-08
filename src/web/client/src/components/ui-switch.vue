<script setup lang="ts">
import { t } from '../lib/i18n';

/**
 * The Kyonax Book slider: a squared track + sliding knob (no radius,
 * hairline borders). Follows switch best practice: role="switch",
 * aria-checked, keyboard operable (native button), disabled state.
 */
defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  label?: string;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
}>();
</script>

<template>
  <button
    type="button"
    class="ui-switch"
    :class="{ on: modelValue }"
    role="switch"
    :aria-checked="modelValue"
    :aria-label="label ?? t('toggle')"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="knob" />
  </button>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.ui-switch {
  width: 36px;
  min-width: 36px;
  height: 18px;
  padding: 2px;
  border: t.$hair;
  background: t.$surface;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  /* A flex item must never squeeze the track — a shrunken track
     lets the knob's travel escape the border. */
  flex-shrink: 0;

  .knob {
    width: 12px;
    height: 12px;
    background: t.$dim;
    transform: translateX(0);
    transition: transform 0.15s ease, background 0.15s ease;
  }

  &.on {
    border-color: t.$ok;

    .knob {
      background: t.$ok;
      transform: translateX(18px);
    }
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  &:hover:not(:disabled) {
    border-color: t.$accent;
  }
}
</style>
