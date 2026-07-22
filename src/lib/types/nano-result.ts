/**
 * Uniform result envelope returned by every nano-core API utility.
 * Plain JSON shape on purpose: safe to serialize, log, or hand to an
 * AI/MCP consumer without leaking discord.js internals.
 */
export type NanoResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Wrap a value in a successful NanoResult. */
export function ok<T>(data: T): NanoResult<T> {
  return { ok: true, data };
}

/** Wrap any thrown value in a failed NanoResult. */
export function err<T>(error: unknown): NanoResult<T> {
  const MESSAGE = error instanceof Error ? error.message : String(error);
  return { ok: false, error: MESSAGE };
}

/** Run an async action and normalize success or failure into a NanoResult. */
export async function runSafe<T>(
  action: () => Promise<T>
): Promise<NanoResult<T>> {
  try {
    return ok(await action());
  } catch (error: unknown) {
    return err(error);
  }
}
