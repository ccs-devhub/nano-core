<script setup lang="ts">
import { t } from '../lib/i18n';

/**
 * The tier badge (host / ops / discord): one bordered micro label,
 * colored by tier. Owns its own styles — the one place the badge
 * look lives.
 */
const props = withDefaults(defineProps<{
  tier?: string;
}>(), {
  tier: 'host',
});
</script>

<template>
  <span
    class="tier-badge"
    :class="props.tier"
  >{{ props.tier === 'host' ? t('host_badge') : props.tier }}</span>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.tier-badge {
  font-size: 10px;
  border: t.$hair;
  padding: 2px 6px;
  color: t.$muted;

  &.host {
    border-color: t.$warn;
    color: t.$warn;
  }

  &.ops {
    border-color: t.$muted;
  }

  &.discord {
    border-color: t.$dim;
    color: t.$dim;
  }
}
</style>
