/**
 * Client-side mirror of the nano-dashboard.json descriptor contract
 * (src/lib/types/nano-dashboard.ts). Kept as plain interfaces — the
 * client consumes descriptors as DATA over the wire and must never
 * import server code (or zod) into the bundle.
 */
export type FieldTier = 'discord' | 'ops' | 'host';
export type ActorGate = 'ops' | 'host';
export type SnowflakeKind = 'role' | 'channel' | 'user';

/** Plain text, or a map keyed by language code ('en', 'es', ...). */
export type LocalizedText = string | Record<string, string>;

interface FieldBase {
  key: string;
  label: LocalizedText;
  help?: LocalizedText;
  tier?: FieldTier;
  propagation?: LocalizedText;
  offer_actions?: string[];
}

export interface BooleanField extends FieldBase {
  type: 'boolean';
  default?: boolean;
}

export interface NumberField extends FieldBase {
  type: 'number';
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface TextField extends FieldBase {
  type: 'text';
  default?: string;
  placeholder?: LocalizedText;
  pattern?: string;
}

export interface TemplateField extends FieldBase {
  type: 'template';
  default?: string;
  placeholder?: LocalizedText;
  slots?: string[];
}

export interface ColorField extends FieldBase {
  type: 'color';
  default?: string;
}

export interface SelectField extends FieldBase {
  type: 'select';
  options: string[];
  default?: string;
}

export interface SnowflakeField extends FieldBase {
  type: 'snowflake';
  kind: SnowflakeKind;
  placeholder?: LocalizedText;
}

export interface SnowflakeListField extends FieldBase {
  type: 'snowflake_list';
  kind: SnowflakeKind;
  min?: number;
  max?: number;
}

export interface GroupField extends FieldBase {
  type: 'group';
  fields: DashboardField[];
}

export interface ArrayField extends FieldBase {
  type: 'array';
  item: DashboardField;
  ordered?: boolean;
  min?: number;
  max?: number;
}

export interface VariantCase {
  value: string;
  label?: LocalizedText;
  fields: DashboardField[];
}

export interface VariantField extends FieldBase {
  type: 'variant';
  discriminator: string;
  variants: VariantCase[];
}

export type DashboardField =
  | BooleanField
  | NumberField
  | TextField
  | TemplateField
  | ColorField
  | SelectField
  | SnowflakeField
  | SnowflakeListField
  | GroupField
  | ArrayField
  | VariantField;

export interface DataView {
  id: string;
  title: LocalizedText;
  provides: string;
  help?: LocalizedText;
  explain?: LocalizedText;
  columns?: { key: string; label: LocalizedText }[];
  params?: DashboardField[];
  manual?: boolean;
  cooldown_s?: number;
}

export interface DashboardAction {
  id: string;
  label: LocalizedText;
  provides: string;
  help?: LocalizedText;
  group?: string;
  confirm?: boolean | LocalizedText;
  danger?: boolean;
  actor_gate?: ActorGate;
  cooldown_s?: number;
  params?: DashboardField[];
}

export interface DashboardActionGroup {
  id: string;
  title?: LocalizedText;
  help?: LocalizedText;
  see?: string;
}

export interface DashboardBadge {
  image: string;
  href?: string;
  alt: LocalizedText;
}

export type DashboardMediaItem =
  | { kind: 'image'; src: string; alt?: LocalizedText }
  | { kind: 'youtube'; id: string; title?: LocalizedText }
  | { kind: 'x'; id: string; title?: LocalizedText };

export interface DashboardCommandTag {
  name: string;
  help?: LocalizedText;
}

export interface DashboardAbout {
  description: LocalizedText;
  badges?: DashboardBadge[];
  media?: DashboardMediaItem[];
  commands?: DashboardCommandTag[];
}

export interface DashboardManifest {
  title: LocalizedText;
  about?: DashboardAbout;
  /** Language codes shipped; the FIRST entry is the module default. */
  languages?: string[];
  api_version?: string;
  config_version: number;
  config: {
    fields: DashboardField[];
    validate?: string;
  };
  data?: DataView[];
  actions?: DashboardAction[];
  action_groups?: DashboardActionGroup[];
}

export interface WebUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface ClassifiedGuild {
  id: string;
  name: string;
  icon: string | null;
  state: 'configurable' | 'invitable';
  invite_url?: string;
}

export interface ModuleRow {
  name: string;
  has_descriptor: boolean;
  available: boolean;
  reason?: string;
  registered_config_version: number | null;
}

export interface GuildReference {
  roles: {
    id: string;
    name: string;
    color: string;
    position: number;
    managed: boolean;
  }[];
  channels: {
    id: string;
    name: string;
    type: number;
    parent_id: string | null;
  }[];
}

export interface InstanceInfo {
  bot_name: string;
  bot_username: string | null;
  version: string;
  /* F25: host-tier facts — present only when the caller is the
     configured bot owner. */
  database_driver?: string;
  intents?: string[];
  web?: { port: number; bind: string };
  modules: ModuleRow[];
}

export interface CommandArg {
  name: string;
  description: string;
  type: number;
  required: boolean;
}

export interface CommandHelpCard {
  long: string;
  usage: string;
  examples: string[];
  permissions?: string;
}

export interface CommandSubRow {
  path: string;
  description: string;
  args: CommandArg[];
  help: CommandHelpCard | null;
}

export interface CommandSummary {
  name: string;
  description: string;
  default_member_permissions: string | null;
  cooldown: unknown;
  help:
    | (CommandHelpCard & { subcommands?: Record<string, CommandHelpCard> })
    | null;
  args: CommandArg[];
  subcommands: CommandSubRow[];
}

export interface CommandGate {
  enabled?: boolean;
  allowed_role_ids?: string[];
  allowed_user_ids?: string[];
}

export interface ModuleCommandsData {
  commands: CommandSummary[];
  gates: Record<string, CommandGate>;
  ungateable: string[];
  counts: { commands: number; subcommands: number };
}

export type ConfigObject = Record<string, unknown>;

export interface Envelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
  issues?: { path: string; message: string }[];
}
