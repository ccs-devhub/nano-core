import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ChatInputCommandInteraction,
  EmbedBuilder
} from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';

import { TEXT_CONFIRM_CANCELLED } from '@/constants/text.js';
import {
  auditCommandHelp,
  auditModuleHelp,
  subcommandPaths
} from '@/misc/utility/help-audit.js';
import { DatabaseService } from '@/services/database.js';
import { moduleKind } from '@/types/nano-module.js';

import { ROLES_SUPPRESSION } from '@modules/roles/apply-role-change.js';
import type { RoleCommandAction } from '@modules/roles/command.js';
import {
  actorHierarchyBlocked,
  buildConfirmPreview,
  outcomeText,
  privilegedPermissionNames,
  ROLES_COMMAND
} from '@modules/roles/command.js';
import { ROLES_CONFIG_SCHEMA } from '@modules/roles/config.js';
import {
  TEXT_ROLES_OUTCOME_GRANTED,
  TEXT_ROLES_OUTCOME_NOOP_REVOKE,
  TEXT_ROLES_REFUSAL_MANAGED
} from '@modules/roles/constants.js';
import roles_module from '@modules/roles/index.js';
import { memberLedger } from '@modules/roles/ledger.js';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'modules',
  'roles',
  'migrations'
);
const GUILD_ID = 'g1';
const OWNER_ID = 'owner1';
const MOD_ID = 'mod1';
const TARGET_ID = 'u1';
const ROLE_ID = 'r1';
const BOT_TOP = 5;
const ACTOR_TOP = 4;
const ROLE_POSITION = 2;
const OPTION_USER = 6;
const OPTION_ROLE = 8;
const OPTION_STRING = 3;
const GRID_FIELD_COUNT = 6;

interface CommandOptionJson {
  type: number;
  name: string;
  required?: boolean;
  options?: CommandOptionJson[];
}

interface SetCall {
  target: string[];
  reason?: string;
}

interface IdCollection {
  map<T>(callback: (role: { id: string }) => T): T[];
}

function idCollection(ids: string[]): IdCollection {
  return {
    map: <T>(callback: (role: { id: string }) => T): T[] => {
      return ids.map((id: string): T => {
        return callback({ id });
      });
    },
  };
}

function openTemp(): DatabaseService {
  const ROOT = mkdtempSync(join(tmpdir(), 'nano-roles-cmd-'));
  const RESULT = DatabaseService.open({ driver: 'sqlite' }, ROOT);

  if (!RESULT.ok) {
    throw new Error(RESULT.error);
  }

  const SERVICE = RESULT.data;
  const MIGRATED = SERVICE.runModuleMigrations('roles', MIGRATIONS_DIR);

  if (!MIGRATED.ok) {
    throw new Error(MIGRATED.error);
  }
  return SERVICE;
}

interface ConfirmRowJson {
  components: { custom_id: string }[];
}

function pressFor(
  body: unknown,
  index: number
): {
    customId: string;
    user: { id: string };
    update(): Promise<void>;
  } {
  const ROW = (body as {
    components: { toJSON(): ConfirmRowJson }[];
  }).components[0].toJSON();
  return {
    customId: ROW.components[index].custom_id,
    user: { id: MOD_ID },
    update: async (): Promise<void> => {
      return;
    },
  };
}

interface HarnessSetup {
  action: RoleCommandAction;
  held: string[];
  role_permissions: string[];
  press: 'ok' | 'no';
  reason?: string;
  database: DatabaseService;
}

interface Harness {
  interaction: ChatInputCommandInteraction;
  set_calls: SetCall[];
  edits: unknown[];
}

