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

type SqliteConnection = InstanceType<typeof better_sqlite3>;

export class DatabaseService {
  private connection: SqliteConnection;
  private db: BetterSQLite3Database;

  private constructor(connection: SqliteConnection) {
    this.connection = connection;
    this.db = drizzle(connection);
  }

  /** Open the configured database. */
  static open(
    config: DatabaseConfig = {},
    root: string = process.cwd()
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
      mkdirSync(dirname(FILE), { recursive: true });
      const CONNECTION = new better_sqlite3(FILE);
      CONNECTION.pragma('journal_mode = WAL');
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
      const PREFIX = `mod_${module_id.replaceAll('-', '_')}_`;
      const TABLES = this.connection
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' " +
          'AND name LIKE ?'
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
        return ROWS.map((row: JobRow): PersistedJob => {
          return {
            module_id: row.module_id,
            name: row.name,
            run_at: row.run_at,
            payload: JSON.parse(row.payload),
          };
        });
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
    this.connection.close();
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
