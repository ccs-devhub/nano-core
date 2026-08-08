<script setup lang="ts">
import { inject } from 'vue';

import { LANG_PREFER_KEY, localized, t } from '../lib/i18n';
import type { LocalizedText } from '../lib/types';

/**
 * The shared live-counters presentation: an open stat strip (no
 * boxes, tooltipped entries), optional segmented composition bars,
 * and the decorative update stamp. Any provider returning the
 * {tiles, bars?} convention renders through THIS component — the
 * overview and every module data view included.
 */
export interface StatTileItem {
  label: LocalizedText;
  value: string | number;
  hint?: LocalizedText;
}

export interface StatBarItem {
  label: LocalizedText;
  segments: { label: LocalizedText; value: number }[];
}

const LANG_PREFER = inject<() => string[]>(LANG_PREFER_KEY, ():
string[] => {
  return [];
});

function mt(text: LocalizedText | undefined): string {
  return localized(text, LANG_PREFER());
}

const props = withDefaults(defineProps<{
  tiles: StatTileItem[];
  bars?: StatBarItem[];
  updatedAt?: string;
}>(), {
  bars: (): StatBarItem[] => {
    return [];
  },
  updatedAt: '',
});

function barTotal(bar: StatBarItem): number {
  return bar.segments.reduce(
    (sum: number, segment: { value: number }): number => {
      return sum + segment.value;
    },
    0
  );
}

function segmentWidth(bar: StatBarItem, value: number): string {
  const TOTAL = barTotal(bar);
  return TOTAL > 0 ? `${(value / TOTAL) * 100}%` : '0%';
}
</script>

<template>
  <div class="live-stats">
    <div
      v-if="props.tiles.length > 0"
      class="stat-strip"
    >
      <div
        v-for="tile in props.tiles"
        :key="mt(tile.label)"
        class="stat-entry"
        :data-tip="mt(tile.hint)"
        :tabindex="tile.hint ? 0 : undefined"
      >
        <span class="stat-label dim">{{ mt(tile.label) }}</span>
        <span class="stat-value">{{ tile.value }}</span>
      </div>
    </div>

    <div
      v-for="bar in props.bars"
      :key="mt(bar.label)"
      class="mix-bar"
    >
      <span class="mix-label dim">{{ mt(bar.label) }}</span>
      <div class="mix-track">
        <span
          v-for="(segment, index) in bar.segments"
          :key="mt(segment.label)"
          class="mix-segment"
          :class="`seg-${index}`"
          :style="{ width: segmentWidth(bar, segment.value) }"
          :data-tip="`${mt(segment.label)}: ${segment.value}`"
          tabindex="0"
        />
      </div>
      <span class="mix-legend dim">
        <span
          v-for="(segment, index) in bar.segments"
          :key="mt(segment.label)"
          class="legend-item"
        >
          <span
            class="legend-swatch"
            :class="`seg-${index}`"
          />
          {{ mt(segment.label) }} {{ segment.value }}
        </span>
      </span>
    </div>

    <p
      v-if="props.updatedAt"
      class="stamp dim"
    >
      {{ t('updated', { time: props.updatedAt }) }}
    </p>
  </div>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.stat-strip {
  display: flex;
  flex-wrap: wrap;
  gap: calc(t.$grid * 2) 0;
  margin-top: t.$grid;
}

.stat-entry {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 calc(t.$grid * 3);
  border-left: 2px solid t.$hairline;
  cursor: default;

  &:hover {
    border-left-color: t.$accent;
  }

  &:first-child {
    padding-left: calc(t.$grid * 2);
  }

  .stat-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
  }

  .stat-value {
    font-family: t.$font-sans;
    font-size: 26px;
    line-height: 1.1;
  }
}

.stamp {
  font-size: 10px;
  letter-spacing: 0.5px;
  text-align: right;
  margin: calc(t.$grid / 2) 0 0;
}

.mix-bar {
  display: flex;
  align-items: center;
  gap: calc(t.$grid * 2);
  margin-top: calc(t.$grid * 2);

  .mix-label {
    width: 100px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    flex-shrink: 0;
  }

  .mix-track {
    flex: 1;
    display: flex;
    height: 10px;
    border: t.$hair;
    background: t.$surface;
  }

  .mix-segment {
    height: 100%;

    &:not(:last-child) {
      border-right: 1px solid t.$bg;
    }
  }

  .mix-legend {
    display: flex;
    gap: calc(t.$grid * 2);
    font-size: 10px;
    flex-shrink: 0;

    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .legend-swatch {
      width: 8px;
      height: 8px;
      display: inline-block;
    }
  }

  .seg-0 {
    background: t.$text;
  }

  .seg-1 {
    background: t.$muted;
  }

  .seg-2 {
    background: t.$dim;
  }
}

@media (max-width: 760px) {
  .mix-bar {
    flex-wrap: wrap;

    .mix-legend {
      width: 100%;
    }
  }
}
</style>
