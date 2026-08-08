<script setup lang="ts">
import { inject, ref, watch } from 'vue';

import { LANG_PREFER_KEY, localized, t } from '../lib/i18n';
import type { DashboardMediaItem, LocalizedText } from '../lib/types';

/**
 * The inline media carousel (the kyo-web-online projects pattern,
 * inline instead of modal): a fixed 16:9 hairline frame, every
 * slide mounted and cross-faded by opacity, dots + counter +
 * prev/next when there is more than one entry, arrow keys on the
 * frame. Videos are CLICK-TO-LOAD facades — a YouTube poster from
 * i.ytimg.com (nocookie iframe only after the click), an X post as
 * a neutral facade over the platform embed. Slide changes pause a
 * playing YouTube embed via postMessage.
 */
const props = defineProps<{
  media: DashboardMediaItem[];
  /** Base URL for module asset filenames (image src resolution). */
  assetBase: string;
}>();

const index = ref(0);
const loaded = ref<Record<number, boolean>>({});
const broken = ref<Record<number, boolean>>({});
const activated = ref<Record<number, boolean>>({});
const poster_fallback = ref<Record<number, boolean>>({});
const iframe_refs = ref<Record<number, HTMLIFrameElement | null>>({});

const LANG_PREFER = inject<() => string[]>(LANG_PREFER_KEY, ():
string[] => {
  return [];
});

function mt(text: LocalizedText | undefined): string {
  return localized(text, LANG_PREFER());
}

function step(delta: number): void {
  const TOTAL = props.media.length;
  index.value = (index.value + delta + TOTAL) % TOTAL;
}

function imageSrc(item: { src: string }): string {
  return item.src.startsWith('https://')
    ? item.src
    : `${props.assetBase}/${item.src}`;
}

function posterSrc(item: { id: string }, slide: number): string {
  const QUALITY = poster_fallback.value[slide]
    ? 'hqdefault'
    : 'maxresdefault';
  return `https://i.ytimg.com/vi/${item.id}/${QUALITY}.jpg`;
}

const YOUTUBE_PARAMS =
  'autoplay=1&rel=0&enablejsapi=1&playsinline=1';

function youtubeSrc(item: { id: string }): string {
  return `https://www.youtube-nocookie.com/embed/${item.id}` +
    `?${YOUTUBE_PARAMS}`;
}

function xSrc(item: { id: string }): string {
  return `https://platform.twitter.com/embed/Tweet.html` +
    `?id=${item.id}&theme=dark`;
}

/* Preconnect once when a video facade is hovered (the
   warmYoutube pattern, module-scoped). */
const WARMED = new Set<string>();

function warmHost(host: string): void {
  if (WARMED.has(host)) {
    return;
  }
  WARMED.add(host);

  const LINK = document.createElement('link');

  LINK.rel = 'preconnect';
  LINK.href = host;
  LINK.crossOrigin = '';
  document.head.append(LINK);
}

function warmFor(item: DashboardMediaItem): void {
  if (item.kind === 'youtube') {
    warmHost('https://www.youtube-nocookie.com');
    warmHost('https://i.ytimg.com');
  }

  if (item.kind === 'x') {
    warmHost('https://platform.twitter.com');
  }
}

function bindIframe(slide: number, el: unknown): void {
  iframe_refs.value[slide] =
    el instanceof HTMLIFrameElement ? el : null;
}

/** Pause any playing YouTube embed when its slide hides. */
watch(index, (): void => {
  for (const [_slide, _frame] of Object.entries(iframe_refs.value)) {
    if (!_frame || Number(_slide) === index.value) {
      continue;
    }

    try {
      _frame.contentWindow?.postMessage(
        JSON.stringify({
          event: 'command',
          func: 'pauseVideo',
          args: [],
        }),
        'https://www.youtube-nocookie.com'
      );
    } catch {
      /* detached frame */
    }
  }
});

