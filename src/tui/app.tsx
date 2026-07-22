import { Box, useApp, useInput } from 'ink';
import type { ReactElement } from 'react';

import { getStyle } from '@/registry/nano-style.js';

import { Sidebar } from './components/sidebar.js';
import { StatusBar } from './components/status-bar.js';
import { UiStateProvider, useUiState } from './state/ui-state.js';
import { BotView } from './views/bot.js';
import { CommandsView } from './views/commands.js';
import { ConfigView } from './views/config.js';
import { Dashboard } from './views/dashboard.js';
import { HelpView } from './views/help.js';
import { LogsView } from './views/logs.js';
import { ModulePanel } from './views/module-panel.js';
import { ModulesView } from './views/modules.js';
import { RunView } from './views/run.js';
import { StoreView } from './views/store.js';
import type { TuiView } from './router.js';
import { RouterProvider, useRoute, VIEW_ORDER } from './router.js';

const VIEW_KEYS: Record<string, TuiView> = {
  '1': 'dashboard',
  '2': 'bot',
  '3': 'config',
  '4': 'modules',
  '5': 'store',
  '6': 'commands',
  '7': 'run',
  '8': 'logs',
};

function Content(): ReactElement {
  const { route } = useRoute();

  if (route.view === 'bot') {
    return <BotView />;
  }

  if (route.view === 'config') {
    return <ConfigView />;
  }

  if (route.view === 'modules') {
    return <ModulesView />;
  }

  if (route.view === 'module-panel') {
    return <ModulePanel />;
  }

  if (route.view === 'store') {
    return <StoreView />;
  }

  if (route.view === 'commands') {
    return <CommandsView />;
  }

  if (route.view === 'run') {
    return <RunView />;
  }

  if (route.view === 'logs') {
    return <LogsView />;
  }

  if (route.view === 'help') {
    return <HelpView />;
  }
  return <Dashboard />;
}

function Shell(): ReactElement {
  const { route, navigate } = useRoute();
  const { editing } = useUiState();
  const { exit } = useApp();
  const STYLE = getStyle();

  useInput((input): void => {
    if (editing) {
      return;
    }

    if (input === 'q') {
      exit();
      return;
    }

    if (input === '?') {
      navigate('help');
      return;
    }

    if (input === 'h' || input === 'l') {
      const CURRENT = VIEW_ORDER.indexOf(
        route.view === 'module-panel' ? 'modules' : route.view
      );
      const BASE = CURRENT === -1 ? 0 : CURRENT;
      const NEXT = input === 'l'
        ? (BASE + 1) % VIEW_ORDER.length
        : (BASE - 1 + VIEW_ORDER.length) % VIEW_ORDER.length;
      navigate(VIEW_ORDER[NEXT]);
      return;
    }

    const VIEW = VIEW_KEYS[input];

    if (VIEW) {
      navigate(VIEW);
    }
  });

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle={STYLE.tui.border_style}
      borderColor={STYLE.palette.primary}
      borderDimColor
    >
      <Box flexGrow={1}>
        <Sidebar />
        <Box
          flexDirection="column"
          flexGrow={1}
          paddingLeft={2}
          paddingRight={1}
          paddingTop={1}
        >
          <Content />
        </Box>
      </Box>
      <StatusBar view={route.view} />
    </Box>
  );
}

export function App(): ReactElement {
  return (
    <UiStateProvider>
      <RouterProvider>
        <Shell />
      </RouterProvider>
    </UiStateProvider>
  );
}
