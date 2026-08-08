<script setup lang="ts">
import { computed } from 'vue';

import { t } from '../lib/i18n';
import { memberLabel } from '../lib/member-names';
import type {
  CommandGate,
  CommandSubRow,
  CommandSummary,
  GuildReference
} from '../lib/types';

import LiveStats from './live-stats.vue';
import UiSelect from './ui-select.vue';
import UiSwitch from './ui-switch.vue';

/**
 * The module's command surface as cards: one card per slash
 * command with its help-card text (usage, examples), one row per
 * subcommand, the per-guild gates on every path (enable switch,
 * allowed roles, allowed members), and the count tiles at the
 * bottom. Every change emits the WHOLE gates object — the caller
 * PUTs and the server diffs.
 */
const props = defineProps<{
  guildId: string;
  commands: CommandSummary[];
  gates: Record<string, CommandGate>;
  ungateable: string[];
  reference: GuildReference | null;
  counts: { commands: number; subcommands: number };
  busy?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:gates', gates: Record<string, CommandGate>): void;
}>();

function gateOf(path: string): CommandGate {
  return props.gates[path] ?? {};
}

function pathEnabled(path: string): boolean {
  return gateOf(path).enabled !== false;
}

function gateable(command: CommandSummary): boolean {
  return !props.ungateable.includes(command.name);
}

/** Write one gate back, dropping keys that return to defaults. */
function patch(path: string, gate: CommandGate): void {
  const NEXT = { ...props.gates };
  const EMPTY = gate.enabled !== false &&
    (gate.allowed_role_ids ?? []).length === 0 &&
    (gate.allowed_user_ids ?? []).length === 0;

  if (EMPTY) {
    delete NEXT[path];
  } else {
    NEXT[path] = gate;
  }

  emit('update:gates', NEXT);
}

function toggle(path: string): void {
  const GATE = { ...gateOf(path) };

  if (GATE.enabled === false) {
    delete GATE.enabled;
  } else {
    GATE.enabled = false;
  }

  patch(path, GATE);
}

function addRole(path: string, role_id: string | null): void {
  if (!role_id) {
    return;
  }

  const GATE = { ...gateOf(path) };
  const ROLES = GATE.allowed_role_ids ?? [];

  if (!ROLES.includes(role_id)) {
    GATE.allowed_role_ids = [...ROLES, role_id];
    patch(path, GATE);
  }
}

function removeRole(path: string, role_id: string): void {
  const GATE = { ...gateOf(path) };

  GATE.allowed_role_ids = (GATE.allowed_role_ids ?? [])
    .filter((entry: string): boolean => {
      return entry !== role_id;
    });
  patch(path, GATE);
}

function addUser(path: string, raw: string): void {
  const USER_ID = raw.trim();

  if (!/^[0-9]{5,25}$/.test(USER_ID)) {
    return;
  }

  const GATE = { ...gateOf(path) };
  const USERS = GATE.allowed_user_ids ?? [];

  if (!USERS.includes(USER_ID)) {
    GATE.allowed_user_ids = [...USERS, USER_ID];
    patch(path, GATE);
  }
}

function removeUser(path: string, user_id: string): void {
  const GATE = { ...gateOf(path) };

  GATE.allowed_user_ids = (GATE.allowed_user_ids ?? [])
    .filter((entry: string): boolean => {
      return entry !== user_id;
    });
  patch(path, GATE);
}

function roleColor(role_id: string): string | null {
  const COLOR = props.reference?.roles.find(
    (role: { id: string }): boolean => {
      return role.id === role_id;
    }
  )?.color;
  return COLOR && COLOR !== '#000000' ? COLOR : null;
}

function roleName(role_id: string): string {
  return props.reference?.roles.find(
    (role: { id: string }): boolean => {
      return role.id === role_id;
    }
  )?.name ?? role_id;
}

function roleOptions(
  path: string
): { id: string; label: string; color?: string }[] {
  const TAKEN = gateOf(path).allowed_role_ids ?? [];
  return (props.reference?.roles ?? [])
    .filter((role: { id: string; managed: boolean }): boolean => {
      return !role.managed && !TAKEN.includes(role.id);
    })
    .map((role: { id: string; name: string; color: string }): {
      id: string;
      label: string;
      color?: string;
    } => {
      return { id: role.id, label: role.name, color: role.color };
    });
}

