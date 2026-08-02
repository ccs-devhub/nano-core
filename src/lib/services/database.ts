import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import better_sqlite3 from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import type { GuildConfigPersistence } from
  '@/services/guild-store.js';
import type { PersistedJob, SchedulerPersistence } from
  '@/services/scheduler.js';
import type { NanoResult } from '@/types/nano-result.js';
import { err, ok } from '@/types/nano-result.js';

/**
 * Core database service: better-sqlite3 + Drizzle by default (zero
 * config, one file, WAL). PostgreSQL is a config seam — same Drizzle
 * schemas, different driver — not bundled to keep clone-and-run light.
 *
 * Modules own their tables (prefix them `mod_<name>_*`) and their
 * migrations: each enabled module migrates against its own journal
 * table `__migrations_<module>`, so modules install, upgrade, and get
 * removed independently. Core NEVER auto-drops module tables.
 */
export interface DatabaseConfig {
  driver?: 'sqlite' | 'postgres';
  url?: string;
}

interface JobRow {
  module_id: string;
  name: string;
  run_at: number;
  payload: string;
}

const DEFAULT_SQLITE_PATH = 'data/nano.db';

/** nano_runtime key the heartbeat stamps (the downtime ledger). */
export const RUNTIME_KEY_LAST_ALIVE = 'last_alive_at';

/**
 * The table-name prefix a module's DDL must use. Module ids mangle
 * `-` to `_`, so DISTINCT ids can share a prefix (`a-b` vs `a_b`) —
 * the installer rejects such collisions at install time (DB2-2).
 */
export function moduleTablePrefix(module_id: string): string {
  return `mod_${module_id.replaceAll('-', '_')}_`;
}

/** Escape LIKE wildcards so a prefix matches literally (DB8). */
function escapeLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, '\\$&');
}

type SqliteConnection = InstanceType<typeof better_sqlite3>;

export class DatabaseService {
  private connection: SqliteConnection;
  private db: BetterSQLite3Database;

  private constructor(connection: SqliteConnection) {
    this.connection = connection;
    this.db = drizzle(connection);
  }

  /**
   * Open the configured database. `readonly` (DB2-3) is for
   * observers like doctor: fileMustExist, no pragma writes, no
   * table creation — an observer can never become a second writer.
   */
  static open(
    config: DatabaseConfig = {},
    root: string = process.cwd(),
    options: { readonly?: boolean } = {}
  ): NanoResult<DatabaseService> {
    const DRIVER = config.driver ?? 'sqlite';

    if (DRIVER === 'postgres') {
      return err(
        'PostgreSQL is a supported seam but its driver is not bundled. ' +
        'Install `pg`, switch the drizzle driver in ' +
        'src/lib/services/database.ts, and keep the same schemas.'
      );
    }

    try {
      const FILE = resolve(root, config.url ?? DEFAULT_SQLITE_PATH);

      if (options.readonly) {
        const CONNECTION = new better_sqlite3(FILE, {
          readonly: true,
          fileMustExist: true,
        });
        return ok(new DatabaseService(CONNECTION));
      }

      mkdirSync(dirname(FILE), { recursive: true });
      const CONNECTION = new better_sqlite3(FILE);
      CONNECTION.pragma('journal_mode = WAL');
      /* D-SETTINGS: NORMAL is already the WAL default in this
         build — set explicitly for determinism only. */
      CONNECTION.pragma('synchronous = NORMAL');
      const SERVICE = new DatabaseService(CONNECTION);
      SERVICE.createCoreTables();
      return ok(SERVICE);
    } catch (error: unknown) {
      return err(error);
    }
  }

  /** The Drizzle instance modules query through. */
  getDb(): BetterSQLite3Database {
    return this.db;
  }

  /** Absolute path of the open sqlite file (vitals size gauges). */
  filePath(): string {
    return this.connection.name;
  }

  /** Run one module's own migrations under its own journal table. */
  runModuleMigrations(
    module_id: string,
    migrations_folder: string
  ): NanoResult<string> {
    try {
      migrate(this.db, {
        migrationsFolder: migrations_folder,
        migrationsTable: `__migrations_${module_id.replaceAll('-', '_')}`,
      });
      return ok(module_id);
    } catch (error: unknown) {
      return err(error);
    }
  }

