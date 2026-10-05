/**
 * Applies every migration in `drizzle/` not yet recorded, via Drizzle's
 * `migrate()` — the mechanism `pnpm db:migrate` runs locally, in CI (dry
 * run via `drizzle-kit check`, spec/operations), and as a deploy-gating
 * step in Vercel's build before new app code goes live.
 *
 * Deliberately does NOT import `src/lib/db/client.ts` or `src/lib/env.ts`:
 * both are guarded with `import 'server-only'`, which throws when resolved
 * outside Next's bundler (plain Node via `tsx`, which is how this script
 * runs). A one-off CLI/ops script reading `DATABASE_URL` straight from
 * `process.env` is the sanctioned exception to spec/file-structure's "read
 * env through env.ts" rule — this script isn't a Server Component/Route
 * Handler/Server Action, it's build tooling, and it needs only this one
 * variable.
 *
 * Uses a direct `pg` connection (not the Neon HTTP driver) because
 * `migrate()` runs a sequence of DDL statements that need a real
 * long-lived connection — exactly what drizzle-kit's own docs recommend
 * for a one-shot migration script, Neon or not.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

function isLocalDatabaseUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations.');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: isLocalDatabaseUrl(databaseUrl) ? false : { rejectUnauthorized: false },
  });

  try {
    const db = drizzle(pool);
    console.log('Applying pending migrations from ./drizzle ...');
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
