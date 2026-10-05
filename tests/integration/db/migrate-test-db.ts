import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { testDatabaseUrl } from './test-env';

/**
 * Applies every migration in `drizzle/` to the test database. Idempotent
 * (drizzle's own migrations-tracking table skips anything already
 * applied), so every integration test file can safely call this in its
 * own `beforeAll` without caring which file runs first.
 */
export async function migrateTestDb(): Promise<void> {
  const pool = new Pool({ connectionString: testDatabaseUrl() });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}