  /** Explicit, owner-invoked destruction of a module's tables. */
  purgeModuleData(module_id: string): NanoResult<string[]> {
    try {
      /* DB8: without ESCAPE the `_` separators are wildcards and
         purging 'leveling' also drops mod_levelingpro_* tables. */
      const PREFIX = escapeLikePrefix(moduleTablePrefix(module_id));
      const TABLES = this.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' " +
          "AND name LIKE ? ESCAPE '\\'"
        )
        .all(`${PREFIX}%`) as { name: string }[];

      for (const _table of TABLES) {
        this.connection.exec(`DROP TABLE IF EXISTS "${_table.name}"`);
      }

      this.connection.exec(
        `DROP TABLE IF EXISTS "__migrations_${
          module_id.replaceAll('-', '_')}"`
      );
      return ok(TABLES.map((table: { name: string }): string => {
        return table.name;
      }));
    } catch (error: unknown) {
      return err(error);
    }
  }

  /**
   * Data-lifecycle hygiene when the bot leaves a guild (DB2-11):
   * delete that guild's rows from every module table and the core
   * guild-config store. Returns the tables that carry a guild_id
   * column (the ones touched).
   */
  purgeGuildData(guild_id: string): NanoResult<string[]> {
    try {
      const TABLES = this.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' " +
          "AND (name LIKE 'mod\\_%' ESCAPE '\\' " +
          "OR name = 'nano_guild_config')"
        )
        .all() as { name: string }[];
      const TOUCHED: string[] = [];

      for (const _table of TABLES) {
        const COLUMNS = this.connection
          .prepare(`PRAGMA table_info("${_table.name}")`)
          .all() as { name: string }[];
        const HAS_GUILD_ID = COLUMNS.some(
          (column: { name: string }): boolean => {
            return column.name === 'guild_id';
          }
        );

        if (!HAS_GUILD_ID) {
          continue;
        }

        this.connection
          .prepare(`DELETE FROM "${_table.name}" WHERE guild_id = ?`)
          .run(guild_id);
        TOUCHED.push(_table.name);
      }
      return ok(TOUCHED);
    } catch (error: unknown) {
      return err(error);
    }
  }

  /** Scheduler persistence backed by the core `nano_jobs` table. */
  schedulerPersistence(): SchedulerPersistence {
    const CONNECTION = this.connection;

    return {
      saveJob: (job: PersistedJob): void => {
        CONNECTION.prepare(
          'INSERT OR REPLACE INTO nano_jobs ' +
          '(module_id, name, run_at, payload) VALUES (?, ?, ?, ?)'
        ).run(job.module_id, job.name, job.run_at,
          JSON.stringify(job.payload ?? null));
      },
      deleteJob: (module_id: string, name: string): void => {
        CONNECTION.prepare(
          'DELETE FROM nano_jobs WHERE module_id = ? AND name = ?'
        ).run(module_id, name);
      },
      loadJobs: (): PersistedJob[] => {
        const ROWS = CONNECTION.prepare(
          'SELECT module_id, name, run_at, payload FROM nano_jobs'
        ).all() as JobRow[];
        const JOBS: PersistedJob[] = [];

        for (const _row of ROWS) {
          /* N18: one corrupt payload must never crash boot. */
          try {
            JOBS.push({
              module_id: _row.module_id,
              name: _row.name,
              run_at: _row.run_at,
              payload: JSON.parse(_row.payload),
            });
          } catch {
            process.stdout.write(
              `[WARN] Dropping persisted job '${_row.module_id}/` +
              `${_row.name}' — unreadable payload.\n`
            );
          }
        }
        return JOBS;
      },
    };
  }

  /** Guild-config storage backed by the core `nano_guild_config`
   * table. Writes are single synchronous transactions (DB9: a
   * better-sqlite3 transaction can never contain an await). */
  guildConfigPersistence(): GuildConfigPersistence {
    const CONNECTION = this.connection;
    const UPSERT = CONNECTION.prepare(
      'INSERT INTO nano_guild_config ' +
      '(guild_id, module_id, key, value, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT (guild_id, module_id, key) ' +
      'DO UPDATE SET value = excluded.value, ' +
      'updated_at = excluded.updated_at'
    );
    const UPSERT_MANY = CONNECTION.transaction(
      (
        guild_id: string,
        module_id: string,
        entries: { key: string; value: string }[],
        replace: boolean
      ): void => {
        if (replace) {
          CONNECTION.prepare(
            'DELETE FROM nano_guild_config ' +
            'WHERE guild_id = ? AND module_id = ?'
          ).run(guild_id, module_id);
        }

        const NOW = Date.now();

        for (const _entry of entries) {
          UPSERT.run(guild_id, module_id, _entry.key, _entry.value, NOW);
        }
      }
    );

    return {
      loadModuleConfig: (
        guild_id: string,
        module_id: string
      ): { key: string; value: string }[] => {
        return CONNECTION.prepare(
          'SELECT key, value FROM nano_guild_config ' +
          'WHERE guild_id = ? AND module_id = ?'
        ).all(guild_id, module_id) as { key: string; value: string }[];
      },
      replaceModuleConfig: (
        guild_id: string,
        module_id: string,
        entries: { key: string; value: string }[]
      ): void => {
        UPSERT_MANY(guild_id, module_id, entries, true);
      },
      upsertKeys: (
        guild_id: string,
        module_id: string,
        entries: { key: string; value: string }[]
      ): void => {
        UPSERT_MANY(guild_id, module_id, entries, false);
      },
      deleteModuleConfig: (
        guild_id: string,
        module_id: string
      ): number => {
        return CONNECTION.prepare(
          'DELETE FROM nano_guild_config ' +
          'WHERE guild_id = ? AND module_id = ?'
        ).run(guild_id, module_id).changes;
      },
      listGuildsFor: (module_id: string): string[] => {
        const ROWS = CONNECTION.prepare(
          'SELECT DISTINCT guild_id FROM nano_guild_config ' +
          'WHERE module_id = ?'
        ).all(module_id) as { guild_id: string }[];
        return ROWS.map((row: { guild_id: string }): string => {
          return row.guild_id;
        });
      },
    };
  }

  close(): void {
    /* DB7/DB5: fold the WAL back so backups and restores see one
       file; harmless (and skipped) on a readonly connection. */
    try {
      if (!this.connection.readonly) {
        this.connection.pragma('wal_checkpoint(TRUNCATE)');
      }
    } catch {
      /* checkpoint is best-effort — close regardless */
    }
    this.connection.close();
  }

  /**
   * Small core key-value row (the downtime ledger and friends).
   * Never fatal: a failed stamp must not take the heartbeat down.
   */
  getRuntimeValue(key: string): string | null {
    try {
      const ROW = this.connection
        .prepare('SELECT value FROM nano_runtime WHERE key = ?')
        .get(key) as { value: string } | undefined;
      return ROW?.value ?? null;
    } catch {
      return null;
    }
  }

  setRuntimeValue(key: string, value: string): void {
    try {
      this.connection
        .prepare(
          'INSERT INTO nano_runtime (key, value) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run(key, value);
    } catch {
      /* the ledger is advisory — a failed stamp only widens the
         next reconcile window */
    }
  }

  private createCoreTables(): void {
    this.connection.exec(
      'CREATE TABLE IF NOT EXISTS nano_jobs (' +
      'module_id TEXT NOT NULL, ' +
      'name TEXT NOT NULL, ' +
      'run_at INTEGER NOT NULL, ' +
      'payload TEXT, ' +
      'PRIMARY KEY (module_id, name))'
    );
    this.connection.exec(
      'CREATE TABLE IF NOT EXISTS nano_runtime (' +
      'key TEXT PRIMARY KEY, ' +
      'value TEXT NOT NULL)'
    );
    this.connection.exec(
      'CREATE TABLE IF NOT EXISTS nano_guild_config (' +
      'guild_id TEXT NOT NULL, ' +
      'module_id TEXT NOT NULL, ' +
      'key TEXT NOT NULL, ' +
      'value TEXT NOT NULL, ' +
      'updated_at INTEGER NOT NULL, ' +
      'PRIMARY KEY (guild_id, module_id, key))'
    );
  }
}
