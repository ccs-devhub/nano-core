<script setup lang="ts">
/** Inline SVG cog (stroke follows currentColor; no external asset). */
</script>

<template>
  <svg
    class="gear"
    viewBox="0 0 16 16"
    width="14"
    height="14"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    aria-hidden="true"
  >
    <circle
      cx="8"
      cy="8"
      r="2.4"
    />
    <path
      d="M8 1.2v2.1M8 12.7v2.1M1.2 8h2.1M12.7 8h2.1
         M3.2 3.2l1.5 1.5M11.3 11.3l1.5 1.5
         M12.8 3.2l-1.5 1.5M4.7 11.3l-1.5 1.5"
    />
  </svg>
</template>

<style lang="scss" scoped>
.gear {
  display: block;
}
</style>
