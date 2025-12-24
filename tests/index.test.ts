import { describe, expect, it, vi } from 'vitest';

// Mock discord.js Client
class MockClient {
  once(event: string, callback: () => void): void {
    if (event === 'ready') {
      this.user = { tag: 'TestUser#1234' };
      callback.call(this);
    }
  }
  login(token: string | undefined): Promise<void> {
    return Promise.resolve(token === 'FAKE_TOKEN');
  }
  user?: { tag: string };
}

describe('Discord bot', (): void => {
  it('logs in and displays username', async (): Promise<void> => {
    const WRITE_SPY = vi.spyOn(process.stdout, 'write');

    const BOT = new MockClient();
    BOT.once('ready', function (): void {
      process.stdout.write(`Logged in as ${this.user?.tag}\n`);
    });

    await BOT.login('FAKE_TOKEN');

    expect(WRITE_SPY).toHaveBeenCalledWith('Logged in as TestUser#1234\n');

    WRITE_SPY.mockRestore();
  });
});
