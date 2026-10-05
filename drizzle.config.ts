import type { Config } from 'drizzle-kit';

/**
 * Placeholder drizzle-kit config. `src/lib/db/schema.ts` doesn't exist yet
 * — it's created by the database-layer task (BLOG-22), which is the single
 * source of truth for the data model (spec/file-structure). This file only
 * points `drizzle-kit generate`/`migrate` at the right path and output
 * directory so BLOG-22 doesn't have to invent the wiring from scratch.
 */
export default {
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
} satisfies Config;
