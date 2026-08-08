import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * A minimal path router for the web host: exact segments plus
 * `:param` captures. No wildcards, no middleware — auth and CSRF
 * guards wrap handlers explicitly at registration time so every
 * route's guard chain is visible where the route is declared.
 */
export interface WebContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
}

export type WebHandler = (context: WebContext) => Promise<void> | void;

interface WebRoute {
  method: string;
  segments: string[];
  handler: WebHandler;
}

export class WebRouter {
  private routes: WebRoute[] = [];

  add(method: string, pattern: string, handler: WebHandler): void {
    this.routes.push({
      method,
      segments: pattern.split('/').filter((part: string): boolean => {
        return part.length > 0;
      }),
      handler,
    });
  }

  /** Find a route; null when nothing matches (caller falls through). */
  match(
    method: string,
    pathname: string
  ): { handler: WebHandler; params: Record<string, string> } | null {
    const PARTS = pathname.split('/').filter((part: string): boolean => {
      return part.length > 0;
    });

    for (const _route of this.routes) {
      if (_route.method !== method) {
        continue;
      }

      if (_route.segments.length !== PARTS.length) {
        continue;
      }

      const PARAMS: Record<string, string> = {};
      let matched = true;

      for (let i = 0; i < PARTS.length; i += 1) {
        const SEGMENT = _route.segments[i];

        if (SEGMENT.startsWith(':')) {
          PARAMS[SEGMENT.slice(1)] = decodeURIComponent(PARTS[i]);
        } else if (SEGMENT !== PARTS[i]) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return { handler: _route.handler, params: PARAMS };
      }
    }
    return null;
  }
}