function makeHarness(setup: HarnessSetup): Harness {
  const SET_CALLS: SetCall[] = [];
  const EDITS: unknown[] = [];
  const PRESS_INDEX = setup.press === 'ok' ? 0 : 1;
  let held = [...setup.held];
  const TARGET_MEMBER = {
    roles: {
      get cache(): IdCollection {
        return idCollection(held);
      },
      set: async (
        role_ids: string[],
        reason?: string
      ): Promise<{ roles: { cache: IdCollection } }> => {
        SET_CALLS.push({ target: role_ids, reason });
        held = [...role_ids];
        return { roles: { cache: idCollection(held) } };
      },
    },
  };
  const ACTOR = {
    roles: { highest: { position: ACTOR_TOP } },
  };
  const FAKE_ROLE = {
    id: ROLE_ID,
    managed: false,
    position: ROLE_POSITION,
    permissions: {
      toArray: (): string[] => {
        return setup.role_permissions;
      },
    },
  };
  const ROLE_MAP = new Map([[ROLE_ID, FAKE_ROLE]]);
  const GUILD = {
    id: GUILD_ID,
    ownerId: OWNER_ID,
    roles: {
      cache: ROLE_MAP,
      fetch: async (id: string): Promise<typeof FAKE_ROLE | null> => {
        return ROLE_MAP.get(id) ?? null;
      },
    },
    members: {
      fetch: async (
        id: string
      ): Promise<typeof ACTOR | typeof TARGET_MEMBER> => {
        return id === MOD_ID ? ACTOR : TARGET_MEMBER;
      },
      me: { roles: { highest: { position: BOT_TOP } } },
    },
  };
  const CONFIG = ROLES_CONFIG_SCHEMA.parse({});
  const BOT = {
    user: {
      id: 'bot1',
      displayAvatarURL: (): string => {
        return 'https://cdn.example/avatar.png';
      },
    },
    guilds: {
      fetch: async (): Promise<typeof GUILD> => {
        return GUILD;
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
  const INTERACTION = {
    client: BOT,
    guild: GUILD,
    user: { id: MOD_ID },
    deferred: true,
    replied: false,
    ephemeral: true,
    options: {
      getSubcommand: (): string => {
        return setup.action;
      },
      getUser: (): { id: string } => {
        return { id: TARGET_ID };
      },
      getRole: (): { id: string } => {
        return { id: ROLE_ID };
      },
      getString: (): string | null => {
        return setup.reason ?? null;
      },
    },
    editReply: async (body: unknown): Promise<unknown> => {
      EDITS.push(body);
      return {
        awaitMessageComponent: async (): Promise<unknown> => {
          return pressFor(body, PRESS_INDEX);
        },
      };
    },
  };
  return {
    interaction: INTERACTION as unknown as ChatInputCommandInteraction,
    set_calls: SET_CALLS,
    edits: EDITS,
  };
}

afterEach((): void => {
  ROLES_SUPPRESSION.clear();
});

describe('roles command builder', (): void => {
  it('declares grant and revoke with member, role and reason',
    (): void => {
      expect(ROLES_COMMAND.data.name).toBe('roles');
      expect(ROLES_COMMAND.defer).toBe('ephemeral');
      expect(subcommandPaths(ROLES_COMMAND)).toEqual([
        'grant',
        'revoke',
      ]);

      const JSON_DATA = ROLES_COMMAND.data.toJSON() as {
        default_member_permissions?: string;
        options?: CommandOptionJson[];
      };

      expect(JSON_DATA.default_member_permissions)
        .toBe(PermissionFlagsBits.ManageRoles.toString());

      for (const _sub of JSON_DATA.options ?? []) {
        const NAMES = (_sub.options ?? []).map(
          (option: CommandOptionJson): string => {
            return option.name;
          }
        );

        expect(NAMES).toEqual(['member', 'role', 'reason']);

        const [MEMBER, ROLE, REASON] = _sub.options ?? [];

        expect(MEMBER.type).toBe(OPTION_USER);
        expect(MEMBER.required).toBe(true);
        expect(ROLE.type).toBe(OPTION_ROLE);
        expect(ROLE.required).toBe(true);
        expect(REASON.type).toBe(OPTION_STRING);
        expect(REASON.required).toBeFalsy();
      }
    });

  it('passes the help completeness gate at subcommand depth',
    (): void => {
      expect(auditCommandHelp(ROLES_COMMAND)).toEqual([]);
      expect(auditModuleHelp(roles_module)).toEqual([]);
      expect(moduleKind(roles_module)).toBe('hybrid');
    });
});

describe('GR-L3 privileged listing', (): void => {
  it('filters the dangerous-permission denylist', (): void => {
    expect(privilegedPermissionNames([
      'Administrator',
      'SendMessages',
      'ManageWebhooks',
      'AddReactions',
    ])).toEqual(['Administrator', 'ManageWebhooks']);
    expect(privilegedPermissionNames(['SendMessages'])).toEqual([]);
  });

  it('lists privileged permissions inside the confirm prompt',
    (): void => {
      const PREVIEW = buildConfirmPreview(
        'grant',
        '@member',
        '@role',
        ['Administrator', 'ManageRoles'],
        null
      );

      expect(PREVIEW).toContain('privileged permissions');
      expect(PREVIEW).toContain('Administrator');
      expect(PREVIEW).toContain('Manage Roles');

      const CLEAN = buildConfirmPreview(
        'revoke',
        '@member',
        '@role',
        [],
        'cleanup'
      );

      expect(CLEAN).not.toContain('privileged');
      expect(CLEAN).toContain('Reason, cleanup.');
    });
});

describe('EX6 actor hierarchy', (): void => {
  it('blocks roles at or above the actor, owner bypasses',
    (): void => {
      expect(actorHierarchyBlocked(ACTOR_TOP, false, ACTOR_TOP))
        .toBe(true);
      expect(actorHierarchyBlocked(ACTOR_TOP, false, ACTOR_TOP + 1))
        .toBe(true);
      expect(actorHierarchyBlocked(ACTOR_TOP, false, ACTOR_TOP - 1))
        .toBe(false);
      expect(actorHierarchyBlocked(1, true, BOT_TOP)).toBe(false);
    });
});

describe('outcomeText', (): void => {
  it('maps refusals first, then noop, then the applied text',
    (): void => {
      const BASE = {
        guild_id: GUILD_ID,
        user_id: TARGET_ID,
        applied_add: [],
        applied_remove: [],
        refused: [],
        noop: true,
      };

      expect(outcomeText('grant', {
        ...BASE,
        refused: [{ role_id: ROLE_ID, reason: 'managed' as const }],
      })).toBe(TEXT_ROLES_REFUSAL_MANAGED);
      expect(outcomeText('revoke', BASE))
        .toBe(TEXT_ROLES_OUTCOME_NOOP_REVOKE);
      expect(outcomeText('grant', {
        ...BASE,
        applied_add: [ROLE_ID],
        noop: false,
      })).toBe(TEXT_ROLES_OUTCOME_GRANTED);
    });
});

describe('/roles execute', (): void => {
  it('declined confirm mutates nothing', async (): Promise<void> => {
    const SERVICE = openTemp();
    const HARNESS = makeHarness({
      action: 'grant',
      held: [],
      role_permissions: ['Administrator'],
      press: 'no',
      database: SERVICE,
    });

    await ROLES_COMMAND.execute(HARNESS.interaction);

    const PROMPT = HARNESS.edits[0] as { content: string };

    expect(PROMPT.content).toContain('privileged permissions');
    expect(PROMPT.content).toContain('Administrator');
    expect(HARNESS.set_calls).toHaveLength(0);
    expect(memberLedger(SERVICE.getDb(), GUILD_ID, TARGET_ID))
      .toHaveLength(0);

    const LAST = HARNESS.edits[HARNESS.edits.length - 1] as {
      content: string;
    };

    expect(LAST.content).toBe(TEXT_CONFIRM_CANCELLED);
    SERVICE.close();
  });

  it('confirmed grant applies as manual with the invoker as actor',
    async (): Promise<void> => {
      const SERVICE = openTemp();
      const HARNESS = makeHarness({
        action: 'grant',
        held: [],
        role_permissions: [],
        press: 'ok',
        reason: 'event host',
        database: SERVICE,
      });

      await ROLES_COMMAND.execute(HARNESS.interaction);

      expect(HARNESS.set_calls).toHaveLength(1);
      expect(HARNESS.set_calls[0].target).toEqual([ROLE_ID]);
      expect(HARNESS.set_calls[0].reason)
        .toBe(`roles:manual by ${MOD_ID}`);

      const ROWS = memberLedger(SERVICE.getDb(), GUILD_ID, TARGET_ID);

      expect(ROWS).toHaveLength(1);
      expect(ROWS[0].role_id).toBe(ROLE_ID);
      expect(ROWS[0].source).toBe('manual');
      expect(ROWS[0].granted_by).toBe(MOD_ID);

      const LAST = HARNESS.edits[HARNESS.edits.length - 1] as {
        embeds: EmbedBuilder[];
      };
      const CARD = LAST.embeds[0];

      expect(CARD.data.description)
        .toContain(TEXT_ROLES_OUTCOME_GRANTED);
      expect(CARD.data.description).toContain('event host');
      expect(CARD.data.footer?.text).toContain('roles');
      expect(CARD.data.fields).toHaveLength(GRID_FIELD_COUNT);
      SERVICE.close();
    });
});
