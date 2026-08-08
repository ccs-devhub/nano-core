import type { NanoHealthReport } from '@/types/nano-module.js';

/**
 * Web host status state, kept in its own dependency-free file so the
 * kernel healthCheck can read it without importing the server (and
 * its node:http machinery) into every boot path.
 */
export interface WebStatus {
  enabled: boolean;
  listening: boolean;
  port: number;
  bind: string;
  detail: string;
}

let current_status: WebStatus = {
  enabled: false,
  listening: false,
  port: 0,
  bind: '',
  detail: 'not started',
};

export function setWebStatus(status: WebStatus): void {
  current_status = status;
}

export function webStatus(): WebStatus {
  return { ...current_status };
}

/**
 * The core-connection health view (A11): disabled is healthy (the
 * connection is simply off); enabled-but-not-listening is degraded
 * (missing secret, port in use, or a failed start).
 */
export function webHealth(): NanoHealthReport {
  if (!current_status.enabled) {
    return { status: 'healthy', details: 'web: disabled' };
  }

  if (current_status.listening) {
    return { status: 'healthy', details: `web: ${current_status.detail}` };
  }
  return { status: 'degraded', details: `web: ${current_status.detail}` };
}
