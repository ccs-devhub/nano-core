<script setup lang="ts">
import { inject } from 'vue';

import { LANG_PREFER_KEY, localized } from '../lib/i18n';
import type { DashboardAbout, LocalizedText } from '../lib/types';

import MediaCarousel from './media-carousel.vue';

/**
 * The module presentation header (the repo-README idea inside the
 * dashboard), stacked full width: media carousel, then the shields
 * badges, then the description, then the module's command surface
 * as tags. Fully descriptor-driven — any module that ships an
 * `about` block gets this with no host changes.
 */
const props = defineProps<{
  about: DashboardAbout;
  assetBase: string;
}>();

const LANG_PREFER = inject<() => string[]>(LANG_PREFER_KEY, ():
string[] => {
  return [];
});

function mt(text: LocalizedText | undefined): string {
  return localized(text, LANG_PREFER());
}

interface TextSegment {
  text: string;
  strong: boolean;
}

/** Split '**bold**' enclosures: odd split-parts are the bright
    words, everything else keeps the muted body color. */
function boldSegments(text: string): TextSegment[] {
  const PARTS = text.split('**');

  if (PARTS.length % 2 === 0) {
    return [{ text, strong: false }];
  }
  return PARTS
    .map((part: string, i: number): TextSegment => {
      return { text: part, strong: i % 2 === 1 };
    })
    .filter((segment: TextSegment): boolean => {
      return segment.text.length > 0;
    });
}
</script>

<template>
  <div class="module-about">
    <media-carousel
      v-if="props.about.media?.length"
      :media="props.about.media"
      :asset-base="props.assetBase"
    />
    <div
      v-if="props.about.badges?.length"
      class="badges"
    >
      <template
        v-for="(badge, i) in props.about.badges"
        :key="i"
      >
        <a
          v-if="badge.href"
          :href="badge.href"
          target="_blank"
          rel="noreferrer"
        >
          <img
            :src="badge.image"
            :alt="mt(badge.alt)"
            loading="lazy"
            decoding="async"
          >
        </a>
        <img
          v-else
          :src="badge.image"
          :alt="mt(badge.alt)"
          loading="lazy"
          decoding="async"
        >
      </template>
    </div>
    <p class="description">
      <template
        v-for="(segment, i) in boldSegments(mt(props.about.description))"
        :key="i"
      >
        <strong v-if="segment.strong">{{ segment.text }}</strong>
        <template v-else>
          {{ segment.text }}
        </template>
      </template>
    </p>
    <div
      v-if="props.about.commands?.length"
      class="commands"
    >
      <span
        v-for="command in props.about.commands"
        :key="command.name"
        class="command-tag"
        :data-tip="mt(command.help) || undefined"
        :tabindex="command.help ? 0 : undefined"
      >
        {{ command.name }}
      </span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.module-about {
  margin-bottom: calc(t.$grid * 2);
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: t.$grid;
  align-items: center;
  justify-content: center;
  margin-top: calc(t.$grid * 2);

  img {
    display: block;
    height: 20px;
  }
}

.description {
  font-size: 12px;
  line-height: 1.7;
  margin: calc(t.$grid * 2) 0 0;
  color: t.$muted;

  strong {
    color: t.$text;
  }
}

.commands {
  display: flex;
  flex-wrap: wrap;
  gap: t.$grid;
  margin-top: calc(t.$grid * 2);
}

.command-tag {
  font-size: 11px;
  color: t.$muted;
  border: t.$hair;
  background: t.$surface;
  padding: 2px t.$grid;
  cursor: default;

  &:hover {
    color: t.$text;
    border-color: t.$accent;
  }
}
</style>
