import { describe, expect, it } from 'vitest';

import type { DashboardMediaItem } from '../lib/types';

import MediaCarousel from './media-carousel.vue';

import { mount } from '@vue/test-utils';

const MEDIA: DashboardMediaItem[] = [
  { kind: 'image', src: 'roles.jpg', alt: 'The module' },
  { kind: 'youtube', id: 'ekzFDeRCdUw', title: 'Test video' },
];

function mountCarousel(): ReturnType<typeof mount> {
  return mount(MediaCarousel, {
    props: {
      media: MEDIA,
      assetBase: '/api/guilds/g1/modules/roles/assets',
    },
  });
}

describe('media-carousel', (): void => {
  it('resolves asset filenames through the asset base', (): void => {
    const WRAPPER = mountCarousel();
    const IMG = WRAPPER.find('.slide img');

    expect(IMG.attributes('src'))
      .toBe('/api/guilds/g1/modules/roles/assets/roles.jpg');
    /* One slide per entry, first active, plus dots and counter. */
    expect(WRAPPER.findAll('.slide')).toHaveLength(2);
    expect(WRAPPER.findAll('.slide')[0].classes())
      .toContain('active');
    expect(WRAPPER.findAll('.dot')).toHaveLength(2);
    expect(WRAPPER.text()).toContain('01 / 02');
  });

  it('steps slides with the nav and wraps around', async ():
  Promise<void> => {
    const WRAPPER = mountCarousel();
    const NEXT = WRAPPER.findAll('button').find(
      (button): boolean => {
        return button.text() === '>';
      }
    );

    await NEXT?.trigger('click');

    expect(WRAPPER.findAll('.slide')[1].classes())
      .toContain('active');
    expect(WRAPPER.text()).toContain('02 / 02');

    await NEXT?.trigger('click');

    expect(WRAPPER.findAll('.slide')[0].classes())
      .toContain('active');
  });

  it('keeps youtube a facade until the click, then embeds nocookie',
    async (): Promise<void> => {
      const WRAPPER = mountCarousel();

      expect(WRAPPER.find('iframe').exists()).toBe(false);

      const POSTER = WRAPPER.find('.facade .poster');

      expect(POSTER.attributes('src'))
        .toBe('https://i.ytimg.com/vi/ekzFDeRCdUw/maxresdefault.jpg');

      await WRAPPER.find('.facade').trigger('click');

      const FRAME = WRAPPER.find('iframe');

      expect(FRAME.exists()).toBe(true);
      expect(FRAME.attributes('src'))
        .toContain('https://www.youtube-nocookie.com/embed/ekzFDeRCdUw');
    });
});
