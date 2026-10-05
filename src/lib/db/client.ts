import 'server-only';

import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from '@/lib/env';

import * as schema from './schema';

/**
 * One typed `db` export, reading `DATABASE_URL` through `src/lib/env.ts`
 * (never `process.env` directly, per spec/file-structure).
 *
 * decision/tech-stack picks `@neondatabase/serverless` for Neon
 * (preview/production): the `neon-http` driver issues each query as a
 * single HTTP round-trip, which is what makes Drizzle usable from Vercel's
 * serverless/Edge functions without holding a TCP connection open.
 *
 * Neon's HTTP driver only speaks to Neon's own endpoint, though, and local
 * dev runs a plain `postgres:16-alpine` container (docker-compose.yml), not
 * Neon — so locally we fall back to `drizzle-orm/node-postgres` (`pg`'s
 * connection-pooled TCP driver), selected by sniffing the host out of
 * `DATABASE_URL`. Both branches resolve to the same query-builder API, so
 * every query function in `queries/*.ts` is identical either way.
 */
function isLocalDatabaseUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function createDb() {
  if (isLocalDatabaseUrl(env.DATABASE_URL)) {
    const pool = new Pool({ connectionString: env.DATABASE_URL });
    return drizzleNodePg(pool, { schema });
  }

  const sql = neon(env.DATABASE_URL);
  return drizzleHttp(sql, { schema });
}

export const db = createDb();
