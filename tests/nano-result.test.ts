import { describe, expect, it } from 'vitest';

import { err, ok, runSafe } from '@/types/nano-result.js';

describe('NanoResult helpers', (): void => {
  it('wraps data in a success envelope', (): void => {
    expect(ok(42)).toEqual({ ok: true, data: 42 });
  });

  it('uses Error messages in failure envelopes', (): void => {
    expect(err(new Error('boom'))).toEqual({ ok: false, error: 'boom' });
  });

  it('stringifies non-Error throwables', (): void => {
    expect(err('raw failure')).toEqual({ ok: false, error: 'raw failure' });
  });

  it('runSafe returns ok on success', async (): Promise<void> => {
    const RESULT = await runSafe(async (): Promise<string> => {
      return 'done';
    });

    expect(RESULT).toEqual({ ok: true, data: 'done' });
  });

  it('runSafe catches thrown errors', async (): Promise<void> => {
    const RESULT = await runSafe(async (): Promise<string> => {
      throw new Error('exploded');
    });

    expect(RESULT).toEqual({ ok: false, error: 'exploded' });
  });
});
