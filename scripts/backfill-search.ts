/**
 * One-off backfill: recomputes `search_vector` for every post. A no-op
 * pre-launch (no rows exist yet), kept for future re-seeding or for
 * recovering from a bulk data import that bypassed the app's normal
 * create/update path. Standalone CLI tooling — see the comment in
 * `migrate.ts` for why this doesn't import `src/lib/db/client.ts`.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { posts } from '../src/lib/db/schema';
import { refreshSearchVectorWith } from '../src/lib/db/search-core';

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
    throw new Error('DATABASE_URL is required to backfill search vectors.');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: isLocalDatabaseUrl(databaseUrl) ? false : { rejectUnauthorized: false },
  });
  const db = drizzle(pool, { schema: { posts } });

  try {
    const rows = await db.select({ id: posts.id }).from(posts);
    for (const row of rows) {
      await refreshSearchVectorWith(db, row.id);
    }
    console.log(`Backfilled search_vector for ${rows.length} post(s).`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Backfill failed:', error);
  process.exitCode = 1;
});
