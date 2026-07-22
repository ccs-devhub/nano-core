import { describe, expect, it, vi } from 'vitest';

import type { ErrorReplyTarget } from '@/services/errors.js';
import { replyWithError, wrapExecute } from '@/services/errors.js';

function fakeTarget(state: Partial<ErrorReplyTarget> = {}): {
  target: ErrorReplyTarget;
  reply: ReturnType<typeof vi.fn>;
  follow_up: ReturnType<typeof vi.fn>;
} {
  const REPLY = vi.fn(async (): Promise<void> => {});
  const FOLLOW_UP = vi.fn(async (): Promise<void> => {});
  return {
    target: {
      replied: false,
      deferred: false,
      reply: REPLY,
      followUp: FOLLOW_UP,
      ...state,
    } as unknown as ErrorReplyTarget,
    reply: REPLY,
    follow_up: FOLLOW_UP,
  };
}

describe('replyWithError', (): void => {
  it('replies when untouched', async (): Promise<void> => {
    const { target: _target, reply: _reply, follow_up: _follow_up } =
      fakeTarget();

    await replyWithError(_target);

    expect(_reply).toHaveBeenCalledTimes(1);
    expect(_follow_up).not.toHaveBeenCalled();
  });

  it('follows up when already replied or deferred', async ():
  Promise<void> => {
    const { target: _target, reply: _reply, follow_up: _follow_up } =
      fakeTarget({ deferred: true });

    await replyWithError(_target, 'custom message');

    expect(_follow_up).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'custom message' })
    );
    expect(_reply).not.toHaveBeenCalled();
  });

  it('never throws even when the reply itself fails', async ():
  Promise<void> => {
    const { target: _target, reply: _reply } = fakeTarget();
    _reply.mockRejectedValueOnce(new Error('expired'));

    await expect(replyWithError(_target)).resolves.toBeUndefined();
  });
});

describe('wrapExecute', (): void => {
  it('swallows module errors and answers the interaction', async ():
  Promise<void> => {
    const { target: _target, reply: _reply } = fakeTarget();
    const WRAPPED = wrapExecute('mod', async (
      first_arg: unknown
    ): Promise<void> => {
      void first_arg;
      throw new Error('boom');
    });

    await expect(WRAPPED(_target)).resolves.toBeUndefined();
    expect(_reply).toHaveBeenCalledTimes(1);
  });

  it('passes through successful calls', async (): Promise<void> => {
    const FN = vi.fn(async (first_arg: string): Promise<void> => {
      void first_arg;
    });
    const WRAPPED = wrapExecute('mod', FN);

    await WRAPPED('arg');

    expect(FN).toHaveBeenCalledWith('arg');
  });
});
