<script setup lang="ts">
/**
 * The language toggle: a hairline row of language-code buttons
 * (EN ES ...). Serves the global interface language in the topbar
 * AND each module window's own declared language set. The optional
 * AUTO choice (empty value) means follow the global pick.
 */
const props = withDefaults(defineProps<{
  options: string[];
  modelValue: string;
  label: string;
  auto?: boolean;
  autoLabel?: string;
}>(), {
  auto: false,
  autoLabel: 'auto',
});

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
}>();
</script>

<template>
  <div
    class="lang-toggle"
    role="group"
    :aria-label="props.label"
  >
    <button
      v-if="props.auto"
      class="code"
      :class="{ active: props.modelValue === '' }"
      :data-tip="props.label"
      @click="emit('update:modelValue', '')"
    >
      {{ props.autoLabel }}
    </button>
    <button
      v-for="code in props.options"
      :key="code"
      class="code"
      :class="{ active: props.modelValue === code }"
      :data-tip="props.label"
      @click="emit('update:modelValue', code)"
    >
      {{ code }}
    </button>
  </div>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.lang-toggle {
  display: inline-flex;
}

.code {
  padding: 2px 8px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: t.$muted;

  & + .code {
    margin-left: -1px;
  }

  &.active {
    color: t.$text;
    border-color: t.$accent;
    position: relative;
    z-index: 1;
  }
}
</style>
