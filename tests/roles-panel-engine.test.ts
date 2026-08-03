import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Client } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';

import { DatabaseService } from '@/services/database.js';

import { ROLES_SUPPRESSION } from '@modules/roles/apply-role-change.js';
import type { RolesPanel } from '@modules/roles/config.js';
import { ROLES_CONFIG_SCHEMA } from '@modules/roles/config.js';
import {
  TEXT_ROLES_PICK_UNKNOWN
} from '@modules/roles/constants.js';
import type {
  ReactionLike,
  UserLike
} from '@modules/roles/events.js';
import {
  handleReactionEvent,
  pickComponent
} from '@modules/roles/events.js';
import { memberLedger, recordGrants } from '@modules/roles/ledger.js';
import {
  emojiDisplay,
  publishPanel,
  refreshPanel,
  renderPanelMessage
} from '@modules/roles/panel-engine.js';
import { panelById, upsertPanel } from '@modules/roles/panels.js';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'modules',
  'roles',
  'migrations'
);
const GUILD_ID = 'g1';
const USER_ID = 'u1';
const BOT_USER_ID = 'bot1';
const CUSTOM_ID = '763464848457072701';
const ROLE_A = '100000000000000001';
const ROLE_B = '100000000000000002';
const BOT_TOP = 9;
const SETTLE_MS = 40;
const DEBOUNCE_MS = 1;

function openTemp(): DatabaseService {
  const ROOT = mkdtempSync(join(tmpdir(), 'nano-roles-engine-'));
  const RESULT = DatabaseService.open({ driver: 'sqlite' }, ROOT);

  if (!RESULT.ok) {
    throw new Error(RESULT.error);
  }

  const MIGRATED = RESULT.data.runModuleMigrations(
    'roles',
    MIGRATIONS_DIR
  );

  if (!MIGRATED.ok) {
    throw new Error(MIGRATED.error);
  }
  return RESULT.data;
}

function configPanel(
  overrides: Record<string, unknown> = {}
): RolesPanel {
  const PARSED = ROLES_CONFIG_SCHEMA.parse({
    panels: [{
      id: 'picker',
      surface: 'reaction',
      channel_id: CUSTOM_ID,
      map: [
        { role_id: ROLE_A, emoji_slot: '🔥', label: 'fire' },
        {
          role_id: ROLE_B,
          emoji_slot: CUSTOM_ID,
          label: 'verse',
          description: 'the second pick',
        },
      ],
      ...overrides,
    }],
  });
  return PARSED.panels[0];
}

interface Recorder {
  sends: { embeds: unknown[]; components?: unknown[] }[];
  reactions: string[];
  role_sets: string[][];
  replies: { content: string }[];
  removed_reactions: string[];
}

interface FakeSetup {
  database: DatabaseService;
  held?: string[];
  fail_react?: string;
  missing_message?: string;
  sanction_roles?: string[];
}

