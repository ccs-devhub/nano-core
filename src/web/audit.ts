import { getModuleLogger } from '@/services/logger.js';

/**
 * The web audit trail: every PUT and every action dispatch leaves a
 * structured line — who, where, what, and (for config writes) exactly
 * which keys changed. The diff IS the changed_keys list (C2).
 */
export interface WebAuditEvent {
  kind: string;
  user_id: string;
  guild_id: string;
  module_id?: string;
  changed_keys?: string[];
  detail?: string;
  /** F28: the client address the write arrived from. */
  ip?: string;
}

export function auditWeb(event: WebAuditEvent): void {
  getModuleLogger('web').info(
    { evt: 'web_audit', ...event },
    `web ${event.kind}`
  );
}
