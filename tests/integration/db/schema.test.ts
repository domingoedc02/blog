import { randomUUID } from 'crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { db as Db } from '@/lib/db/client';
import type { posts as Posts } from '@/lib/db/schema';

import { migrateTestDb } from './migrate-test-db';
import { applyTestEnv } from './test-env';

// src/lib/env.ts validates the *entire* process.env at import time, so the
// full dummy env must be in place before any `@/lib/db/*` module (which
// pulls in `@/lib/env` via `./client`) is imported — hence the dynamic
// imports below instead of top-level ones. The `import type`s above are
// erased at compile time and cause no such eager runtime import.
applyTestEnv();

let db: typeof Db;
let posts: typeof Posts;

beforeAll(async () => {
  await migrateTestDb();
  ({ db } = await import('@/lib/db/client'));
  ({ posts } = await import('@/lib/db/schema'));
}, 30_000);

afterAll(async () => {
  // Clean up only the rows this file created.
  await db.execute(sql`DELETE FROM posts WHERE title = 'schema-test sentinel'`);
});

describe('migrations (BLOG-22 AC1)', () => {
  it('applies cleanly and enables pgcrypto and pg_trgm', async () => {
    const rows = await db.execute<{ extname: string }>(
      sql`SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto', 'pg_trgm')`,
    );
    const names = rows.rows.map((row) => row.extname).sort();
    expect(names).toEqual(['pg_trgm', 'pgcrypto']);
  });

  it('created every table from spec/data-model', async () => {
    const rows = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const tableNames = rows.rows.map((row) => row.table_name);
    expect(tableNames).toEqual(
      expect.arrayContaining([
        'posts',
        'post_slug_redirects',
        'tags',
        'post_tags',
        'media',
        'gone_slugs',
      ]),
    );
  });
});

describe('idx_posts_slug_active (BLOG-22 AC2)', () => {
  it('rejects a second active post with the same slug', async () => {
    const slug = `schema-test-${randomUUID()}`;

    await db.insert(posts).values({ slug, title: 'schema-test sentinel' });

    await expect(db.insert(posts).values({ slug, title: 'schema-test sentinel' })).rejects.toThrow(
      /duplicate key value violates unique constraint/,
    );
  });

  it('allows the same slug again once the first post is soft-deleted', async () => {
    const slug = `schema-test-${randomUUID()}`;

    const [first] = await db
      .insert(posts)
      .values({ slug, title: 'schema-test sentinel' })
      .returning();
    if (!first) throw new Error('insert returned no row');

    await db
      .update(posts)
      .set({ deletedAt: new Date() })
      .where(sql`${posts.id} = ${first.id}`);

    // The partial unique index only covers deleted_at IS NULL, so this must succeed.
    await expect(
      db.insert(posts).values({ slug, title: 'schema-test sentinel' }),
    ).resolves.not.toThrow();
  });

  it('enforces the slug format CHECK constraint', async () => {
    await expect(
      db.insert(posts).values({ slug: 'Not Valid Slug!', title: 'schema-test sentinel' }),
    ).rejects.toThrow(/posts_slug_format/);
  });

  it('bumps updated_at via the BEFORE UPDATE trigger', async () => {
    const slug = `schema-test-${randomUUID()}`;
    const [row] = await db
      .insert(posts)
      .values({ slug, title: 'schema-test sentinel' })
      .returning();
    if (!row) throw new Error('insert returned no row');

    await new Promise((resolve) => setTimeout(resolve, 10));
    const [updated] = await db
      .update(posts)
      .set({ title: 'schema-test sentinel (edited)' })
      .where(sql`${posts.id} = ${row.id}`)
      .returning();

    expect(updated?.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
  });
});