function usageOf(
  command: CommandSummary,
  sub?: CommandSubRow
): string {
  const CARD = sub ? sub.help : command.help;

  if (CARD?.usage) {
    return CARD.usage;
  }

  const ARGS = (sub ? sub.args : command.args)
    .map((arg: { name: string; required: boolean }): string => {
      return arg.required ? `<${arg.name}>` : `[${arg.name}]`;
    })
    .join(' ');
  const PATH = sub
    ? `/${command.name} ${sub.path}`
    : `/${command.name}`;
  return ARGS ? `${PATH} ${ARGS}` : PATH;
}

const disabled_count = computed((): number => {
  return Object.values(props.gates).filter(
    (gate: CommandGate): boolean => {
      return gate.enabled === false;
    }
  ).length;
});

const tiles = computed((): {
  label: string;
  value: number;
  hint?: string;
}[] => {
  return [
    {
      label: t('commands'),
      value: props.counts.commands,
      hint: t('commands_hint'),
    },
    {
      label: t('subcommands'),
      value: props.counts.subcommands,
      hint: t('subcommands_hint'),
    },
    {
      label: t('gated_off'),
      value: disabled_count.value,
      hint: t('gated_off_hint'),
    },
  ];
});
</script>

<template>
  <div class="command-cards">
    <div
      v-for="command in props.commands"
      :key="command.name"
      class="command-card"
      :class="{ off: !pathEnabled(command.name) }"
    >
      <div class="card-head">
        <div class="head-text">
          <span class="command-name">/{{ command.name }}</span>
          <p class="card-desc">
            {{ command.description }}
          </p>
        </div>
        <span
          v-if="!gateable(command)"
          class="dim recovery-note"
        >{{ t('recovery_note') }}</span>
        <ui-switch
          v-else
          :model-value="pathEnabled(command.name)"
          :disabled="props.busy"
          :label="t('command_on_off', { name: command.name })"
          @update:model-value="toggle(command.name)"
        />
      </div>

      <code class="usage">{{ usageOf(command) }}</code>

      <p
        v-if="command.help?.long"
        class="dim card-long"
      >
        {{ command.help.long }}
      </p>
      <p
        v-if="command.help?.examples?.length"
        class="dim examples"
      >
        <span class="zone-label">{{ t('examples') }}</span>
        <code
          v-for="example in command.help.examples"
          :key="example"
        >{{ example }}</code>
      </p>

      <template v-if="gateable(command)">
        <div class="zone">
          <span class="zone-label">{{ t('access') }}</span>
        </div>
        <div class="gate-row">
          <span class="gate-label dim">{{ t('allowed_roles') }}</span>
          <span
            v-for="role_id in gateOf(command.name).allowed_role_ids ?? []"
            :key="role_id"
            class="gate-chip"
          >
            <span
              v-if="roleColor(role_id)"
              class="chip-swatch"
              :style="{ background: roleColor(role_id) ?? '' }"
            />
            {{ roleName(role_id) }}
            <button
              class="chip-x"
              type="button"
              :aria-label="t('remove_from_list')"
              :disabled="props.busy"
              @click="removeRole(command.name, role_id)"
            >&times;</button>
          </span>
          <ui-select
            v-if="roleOptions(command.name).length > 0"
            class="gate-add"
            :options="roleOptions(command.name)"
            :model-value="null"
            :placeholder="t('add_ellipsis')"
            :disabled="props.busy"
            @update:model-value="addRole(command.name, $event)"
          />
        </div>
        <div class="gate-row">
          <span class="gate-label dim">{{ t('allowed_members') }}</span>
          <span
            v-for="user_id in gateOf(command.name).allowed_user_ids ?? []"
            :key="user_id"
            class="gate-chip"
            :data-tip="user_id"
          >
            {{ memberLabel(props.guildId, user_id) }}
            <button
              class="chip-x"
              type="button"
              :aria-label="t('remove_from_list')"
              :disabled="props.busy"
              @click="removeUser(command.name, user_id)"
            >&times;</button>
          </span>
          <input
            type="text"
            class="gate-user-input"
            :aria-label="t('add_member_id')"
            :placeholder="t('add_id_enter')"
            :disabled="props.busy"
            @keydown.enter="
              addUser(
                command.name,
                ($event.target as HTMLInputElement).value
              );
              ($event.target as HTMLInputElement).value = ''"
          >
        </div>
        <p class="dim everyone-note">
          {{ t('empty_means_everyone') }}
        </p>
      </template>

      <div
        v-if="command.subcommands.length > 0"
        class="sub-rows"
      >
        <div class="zone">
          <span class="zone-label">{{ t('subcommands') }}</span>
        </div>
        <div
          v-for="sub in command.subcommands"
          :key="sub.path"
          class="sub-row"
          :class="{
            off: !pathEnabled(`${command.name} ${sub.path}`),
          }"
        >
          <div class="sub-info">
            <code class="sub-path">{{ usageOf(command, sub) }}</code>
            <p class="sub-desc">
              {{ sub.help?.long ?? sub.description }}
            </p>
            <p
              v-if="sub.help?.examples?.length"
              class="dim examples sub-examples"
            >
              <span class="zone-label">{{ t('examples') }}</span>
              <code
                v-for="example in sub.help.examples"
                :key="example"
              >{{ example }}</code>
            </p>
          </div>
          <ui-switch
            v-if="gateable(command)"
            :model-value="pathEnabled(`${command.name} ${sub.path}`)"
            :disabled="props.busy || !pathEnabled(command.name)"
            :label="t('command_on_off', {
              name: `${command.name} ${sub.path}`,
            })"
            @update:model-value="toggle(`${command.name} ${sub.path}`)"
          />
        </div>
      </div>
    </div>

    <live-stats :tiles="tiles" />
  </div>