function makeBot(setup: FakeSetup): { bot: Client; rec: Recorder } {
  const REC: Recorder = {
    sends: [],
    reactions: [],
    role_sets: [],
    replies: [],
    removed_reactions: [],
  };
  let held = [...(setup.held ?? [])];
  let next_message = 0;
  const MESSAGE = {
    react: async (emoji: string): Promise<void> => {
      if (emoji === setup.fail_react) {
        throw new Error('emoji rejected');
      }
      REC.reactions.push(emoji);
    },
    edit: async (): Promise<void> => {
      return;
    },
    reactions: {
      resolve: (emoji: string): {
        users: { remove(user: string): Promise<void> };
      } => {
        return {
          users: {
            remove: async (): Promise<void> => {
              REC.removed_reactions.push(emoji);
            },
          },
        };
      },
    },
  };
  const CHANNEL = {
    isTextBased: (): boolean => {
      return true;
    },
    send: async (
      options: { embeds: unknown[]; components?: unknown[] }
    ): Promise<{ id: string }> => {
      REC.sends.push(options);
      next_message += 1;
      return { id: `m${next_message}` };
    },
    messages: {
      fetch: async (message_id: string): Promise<typeof MESSAGE> => {
        if (message_id === setup.missing_message) {
          const ERROR = new Error('Unknown Message') as Error & {
            code: number;
          };
          ERROR.code = 10008;
          throw ERROR;
        }
        return MESSAGE;
      },
    },
  };
  const MEMBER = {
    user: { createdTimestamp: Date.now() },
    joinedTimestamp: Date.now(),
    roles: {
      get cache(): { map<T>(cb: (r: { id: string }) => T): T[] } {
        return {
          map: <T>(cb: (r: { id: string }) => T): T[] => {
            return held.map((id: string): T => {
              return cb({ id });
            });
          },
        };
      },
      set: async (
        role_ids: string[]
      ): Promise<{ roles: { cache: {
        map<T>(cb: (r: { id: string }) => T): T[];
      } } }> => {
        REC.role_sets.push(role_ids);
        held = [...role_ids];
        return {
          roles: {
            cache: {
              map: <T>(cb: (r: { id: string }) => T): T[] => {
                return held.map((id: string): T => {
                  return cb({ id });
                });
              },
            },
          },
        };
      },
    },
  };
  const GUILD = {
    roles: {
      cache: new Map([
        [ROLE_A, { id: ROLE_A, managed: false, position: 1 }],
        [ROLE_B, { id: ROLE_B, managed: false, position: 2 }],
      ]),
      fetch: async (): Promise<null> => {
        return null;
      },
    },
    members: {
      fetch: async (): Promise<typeof MEMBER> => {
        return MEMBER;
      },
      me: { roles: { highest: { position: BOT_TOP } } },
    },
  };
  const CONFIG = ROLES_CONFIG_SCHEMA.parse({});
  CONFIG.sanction_roles = setup.sanction_roles ?? [];
  const BOT = {
    user: { id: BOT_USER_ID },
    guilds: {
      fetch: async (): Promise<typeof GUILD> => {
        return GUILD;
      },
    },
    channels: {
      fetch: async (): Promise<typeof CHANNEL> => {
        return CHANNEL;
      },
    },
    users: {
      fetch: async (): Promise<never> => {
        throw new Error('no dm in tests');
      },
    },
    services: {
      database: setup.database,
      guild_store: {
        getGuildModuleConfig: (): typeof CONFIG => {
          return CONFIG;
        },
      },
    },
  };
  return { bot: BOT as unknown as Client, rec: REC };
}

function reaction(
  message_id: string,
  emoji: { id: string | null; name: string | null }
): ReactionLike {
  const LIVE: ReactionLike = {
    partial: false,
    fetch: async (): Promise<ReactionLike> => {
      return LIVE;
    },
    emoji,
    message: {
      id: message_id,
      guildId: GUILD_ID,
      channelId: CUSTOM_ID,
    },
  };
  return LIVE;
}

function settle(): Promise<void> {
  return new Promise((resolve: (value: void) => void): void => {
    setTimeout(resolve, SETTLE_MS);
  });
}

afterEach((): void => {
  ROLES_SUPPRESSION.clear();
});

describe('panel rendering', (): void => {
  it('renders the default list with emojis, labels, descriptions',
    (): void => {
      const RENDERED = renderPanelMessage(configPanel());

      expect(RENDERED.ok).toBe(true);

      if (RENDERED.ok) {
        const DESCRIPTION = (RENDERED.data as {
          data: { description?: string };
        }).data.description ?? '';

        expect(DESCRIPTION).toContain('🔥 **fire**');
        expect(DESCRIPTION).toContain(`<:_:${CUSTOM_ID}>`);
        expect(DESCRIPTION).toContain(', the second pick');
      }

      expect(emojiDisplay(null)).toBe('');
      expect(emojiDisplay('🔥')).toBe('🔥');
    });
});

describe('publishPanel and refreshPanel', (): void => {
  it('publishes, freezes config, seeds and tolerates a bad emoji',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const { bot: BOT, rec: REC } = makeBot({
        database: SERVICE,
        fail_react: '🔥',
      });

      const RESULT = await publishPanel(BOT, GUILD_ID, configPanel());

      expect(RESULT.ok).toBe(true);

      if (RESULT.ok) {
        expect(RESULT.data.message_id).toBe('m1');
        expect(RESULT.data.seed_failures).toEqual(['🔥']);
      }

      expect(REC.reactions).toEqual([CUSTOM_ID]);

      const ROW = panelById(SERVICE.getDb(), GUILD_ID, 'picker');

      expect(ROW?.message_id).toBe('m1');
      expect(ROW?.status).toBe('active');
      SERVICE.close();
    });

  it('republishes on 10008 and repoints the row',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const { bot: BOT, rec: REC } = makeBot({
        database: SERVICE,
        missing_message: 'm-gone',
      });
      upsertPanel(SERVICE.getDb(), {
        guild_id: GUILD_ID,
        panel_id: 'picker',
        channel_id: CUSTOM_ID,
        message_id: 'm-gone',
        surface: 'reaction',
        config_json: '{}',
        status: 'active',
        updated_at: 1,
      });

      const RESULT = await refreshPanel(BOT, GUILD_ID, configPanel());

      expect(RESULT.ok).toBe(true);

      if (RESULT.ok) {
        expect(RESULT.data.republished).toBe(true);
        expect(RESULT.data.message_id).toBe('m1');
      }

      expect(REC.sends).toHaveLength(1);

      const ROW = panelById(SERVICE.getDb(), GUILD_ID, 'picker');

      expect(ROW?.message_id).toBe('m1');
      expect(ROW?.status).toBe('active');
      SERVICE.close();
    });
});

