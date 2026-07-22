import type { Logger } from 'pino';
import { pino } from 'pino';

/**
 * Logging configuration, read from the `logging` section of
 * nano.config.json. `module_levels` overrides the level per module.
 */
export interface LoggerConfig {
  level?: string;
  pretty?: boolean;
  file?: string;
  module_levels?: Record<string, string>;
}

let root_logger: Logger | null = null;
let logger_config: LoggerConfig = {};

/** Create (or replace) the root pino logger from config. */
export function createLogger(config: LoggerConfig = {}): Logger {
  logger_config = config;
  const TARGETS: { target: string; options: object }[] = [];

  if (config.file) {
    TARGETS.push({
      target: 'pino/file',
      options: { destination: config.file, mkdir: true },
    });
  }

  if (config.pretty) {
    TARGETS.push({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        singleLine: true,
        customColors:
          'info:magenta,warn:yellow,error:red,fatal:red,' +
          'debug:gray,trace:gray',
      },
    });
  } else {
    TARGETS.push({
      target: 'pino/file',
      options: { destination: 1 },
    });
  }

  root_logger = pino({
    level: config.level ?? 'info',
    transport: { targets: TARGETS },
  });
  return root_logger;
}

/** The root logger, lazily created with defaults when not configured. */
export function getLogger(): Logger {
  if (!root_logger) {
    root_logger = createLogger(logger_config);
  }
  return root_logger;
}

/** A child logger bound to one module, honoring per-module levels. */
export function getModuleLogger(module_id: string): Logger {
  const CHILD = getLogger().child({ module: module_id });
  const LEVEL = logger_config.module_levels?.[module_id];

  if (LEVEL) {
    CHILD.level = LEVEL;
  }
  return CHILD;
}
