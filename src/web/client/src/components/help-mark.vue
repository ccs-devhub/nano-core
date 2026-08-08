<script setup lang="ts">
/**
 * The ? tooltip mark: a 14px bordered square carrying a data-tip
 * bubble, keyboard focusable. One place for the look every help
 * hover shares.
 */
defineProps<{
  tip: string;
}>();
</script>

<template>
  <span
    class="help-mark"
    :data-tip="tip"
    tabindex="0"
  >?</span>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.help-mark {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: t.$muted;
  border: t.$hair;
  cursor: help;
  flex-shrink: 0;
  margin-left: t.$grid;
}
</style>