</template>

<style lang="scss" scoped>
@use '../styles/tokens' as t;

/* HIERARCHY BY SCALE, WEIGHT, AND SURFACE — never new colors:
   L1 the command name (sans, large, bold, bright), L2 what it
   does (mono, muted, tight under the name), the usage signature
   on the RAISED surface (closer = lighter), L3 the long help and
   examples (small, dim), then hairline-topped ZONES with micro
   uppercase headings (access, subcommands) so the eye lands in
   order: name, switch, signature, detail, controls. */
.command-card {
  border: t.$hair;
  padding: calc(t.$grid * 2) calc(t.$grid * 2) calc(t.$grid * 3);
  margin-bottom: calc(t.$grid * 3);

  &.off > .card-head .command-name {
    color: t.$dim;
    text-decoration: line-through;
  }
}

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: calc(t.$grid * 2);

  .head-text {
    min-width: 0;
  }

  .command-name {
    font-family: t.$font-sans;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  .recovery-note {
    font-size: 10px;
    white-space: nowrap;
    align-self: center;
  }
}

/* Proximity: the one-line description belongs to the name. */
.card-desc {
  font-size: 12px;
  color: t.$muted;
  margin: calc(t.$grid / 2) 0 0;
}

/* The signature is the scan anchor: raised surface, bright text. */
.usage {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  color: t.$text;
  background: t.$surface-raised;
  border: t.$hair;
  padding: calc(t.$grid / 2) t.$grid;
  margin-top: calc(t.$grid * 2);
}

.card-long {
  font-size: 11px;
  line-height: 1.6;
  margin: t.$grid 0 0;
  max-width: 80ch;
}

.examples {
  font-size: 10px;
  margin: t.$grid 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: t.$grid;
  align-items: center;

  code {
    border: t.$hair;
    padding: 1px 6px;
    color: t.$muted;
  }
}

/* Zone headings: the widget-host section-label convention. */
.zone {
  border-top: t.$hair;
  margin-top: calc(t.$grid * 2);
  padding-top: calc(t.$grid * 1.5);
}

.zone-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1.5px;
  color: t.$muted;
}

.gate-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: t.$grid;
  margin-top: t.$grid;

  .gate-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    min-width: 132px;
  }
}

.gate-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  border: t.$hair;
  background: t.$surface-raised;
  color: t.$text;
  padding: 1px 6px;

  .chip-swatch {
    display: inline-block;
    width: 8px;
    height: 8px;
    flex-shrink: 0;
  }

  .chip-x {
    background: none;
    border: 0;
    padding: 0;
    color: t.$muted;
    cursor: pointer;
    font-size: 12px;

    &:hover {
      color: t.$danger;
    }
  }
}

.gate-user-input {
  font-size: 11px;
  padding: 2px t.$grid;
  width: 220px;
  max-width: 100%;
}

.sub-examples {
  margin-top: calc(t.$grid / 2);
}

.everyone-note {
  font-size: 10px;
  margin: t.$grid 0 0;
}

.sub-rows {
  margin-top: calc(t.$grid * 2);
}

.sub-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(t.$grid * 2);
  padding: calc(t.$grid * 1.5) 0;

  & + .sub-row {
    border-top: t.$hair;
  }

  &.off .sub-path {
    color: t.$dim;
    text-decoration: line-through;
  }

  .sub-info {
    min-width: 0;
  }

  /* L2 inside the zone: the path leads bright and bold, its
     description sits dim and tight underneath. */
  .sub-path {
    font-size: 12px;
    font-weight: 700;
    color: t.$text;
  }

  .sub-desc {
    font-size: 11px;
    color: t.$dim;
    margin: calc(t.$grid / 2) 0 0;
    max-width: 72ch;
  }
}
</style>
