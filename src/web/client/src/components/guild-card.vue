<script setup lang="ts">
import { guildMonogram } from '../lib/guild-icons';
import { vImageReady } from '../lib/image-ready';

/**
 * The guild identity card: square icon (or the monogram fallback)
 * over the truncated name, hairline-framed. Shared by the picker
 * grid and the shell tree — sizes differ, the anatomy never does.
 * The icon-ready emit fires once the bitmap is decodable (warm
 * caches included), for parents tracking readiness/retention.
 */
const props = withDefaults(defineProps<{
  name: string;
  icon: string | null;
  /** Monogram glyph size in px (picker 32, shell 40). */
  monogramSize?: number;
  iconReady?: boolean;
  dimmed?: boolean;
}>(), {
  monogramSize: 32,
  iconReady: true,
  dimmed: false,
});

const emit = defineEmits<{
  (event: 'icon-ready', el: HTMLImageElement): void;
}>();
</script>

<template>
  <span class="guild-card">
    <span class="icon-box">
      <img
        v-if="props.icon"
        v-image-ready="(el: HTMLImageElement): void => {
          emit('icon-ready', el);
        }"
        class="card-icon"
        :class="{ ready: props.iconReady, dimmed: props.dimmed }"
        :src="props.icon"
        :alt="props.name"
        loading="lazy"
        decoding="async"
      >
      <span
        v-else
        class="card-icon monogram ready"
        :style="{ fontSize: `${props.monogramSize}px` }"
      >
        {{ guildMonogram(props.name) }}
      </span>
    </span>
    <span class="card-meta">
      <span class="name">{{ props.name }}</span>
    </span>
  </span>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.guild-card {
  display: block;
}

.icon-box {
  position: relative;
  display: block;
}

.card-icon {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.25s ease;

  &.ready {
    opacity: 1;
  }

  &.dimmed {
    filter: grayscale(1) brightness(0.6);
  }

  &.monogram {
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: t.$font-sans;
    color: t.$muted;
    background: t.$surface-raised;
  }
}

.card-meta {
  display: block;
  padding: t.$grid;
  border-top: t.$hair;
  min-width: 0;

  .name {
    display: block;
    font-family: t.$font-sans;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