describe('reaction pick path', (): void => {
  it('grants a mapped pick end to end and ignores bots',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const { bot: BOT, rec: REC } = makeBot({ database: SERVICE });
      await publishPanel(BOT, GUILD_ID, configPanel());

      await handleReactionEvent(
        BOT,
        reaction('m1', { id: null, name: '🔥' }),
        { id: 'a-bot', bot: true } as UserLike,
        'add',
        DEBOUNCE_MS
      );
      await handleReactionEvent(
        BOT,
        reaction('m1', { id: null, name: '🔥' }),
        { id: USER_ID, bot: false } as UserLike,
        'add',
        DEBOUNCE_MS
      );
      await settle();

      expect(REC.role_sets).toHaveLength(1);
      expect(REC.role_sets[0]).toContain(ROLE_A);

      const ROWS = memberLedger(SERVICE.getDb(), GUILD_ID, USER_ID);

      expect(ROWS).toHaveLength(1);
      expect(ROWS[0].source).toBe('panel');
      SERVICE.close();
    });

  it('refuses a gated pick by undoing the reaction',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const { bot: BOT, rec: REC } = makeBot({ database: SERVICE });
      const GATED = configPanel({
        gates: { min_account_age_days: 3650 },
      });
      await publishPanel(BOT, GUILD_ID, GATED);

      await handleReactionEvent(
        BOT,
        reaction('m1', { id: null, name: '🔥' }),
        { id: USER_ID, bot: false } as UserLike,
        'add',
        DEBOUNCE_MS
      );
      await settle();

      expect(REC.role_sets).toHaveLength(0);
      expect(REC.removed_reactions).toEqual(['🔥']);
      SERVICE.close();
    });

  it('revokes on reaction remove', async (): Promise<void> => {
    const SERVICE = openTemp();
    const { bot: BOT, rec: REC } = makeBot({
      database: SERVICE,
      held: [ROLE_A],
    });
    recordGrants(SERVICE.getDb(), [{
      guild_id: GUILD_ID,
      user_id: USER_ID,
      role_id: ROLE_A,
      source: 'panel',
      granted_by: null,
      granted_at: 1,
    }]);
    await publishPanel(BOT, GUILD_ID, configPanel());

    await handleReactionEvent(
      BOT,
      reaction('m1', { id: null, name: '🔥' }),
      { id: USER_ID, bot: false } as UserLike,
      'remove',
      DEBOUNCE_MS
    );
    await settle();

    expect(REC.role_sets).toHaveLength(1);
    expect(REC.role_sets[0]).not.toContain(ROLE_A);
    expect(memberLedger(SERVICE.getDb(), GUILD_ID, USER_ID))
      .toHaveLength(0);
    SERVICE.close();
  });
});

describe('button pick path', (): void => {
  it('refuses a forged or stale button against the row (EX3)',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const { bot: BOT } = makeBot({ database: SERVICE });
      const REPLIES: { content: string }[] = [];
      const INTERACTION = {
        isButton: (): boolean => {
          return true;
        },
        guildId: GUILD_ID,
        user: { id: USER_ID },
        message: { id: 'not-the-panel-message' },
        client: BOT,
        reply: async (options: { content: string }): Promise<void> => {
          REPLIES.push(options);
        },
      };
      await publishPanel(
        BOT,
        GUILD_ID,
        configPanel({ surface: 'button' })
      );

      await pickComponent(
        INTERACTION as never,
        ['picker', ROLE_A]
      );

      expect(REPLIES).toHaveLength(1);
      expect(REPLIES[0].content).toBe(TEXT_ROLES_PICK_UNKNOWN);
      SERVICE.close();
    });
});
