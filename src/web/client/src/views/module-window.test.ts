import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { resetApiCache } from '../lib/api-cache';
import { session } from '../stores/session';

import ModuleWindow from './module-window.vue';

import { flushPromises, mount } from '@vue/test-utils';

/**
 * THE ROUND-TRIP INVARIANT (C1/W5): GET the config, edit exactly one
 * widget, PUT — every non-edited key must arrive deep-equal to what
 * the GET returned, including keys the descriptor does not know.
 */
const DESCRIPTOR = {
  title: 'Test Module',
  config_version: 2,
  config: {
    fields: [
      { key: 'greeting', label: 'Greeting', type: 'text' },
      { key: 'count', label: 'Count', type: 'number' },
      {
        key: 'gates',
        label: 'Gates',
        type: 'group',
        fields: [
          { key: 'strict', label: 'Strict', type: 'boolean' },
        ],
      },
    ],
  },
  actions: [],
  data: [],
};

const SERVED_CONFIG = {
  greeting: 'hi',
  count: 2,
  gates: { strict: true },
  future_key: 'untouched',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let put_body: Record<string, unknown> | null = null;

function stubFetch(): typeof fetch {
  return (async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const URL_STRING = String(input);

    if (URL_STRING.includes('/descriptor')) {
      return jsonResponse(200, {
        ok: true,
        data: {
          manifest: DESCRIPTOR,
          available: true,
          registered_config_version: 2,
        },
      });
    }

    if (URL_STRING.includes('/config') && init?.method === 'PUT') {
      put_body = JSON.parse(String(init.body)) as
        Record<string, unknown>;
      return jsonResponse(200, {
        ok: true,
        data: {
          config: put_body,
          version: 2,
          changed_keys: ['greeting'],
        },
      });
    }

    if (URL_STRING.includes('/config')) {
      return jsonResponse(200, {
        ok: true,
        data: { config: SERVED_CONFIG, version: 2 },
      });
    }

    if (URL_STRING.includes('/reference')) {
      return jsonResponse(200, {
        ok: true,
        data: { roles: [], channels: [] },
      });
    }
    return jsonResponse(404, { ok: false, error: 'nope' });
  }) as typeof fetch;
}

async function mountWindow(
  query: Record<string, string> = {}
): Promise<ReturnType<typeof mount>> {
  const ROUTER = createRouter({
    history: createMemoryHistory('/app/'),
    routes: [
      {
        path: '/guilds/:gid/modules/:mid',
        component: ModuleWindow,
      },
    ],
  });

  await ROUTER.push({ path: '/guilds/g1/modules/testmod', query });
  await ROUTER.isReady();

  const WRAPPER = mount(ModuleWindow, {
    global: { plugins: [ROUTER] },
  });

  await flushPromises();
  return WRAPPER;
}

describe('module-window round trip', (): void => {
  beforeEach((): void => {
    put_body = null;
    resetApiCache();
    vi.stubGlobal('fetch', stubFetch());
    session.ready = true;
    session.authenticated = true;
    session.me = {
      user: {
        id: 'u1',
        username: 'kyo',
        global_name: null,
        avatar: null,
      },
      csrf: 'csrf-token',
      host_owner: true,
    };
  });

  it('lands on functionality cards with descriptions', async ():
  Promise<void> => {
    const WRAPPER = await mountWindow();

    expect(WRAPPER.text()).toContain('Greeting');
    expect(WRAPPER.text()).toContain('Count');
    expect(WRAPPER.find('.feature-card').exists()).toBe(true);
    /* No editor rendered until a card is opened. */
    expect(WRAPPER.find('.config-pane').exists()).toBe(false);
  });

  it('edits one widget and round-trips every other key', async ():
  Promise<void> => {
    const WRAPPER = await mountWindow({ s: 'f:greeting' });

    expect(WRAPPER.text().toLowerCase()).toContain('test module');

    const GREETING = WRAPPER.find('input[type="text"]');

    await GREETING.setValue('hello there');

    const SAVE = WRAPPER.findAll('button').find(
      (button): boolean => {
        return button.text().includes('save');
      }
    );

    await SAVE?.trigger('click');
    await flushPromises();

    expect(put_body).not.toBeNull();
    expect(put_body?.greeting).toBe('hello there');

    /* THE INVARIANT: every non-edited key deep-equal, including the
       descriptor-unknown future_key. */
    expect(put_body?.count).toBe(SERVED_CONFIG.count);
    expect(put_body?.gates).toEqual(SERVED_CONFIG.gates);
    expect(put_body?.future_key).toBe(SERVED_CONFIG.future_key);
  });

  it('renders a placeholder for missing keys and excludes them',
    async (): Promise<void> => {
      const WITH_MISSING = {
        ...DESCRIPTOR,
        config: {
          fields: [
            ...DESCRIPTOR.config.fields,
            { key: 'newer_field', label: 'Newer', type: 'text' },
          ],
        },
      };

      vi.stubGlobal('fetch', ((async (
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> => {
        const URL_STRING = String(input);

        if (URL_STRING.includes('/descriptor')) {
          return jsonResponse(200, {
            ok: true,
            data: {
              manifest: WITH_MISSING,
              available: true,
              registered_config_version: 2,
            },
          });
        }
        return stubFetch()(input, init);
      }) as typeof fetch));

      const WRAPPER = await mountWindow({ s: 'f:newer_field' });

      expect(WRAPPER.text()).toContain('not present in this module');

      const SAVE = WRAPPER.findAll('button').find(
        (button): boolean => {
          return button.text().includes('save');
        }
      );

      await SAVE?.trigger('click');
      await flushPromises();

      /* C5: the absent key contributes NOTHING to the PUT. */
      expect(put_body).not.toBeNull();
      expect('newer_field' in (put_body ?? {})).toBe(false);
    });
});
