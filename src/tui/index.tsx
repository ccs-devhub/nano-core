import { withFullScreen } from 'fullscreen-ink';

import 'dotenv/config';

import { listModuleRows } from './state/module-rows.js';
import { App } from './app.js';

import { intro, note, outro } from '@clack/prompts';

/**
 * TUI entry (`npm run ui`). Full-screen Ink app on a real terminal;
 * a read-only clack summary on non-TTY streams (CI, pipes).
 */
async function launch(): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    intro('nano-core');
    const ROWS = listModuleRows();
    note(
      ROWS.length === 0
        ? 'No external modules configured.'
        : ROWS.map((row): string => {
          return `${row.enabled ? '[x]' : '[ ]'} ${row.name} ` +
            `(${row.source}${row.trusted ? '' : ', unreviewed'})`;
        }).join('\n'),
      'Modules'
    );
    outro(
      'The interactive window needs a TTY. Use `npm run module -- list` ' +
      'and friends from scripts.'
    );
    return;
  }

  const INSTANCE = withFullScreen(<App />);
  await INSTANCE.start();
  await INSTANCE.waitUntilExit();
}

await launch();