function onKeydown(event: KeyboardEvent): void {
  if (props.media.length < 2) {
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    step(-1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    step(1);
  }
}

const PAD_LENGTH = 2;

function counter(value: number): string {
  return String(value).padStart(PAD_LENGTH, '0');
}
</script>

<template>
  <div
    v-if="props.media.length > 0"
    class="media-carousel"
  >
    <div
      class="frame"
      role="group"
      tabindex="0"
      :aria-label="t('media_label')"
      @keydown="onKeydown"
    >
      <template
        v-for="(item, i) in props.media"
        :key="i"
      >
        <!-- image slide -->
        <div
          v-if="item.kind === 'image'"
          class="slide"
          :class="{
            active: index === i,
            ready: loaded[i] === true,
          }"
          :aria-hidden="index !== i || undefined"
          :inert="index !== i || undefined"
        >
          <img
            v-if="!broken[i]"
            :src="imageSrc(item)"
            :alt="mt(item.alt)"
            loading="lazy"
            decoding="async"
            @load="loaded[i] = true"
            @error="broken[i] = true"
          >
          <span
            v-else
            class="broken dim"
          >{{ mt(item.alt) || t('nothing_here') }}</span>
        </div>

        <!-- youtube: poster facade, iframe only after the click -->
        <div
          v-else-if="item.kind === 'youtube'"
          class="slide"
          :class="{ active: index === i, ready: true }"
          :aria-hidden="index !== i || undefined"
          :inert="index !== i || undefined"
        >
          <iframe
            v-if="activated[i]"
            :ref="(el): void => {
              bindIframe(i, el);
            }"
            class="embed"
            :src="youtubeSrc(item)"
            :title="mt(item.title) || 'YouTube'"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
          <button
            v-else
            class="facade"
            type="button"
            :tabindex="index === i ? 0 : -1"
            :aria-label="mt(item.title) || 'YouTube'"
            @click="activated[i] = true"
            @pointerenter="warmFor(item)"
            @focus="warmFor(item)"
          >
            <img
              class="poster"
              :src="posterSrc(item, i)"
              alt=""
              loading="lazy"
              decoding="async"
              @error="poster_fallback[i] = true"
            >
            <span
              class="play"
              aria-hidden="true"
            />
            <span class="chip">
              <svg
                class="chip-logo"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M23.5 6.19a3.02 3.02 0 0 0-2.122-2.136C19.505
                    3.545 12 3.545 12 3.545s-7.505 0-9.377.509A3.02
                    3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5
                    5.81a3.02 3.02 0 0 0 2.123 2.136c1.872.509
                    9.377.509 9.377.509s7.505 0 9.377-.509A3.02 3.02
                    0 0 0 23.5 17.81C24 15.93 24 12 24 12s0-3.93-.5
                    -5.81zM9.545 15.568V8.432L15.818 12l-6.273
                    3.568z"
                />
              </svg>
              YouTube
            </span>
          </button>
        </div>

        <!-- x post: neutral facade over the platform embed -->
        <div
          v-else
          class="slide"
          :class="{ active: index === i, ready: true }"
          :aria-hidden="index !== i || undefined"
          :inert="index !== i || undefined"
        >
          <iframe
            v-if="activated[i]"
            class="embed"
            :src="xSrc(item)"
            :title="mt(item.title) || 'X'"
            referrerpolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
          <button
            v-else
            class="facade x-facade"
            type="button"
            :tabindex="index === i ? 0 : -1"
            :aria-label="mt(item.title) || 'X'"
            @click="activated[i] = true"
            @pointerenter="warmFor(item)"
            @focus="warmFor(item)"
          >
            <svg
              class="x-mark"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M18.244 2.25h3.308l-7.227 8.26 8.502
                  11.24H16.17l-5.214-6.817L4.99
                  21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713
                  6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
              />
            </svg>
            <span class="chip">
              <svg
                class="chip-logo"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M18.244 2.25h3.308l-7.227 8.26 8.502
                    11.24H16.17l-5.214-6.817L4.99
                    21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713
                    6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
                />
              </svg>
              {{ t('open_post') }}
            </span>
          </button>
        </div>
      </template>

      <span
        v-if="props.media.length > 1"
        class="counter dim"
      >
        {{ counter(index + 1) }} / {{ counter(props.media.length) }}
      </span>
    </div>

    <div
      v-if="props.media.length > 1"
      class="controls"
    >
      <button
        class="mini"
        type="button"
        :aria-label="t('previous_media')"
        @click="step(-1)"
      >
        &lt;
      </button>
      <div
        class="dots"
        role="group"
        :aria-label="t('media_label')"
      >
        <button
          v-for="(item, i) in props.media"
          :key="`dot-${i}`"
          class="dot"
          :class="{ active: index === i }"
          type="button"
          :aria-label="t('go_to_slide', { n: i + 1 })"
          :aria-current="index === i ? 'true' : undefined"
          @click="index = i"
        />
      </div>
      <button
        class="mini"
        type="button"
        :aria-label="t('next_media')"
        @click="step(1)"
      >
        &gt;
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

.frame {
  position: relative;
  aspect-ratio: 16 / 9;
  border: t.$hair;
  overflow: hidden;
  width: 100%;
  background: t.$surface;
}

.slide {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.35s ease;
  pointer-events: none;

  &.active {
    opacity: 1;
    pointer-events: auto;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.broken {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}

.embed {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}

.facade {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: t.$surface;
  cursor: pointer;

  .poster {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .play {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 0;
    height: 0;
    border-top: 14px solid transparent;
    border-bottom: 14px solid transparent;
    border-left: 22px solid t.$text;
    filter: drop-shadow(0 0 8px rgb(0 0 0 / 80%));
  }

  .chip {
    position: absolute;
    left: t.$grid;
    bottom: t.$grid;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: t.$muted;
    background: t.$bg;
    border: t.$hair;
    padding: 3px 8px;
  }

  .chip-logo {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    display: block;
  }
}

.x-facade .x-mark {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 48px;
  height: 48px;
  color: t.$dim;
}

.counter {
  position: absolute;
  right: t.$grid;
  bottom: t.$grid;
  font-size: 10px;
  letter-spacing: 1px;
  background: t.$bg;
  border: t.$hair;
  padding: 2px 6px;
  z-index: 1;
}

.controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: t.$grid;
  margin-top: t.$grid;
}

.dots {
  display: flex;
  gap: t.$grid;
}

.dot {
  width: 8px;
  height: 8px;
  padding: 0;
  background: t.$hairline;
  border: 0;
  cursor: pointer;

  &.active {
    background: t.$accent;
  }
}

.mini {
  padding: 0 8px;
  font-size: 11px;
}
</style>
