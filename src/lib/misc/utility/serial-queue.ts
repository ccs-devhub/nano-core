/**
 * C2: per-entity serialization + debounce/coalesce. Instantiated PER
 * MODULE (PF4 — instances are module-owned, never a global core
 * queue). Idle keys are dropped as soon as their chain drains
 * (PF17 — memory stays bounded without sweep timers). Consumers:
 * panel per-member queues, announcer bottom-mode debounce, the
 * billboard queue worker, reconcile batching.
 */
export interface SerialQueueOptions {
  debounce_ms?: number;
}

interface KeyState {
  chain: Promise<unknown>;
  pending: number;
  timer: NodeJS.Timeout | null;
}

const DEFAULT_DEBOUNCE_MS = 2000;

export class SerialQueue {
  private options: SerialQueueOptions;
  private states: Map<string, KeyState> = new Map();

  constructor(options: SerialQueueOptions = {}) {
    this.options = options;
  }

  /**
   * Run `fn` after every earlier job of the same key has settled.
   * Different keys never wait on each other. The returned promise
   * is `fn`'s own result; a failing job never breaks the chain.
   */
  run<T>(key: string, fn: () => Promise<T> | T): Promise<T> {
    const STATE = this.stateFor(key);
    STATE.pending += 1;

    const RESULT = STATE.chain.then((): Promise<T> | T => {
      return fn();
    });
    STATE.chain = RESULT
      .catch((): undefined => {
        return undefined;
      })
      .finally((): void => {
        STATE.pending -= 1;
        this.dropIfIdle(key);
      });
    return RESULT;
  }

  /**
   * Debounce + coalesce per key: only the LAST scheduled `fn` runs,
   * one debounce window after the last call, serialized behind the
   * key's queue.
   */
  debounce(
    key: string,
    fn: () => Promise<void> | void,
    debounce_ms?: number
  ): void {
    const STATE = this.stateFor(key);

    if (STATE.timer) {
      clearTimeout(STATE.timer);
    }

    STATE.timer = setTimeout((): void => {
      STATE.timer = null;
      void this.run(key, fn);
    }, debounce_ms ?? this.options.debounce_ms ?? DEFAULT_DEBOUNCE_MS);
  }

  /** Live key count (PF17 visibility; tests assert boundedness). */
  size(): number {
    return this.states.size;
  }

  /** Cancel pending debounces and forget every key (onDisable). */
  clear(): void {
    for (const _state of this.states.values()) {
      if (_state.timer) {
        clearTimeout(_state.timer);
      }
    }
    this.states.clear();
  }

  private stateFor(key: string): KeyState {
    let state = this.states.get(key);

    if (!state) {
      state = { chain: Promise.resolve(), pending: 0, timer: null };
      this.states.set(key, state);
    }
    return state;
  }

  private dropIfIdle(key: string): void {
    const STATE = this.states.get(key);

    if (STATE && STATE.pending === 0 && !STATE.timer) {
      this.states.delete(key);
    }
  }
}
