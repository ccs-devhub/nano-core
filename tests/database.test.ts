import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { DatabaseService } from '@/services/database.js';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'migrations'
);

function openTemp(): DatabaseService {
  const ROOT = mkdtempSync(join(tmpdir(), 'nano-db-'));
  const RESULT = DatabaseService.open({ driver: 'sqlite' }, ROOT);

  if (!RESULT.ok) {
    throw new Error(RESULT.error);
  }
  return RESULT.data;
}

describe('DatabaseService', (): void => {
  it('rejects the unbundled postgres driver honestly', (): void => {
    const RESULT = DatabaseService.open({ driver: 'postgres' });

    expect(RESULT.ok).toBe(false);
  });

  it('runs module migrations under a per-module journal', (): void => {
    const SERVICE = openTemp();
    const RESULT = SERVICE.runModuleMigrations('testmod', FIXTURES);

    expect(RESULT.ok).toBe(true);

    const DB = SERVICE.getDb();
    DB.run(sql`INSERT INTO mod_testmod_things (id, name) VALUES (1, 'x')`);
    const ROWS = DB.all(sql`SELECT name FROM mod_testmod_things`);

    expect(ROWS).toEqual([{ name: 'x' }]);

    /* Re-running is a no-op thanks to the journal table. */
    expect(SERVICE.runModuleMigrations('testmod', FIXTURES).ok).toBe(true);

    SERVICE.close();
  });

  it('purges only the named module tables', (): void => {
    const SERVICE = openTemp();
    SERVICE.runModuleMigrations('testmod', FIXTURES);
    const DB = SERVICE.getDb();
    DB.run(sql`CREATE TABLE mod_other_data (id integer)`);

    const PURGED = SERVICE.purgeModuleData('testmod');

    expect(PURGED.ok).toBe(true);

    if (PURGED.ok) {
      expect(PURGED.data).toEqual(['mod_testmod_things']);
    }

    const REMAINING = DB.all(
      sql`SELECT name FROM sqlite_master WHERE name LIKE 'mod_%'`
    );

    expect(REMAINING).toEqual([{ name: 'mod_other_data' }]);

    SERVICE.close();
  });

  it('persists scheduler jobs across service instances', (): void => {
    const ROOT = mkdtempSync(join(tmpdir(), 'nano-db-'));
    const FIRST_RESULT = DatabaseService.open({ driver: 'sqlite' }, ROOT);

    if (!FIRST_RESULT.ok) {
      throw new Error(FIRST_RESULT.error);
    }

    const FIRST = FIRST_RESULT.data;
    FIRST.schedulerPersistence().saveJob({
      module_id: 'mod',
      name: 'remind',
      run_at: 12345,
      payload: { channel: 'c1' },
    });
    FIRST.close();

    const SECOND_RESULT = DatabaseService.open({ driver: 'sqlite' }, ROOT);

    if (!SECOND_RESULT.ok) {
      throw new Error(SECOND_RESULT.error);
    }

    const SECOND = SECOND_RESULT.data;
    const JOBS = SECOND.schedulerPersistence().loadJobs();

    expect(JOBS).toEqual([{
      module_id: 'mod',
      name: 'remind',
      run_at: 12345,
      payload: { channel: 'c1' },
    }]);

    SECOND.schedulerPersistence().deleteJob('mod', 'remind');
    expect(SECOND.schedulerPersistence().loadJobs()).toEqual([]);

    SECOND.close();
  });
});
