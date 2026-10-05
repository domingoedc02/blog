import { randomUUID } from 'crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { db as Db } from '@/lib/db/client';
import type { posts as Posts } from '@/lib/db/schema';
import type { refreshSearchVector as RefreshSearchVector } from '@/lib/db/search';

import { migrateTestDb } from './migrate-test-db';
import { applyTestEnv } from './test-env';

applyTestEnv();

let db: typeof Db;
let posts: typeof Posts;
let refreshSearchVector: typeof RefreshSearchVector;

const createdPostIds: string[] = [];

beforeAll(async () => {
  await migrateTestDb();
  ({ db } = await import('@/lib/db/client'));
  ({ posts } = await import('@/lib/db/schema'));
  ({ refreshSearchVector } = await import('@/lib/db/search'));
}, 30_000);

afterAll(async () => {
  for (const id of createdPostIds) {
    await db.execute(sql`DELETE FROM posts WHERE id = ${id}`);
  }
});

describe('refreshSearchVector (BLOG-22 AC4)', () => {
  it('a title match ranks above a body-only match for the same query word', async () => {
    const needle = `zzyx${randomUUID().slice(0, 8)}`;

    const titleMatch = await db
      .insert(posts)
      .values({
        slug: `search-test-${randomUUID()}`,
        title: `A post about ${needle}`,
        contentJson: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'unrelated body text' }] },
          ],
        },
      })
      .returning();
    const bodyMatch = await db
      .insert(posts)
      .values({
        slug: `search-test-${randomUUID()}`,
        title: 'An unrelated title',
        contentJson: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: `this post mentions ${needle} in the body` }],
            },
          ],
        },
      })
      .returning();

    const titlePost = titleMatch[0];
    const bodyPost = bodyMatch[0];
    if (!titlePost || !bodyPost) throw new Error('insert returned no row');
    createdPostIds.push(titlePost.id, bodyPost.id);

    await refreshSearchVector(titlePost.id);
    await refreshSearchVector(bodyPost.id);

    const ranked = await db.execute<{ id: string; rank: number }>(sql`
      SELECT id, ts_rank(search_vector, to_tsquery('english', ${needle})) AS rank
      FROM posts
      WHERE id IN (${titlePost.id}, ${bodyPost.id})
      ORDER BY rank DESC
    `);

    expect(ranked.rows).toHaveLength(2);
    expect(ranked.rows[0]?.id).toBe(titlePost.id);
    expect(Number(ranked.rows[0]?.rank)).toBeGreaterThan(Number(ranked.rows[1]?.rank));
  });

  it('search_vector is non-null and includes a joined tag name (weight B)', async () => {
    const [post] = await db
      .insert(posts)
      .values({
        slug: `search-test-${randomUUID()}`,
        title: 'Plain title',
        contentJson: { type: 'doc', content: [] },
      })
      .returning();
    if (!post) throw new Error('insert returned no row');
    createdPostIds.push(post.id);

    const [tag] = await db
      .execute<{ id: string }>(
        sql`INSERT INTO tags (name) VALUES (${`tag-${randomUUID().slice(0, 8)}`}) RETURNING id`,
      )
      .then((r) => r.rows);
    if (!tag) throw new Error('tag insert returned no row');
    await db.execute(sql`INSERT INTO post_tags (post_id, tag_id) VALUES (${post.id}, ${tag.id})`);

    await refreshSearchVector(post.id);

    const [row] = await db
      .select({ searchVector: posts.searchVector })
      .from(posts)
      .where(sql`${posts.id} = ${post.id}`);

    expect(row?.searchVector).not.toBeNull();
  });
});
