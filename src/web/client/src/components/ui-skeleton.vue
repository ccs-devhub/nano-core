<script setup lang="ts">
/**
 * Loading skeleton: flat pulsing blocks (opacity only — the Kyonax
 * laws allow no gradients; opacity animates on the compositor).
 * `lines` stacks that many blocks; `height`/`width` size each one.
 */
withDefaults(defineProps<{
  lines?: number;
  height?: string;
  width?: string;
}>(), {
  lines: 1,
  height: '16px',
  width: '100%',
});
</script>

<template>
  <div
    class="skeleton"
    aria-hidden="true"
  >
    <span
      v-for="index in lines"
      :key="index"
      class="block"
      :style="{ height, width }"
    />
  </div>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.skeleton {
  display: flex;
  flex-direction: column;
  gap: t.$grid;
}

.block {
  display: block;
  background: t.$surface-raised;
  border: t.$hair;
  animation: skeleton-pulse 1.2s ease-in-out infinite;
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 0.35;
  }

  50% {
    opacity: 0.9;
  }
}

@media (prefers-reduced-motion: reduce) {
  .block {
    animation: none;
    opacity: 0.5;
  }
}
</style>
