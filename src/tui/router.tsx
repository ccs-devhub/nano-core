import type { ReactElement, ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';

/**
 * Minimal view router (opencode-style route context). Views are a
 * closed set; `module-panel` carries params for the selected module.
 */
export type TuiView =
  | 'dashboard'
  | 'bot'
  | 'config'
  | 'modules'
  | 'store'
  | 'commands'
  | 'run'
  | 'logs'
  | 'help'
  | 'module-panel';

/** The h/l cycling order (module-panel and help are jump-only). */
export const VIEW_ORDER: TuiView[] = [
  'dashboard',
  'bot',
  'config',
  'modules',
  'store',
  'commands',
  'run',
  'logs',
];

export interface TuiRoute {
  view: TuiView;
  params?: Record<string, string>;
}

interface RouterValue {
  route: TuiRoute;
  navigate: (view: TuiView, params?: Record<string, string>) => void;
}

const RouterContext = createContext<RouterValue>({
  route: { view: 'dashboard' },
  navigate: (): void => {},
});

export function RouterProvider(
  { children }: { children: ReactNode }
): ReactElement {
  const [route, set_route] = useState<TuiRoute>({ view: 'dashboard' });
  const navigate = (
    view: TuiView,
    params?: Record<string, string>
  ): void => {
    set_route({ view, params });
  };

  return (
    <RouterContext.Provider value={{ route, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRoute(): RouterValue {
  return useContext(RouterContext);
}
