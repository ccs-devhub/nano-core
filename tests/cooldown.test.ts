import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CooldownManager } from '@/services/cooldown.js';

const CTX = { user_id: 'u1', guild_id: 'g1', channel_id: 'c1' };

describe('CooldownManager', (): void => {
  beforeEach((): void => {
    vi.useFakeTimers();
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('allows commands without a defined cooldown', (): void => {
    const MANAGER = new CooldownManager();

    expect(MANAGER.consume('free', CTX).allowed).toBe(true);
    expect(MANAGER.hasCooldown('free')).toBe(false);
  });

  it('blocks after the limit and reports retry time', (): void => {
    const MANAGER = new CooldownManager();
    MANAGER.defineCooldown('cmd', { scope: 'user', delay_ms: 10000 });

    expect(MANAGER.consume('cmd', CTX).allowed).toBe(true);
    const DENIED = MANAGER.consume('cmd', CTX);

    expect(DENIED.allowed).toBe(false);
    expect(DENIED.retry_after_ms).toBeGreaterThan(0);
  });

  it('refills after the window passes', (): void => {
    const MANAGER = new CooldownManager();
    MANAGER.defineCooldown('cmd', { scope: 'user', delay_ms: 10000 });

    MANAGER.consume('cmd', CTX);
    vi.advanceTimersByTime(10001);

    expect(MANAGER.consume('cmd', CTX).allowed).toBe(true);
  });

  it('supports multi-use limits', (): void => {
    const MANAGER = new CooldownManager();
    MANAGER.defineCooldown('cmd', {
      scope: 'user',
      delay_ms: 10000,
      limit: 2,
    });

    expect(MANAGER.consume('cmd', CTX).allowed).toBe(true);
    expect(MANAGER.consume('cmd', CTX).allowed).toBe(true);
    expect(MANAGER.consume('cmd', CTX).allowed).toBe(false);
  });

  it('scopes buckets separately', (): void => {
    const MANAGER = new CooldownManager();
    MANAGER.defineCooldown('cmd', { scope: 'user', delay_ms: 10000 });

    MANAGER.consume('cmd', CTX);
    const OTHER_USER = MANAGER.consume('cmd', { ...CTX, user_id: 'u2' });

    expect(OTHER_USER.allowed).toBe(true);
  });

  it('reset clears a bucket', (): void => {
    const MANAGER = new CooldownManager();
    MANAGER.defineCooldown('cmd', { scope: 'guild', delay_ms: 10000 });

    MANAGER.consume('cmd', CTX);
    MANAGER.reset('cmd', CTX);

    expect(MANAGER.consume('cmd', CTX).allowed).toBe(true);
  });
});
