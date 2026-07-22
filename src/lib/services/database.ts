import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import better_sqlite3 from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

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
  }
}
