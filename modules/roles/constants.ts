/**
 * C7: texts owned by the roles module. Core texts come from the
 * package and are never duplicated here. `{slot}` placeholders are
 * filled by fillSlots() from the barrel. THE LAYERING LAW applies:
 * a per-guild template in config overrides any constant below.
 */

export const ROLES_VERSION = '0.1.0';

export const TEXT_ROLES_DB_REQUIRED =
  'The roles module needs the database service, it stays disabled ' +
  'without one.';

export const TEXT_ROLES_HEALTH_NO_DB =
  'Database unavailable, role state cannot persist.';

export const TEXT_ROLES_HEALTH_READY =
  'Ledger, snapshots and panels storage ready.';

/* Fallback for restore.notice (config-first, constant-fallback). */
export const TEXT_ROLES_RESTORE_NOTICE =
  'Your roles were restored. Roles that no longer exist were ' +
  'skipped, {dropped}.';

/* Pick refusals, sent as a notice or an ephemeral reply. */
export const TEXT_ROLES_PICK_GATE_AGE =
  'Your account is too new for this panel, try again in a few days.';
export const TEXT_ROLES_PICK_GATE_TENURE =
  'You joined this server recently, this panel unlocks after a ' +
  'short wait.';
export const TEXT_ROLES_PICK_GATE_SANCTIONED =
  'This panel is not available to you right now.';
export const TEXT_ROLES_PICK_MAX =
  'You already hold the maximum picks from this panel, remove one ' +
  'first.';
export const TEXT_ROLES_PICK_UNKNOWN =
  'That option is not part of this panel.';
export const TEXT_ROLES_PICK_GRANTED = 'Role granted.';
export const TEXT_ROLES_PICK_REMOVED = 'Role removed.';

/* /roles grant|revoke, the manual write surface (box 4 slice B). */
export const TEXT_ROLES_GUILD_ONLY =
  'This command only works inside a server.';
export const TEXT_ROLES_ROLE_UNREADABLE =
  'That role could not be read, try again in a moment.';
export const TEXT_ROLES_HIERARCHY_BLOCKED =
  'That role sits at or above your highest role, you cannot hand ' +
  'it out.';
export const TEXT_ROLES_CONFIRM_GRANT =
  'You are about to grant {role} to {member}.';
export const TEXT_ROLES_CONFIRM_REVOKE =
  'You are about to remove {role} from {member}.';
export const TEXT_ROLES_CONFIRM_REASON = 'Reason, {reason}.';
export const TEXT_ROLES_CONFIRM_PRIVILEGED =
  'Careful, this role carries privileged permissions, {permissions}.';
export const TEXT_ROLES_OUTCOME_GRANTED =
  'Role granted and written to the ledger.';
export const TEXT_ROLES_OUTCOME_REVOKED =
  'Role removed and released from the ledger.';
export const TEXT_ROLES_OUTCOME_NOOP_GRANT =
  'No change was needed, the member already holds that role.';
export const TEXT_ROLES_OUTCOME_NOOP_REVOKE =
  'No change was needed, the member does not hold that role.';
export const TEXT_ROLES_REFUSAL_MISSING =
  'That role no longer exists.';
export const TEXT_ROLES_REFUSAL_EVERYONE =
  'The base role of this server cannot be granted or removed.';
export const TEXT_ROLES_REFUSAL_MANAGED =
  'That role belongs to an integration and manages itself.';
export const TEXT_ROLES_REFUSAL_SANCTION =
  'That role is owned by moderation and is never handed out here.';
export const TEXT_ROLES_REFUSAL_ABOVE_BOT =
  'That role sits above the bot, move the bot role higher first.';
export const TEXT_ROLES_CARD_TITLE_GRANT = '**Role grant**';
export const TEXT_ROLES_CARD_TITLE_REVOKE = '**Role removal**';
export const TEXT_ROLES_FIELD_MEMBER = '**Member:**';
export const TEXT_ROLES_FIELD_ROLE = '**Role:**';
export const TEXT_ROLES_FIELD_MODERATOR = '**Moderator:**';
export const TEXT_ROLES_FIELD_RUN = '**Run:**';
