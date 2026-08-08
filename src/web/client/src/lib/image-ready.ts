import type { Directive } from 'vue';

/**
 * Ported from kyo-web-online's use-image-ready.js: `v-image-ready`
 * fires its handler on the <img>'s load event OR immediately when
 * the browser already has the bytes cached — closing the gap where
 * hot-cached images never fire @load and dependent UI state stalls.
 * Also fires on error so a failed network never leaves placeholders
 * spinning. The unmounted hook removes still-pending listeners.
 */
const BOUND = new WeakMap<HTMLImageElement, () => void>();

type ImageReadyHandler = ((el: HTMLImageElement) => void) | undefined;

export const vImageReady: Directive<HTMLImageElement, ImageReadyHandler> = {
  mounted(el: HTMLImageElement, binding): void {
    const FIRE = (): void => {
      try {
        binding.value?.(el);
      } catch {
        /* swallow — UI-only handler */
      }
    };

    if (el.complete && el.naturalWidth > 0) {
      FIRE();
      return;
    }

    el.addEventListener('load', FIRE, { once: true });
    el.addEventListener('error', FIRE, { once: true });
    BOUND.set(el, FIRE);
  },
  unmounted(el: HTMLImageElement): void {
    const FIRE = BOUND.get(el);

    if (!FIRE) {
      return;
    }

    el.removeEventListener('load', FIRE);
    el.removeEventListener('error', FIRE);
    BOUND.delete(el);
  },
};
