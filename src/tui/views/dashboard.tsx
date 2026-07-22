import { Box, Text, useStdout } from 'ink';
import type { ReactElement } from 'react';

import { NANO_VERSION } from '@/constants/nano.js';
import { loadConfig } from '@/registry/nano-config.js';
import { getLogoLines, getStyle } from '@/registry/nano-style.js';
import { listModuleRows } from '@/tui/state/module-rows.js';

function InfoRow(
  { name, value }: { name: string; value: string }
): ReactElement {
  const STYLE = getStyle();

  return (
    <Box gap={1}>
      <Box width={11}>
        <Text bold color={STYLE.palette.accent}>{name}</Text>
      </Box>
      <Text>{value}</Text>
    </Box>
  );
}

export function Dashboard(): ReactElement {
  const CONFIG = loadConfig();
  const STYLE = getStyle();
  const LOGO = getLogoLines();
  const ROWS = listModuleRows();
  const { stdout } = useStdout();
  const ENABLED = ROWS.filter((row): boolean => {
    return row.enabled;
  }).length;
  const MISSING_SECRETS = [
    process.env.DISCORD_TOKEN ? null : 'DISCORD_TOKEN',
    process.env.CLIENT_ID ? null : 'CLIENT_ID',
  ].filter(Boolean);
  const SHOW_LOGO = (stdout.rows ?? 0) >= STYLE.tui.logo_min_rows &&
    (stdout.columns ?? 0) >= STYLE.tui.logo_min_columns;

  const INFO = (
    <Box flexDirection="column">
      <Text bold color={STYLE.palette.primary}>
        nano-core v{NANO_VERSION}
      </Text>
      <Text dimColor>{'-'.repeat(STYLE.banner.rule_width)}</Text>
      <InfoRow name="bot" value={CONFIG.bot.name} />
      <InfoRow
        name="guild"
        value={CONFIG.bot.dev_guild_id ?? 'global commands'}
      />
      <InfoRow name="intents" value={CONFIG.intents.join(', ')} />
      <InfoRow name="database" value={CONFIG.database.driver} />
      <InfoRow
        name="modules"
        value={`${ENABLED}/${ROWS.length} enabled (+ kernel, core)`}
      />
      <InfoRow
        name="secrets"
        value={MISSING_SECRETS.length === 0
          ? 'DISCORD_TOKEN and CLIENT_ID set (.env)'
          : `MISSING: ${MISSING_SECRETS.join(', ')} — set in .env`}
      />
      <InfoRow name="node" value={process.version} />
      <Text> </Text>
      <Text dimColor>store: {CONFIG.store.registry_url}</Text>
      <Text> </Text>
      <Text dimColor>
        verify: npm run doctor · run: npm run dev · help: ?
      </Text>
    </Box>
  );

  const SIGNATURE = (
    <Box justifyContent="flex-end" paddingX={1}>
      <Text color={STYLE.palette.primary}>{'▣ '}</Text>
      <Text dimColor>Cyber Code Syndicate (CCS)</Text>
    </Box>
  );

  if (!SHOW_LOGO) {
    return (
      <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
        {INFO}
        <Box flexGrow={1} />
        {SIGNATURE}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
      <Box gap={3}>
        <Box flexDirection="column" justifyContent="center">
          {LOGO.map((line, index): ReactElement => {
            return (
              <Text key={index} color={STYLE.logo.color} wrap="truncate">
                {line}
              </Text>
            );
          })}
        </Box>
        <Box flexDirection="column" justifyContent="center">
          {INFO}
        </Box>
      </Box>
      <Box flexGrow={1} />
      {SIGNATURE}
    </Box>
  );
}
