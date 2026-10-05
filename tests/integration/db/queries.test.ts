import { randomUUID } from 'crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { db as Db } from '@/lib/db/client';
import type * as PostsQ from '@/lib/db/queries/posts';
import type * as RedirectsQ from '@/lib/db/queries/redirects';
import type * as TagsQ from '@/lib/db/queries/tags';
import type { goneSlugs as GoneSlugs } from '@/lib/db/schema';

import { migrateTestDb } from './migrate-test-db';
import { applyTestEnv } from './test-env';

applyTestEnv();

type QueriesModule = typeof PostsQ & typeof TagsQ & typeof RedirectsQ;
let q: QueriesModule;
let db: typeof Db;
let goneSlugs: typeof GoneSlugs;

const createdPostIds: string[] = [];
const createdTagNames: string[] = [];

beforeAll(async () => {
  await migrateTestDb();
  const postsQ = await import('@/lib/db/queries/posts');
  const tagsQ = await import('@/lib/db/queries/tags');
  const redirectsQ = await import('@/lib/db/queries/redirects');
  q = { ...postsQ, ...tagsQ, ...redirectsQ };
  ({ db } = await import('@/lib/db/client'));
  ({ goneSlugs } = await import('@/lib/db/schema'));
}, 30_000);

afterAll(async () => {
  for (const id of createdPostIds) {
    await db.execute(sql`DELETE FROM posts WHERE id = ${id}`);
  }
  for (const name of createdTagNames) {
    await db.execute(sql`DELETE FROM tags WHERE name = ${name}`);
  }
});

function uniqueSlug(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

describe('queries/posts', () => {
  it('createPost / getPostById round-trip', async () => {
    const slug = uniqueSlug('post');
    const created = await q.createPost({ slug, title: 'Hello' });
    createdPostIds.push(created.id);

    const found = await q.getPostById(created.id);
    expect(found?.slug).toBe(slug);
    expect(found?.status).toBe('draft');
  });

  it('getActivePostBySlug finds an active post, not a trashed one', async () => {
    const slug = uniqueSlug('post');
    const created = await q.createPost({ slug, title: 'Hello' });
    createdPostIds.push(created.id);

    expect((await q.getActivePostBySlug(slug))?.id).toBe(created.id);

    await q.softDeletePost(created.id);
    expect(await q.getActivePostBySlug(slug)).toBeNull();

    await q.restorePost(created.id);
    expect((await q.getActivePostBySlug(slug))?.id).toBe(created.id);
  });

  it('updatePost applies a partial update without touching other fields', async () => {
    const slug = uniqueSlug('post');
    const created = await q.createPost({ slug, title: 'Original', excerpt: 'original excerpt' });
    createdPostIds.push(created.id);

    const updated = await q.updatePost(created.id, { title: 'Updated' });
    expect(updated?.title).toBe('Updated');
    expect(updated?.excerpt).toBe('original excerpt');
  });

  it('listPosts filters by status and excludes deleted by default', async () => {
    const published = await q.createPost({
      slug: uniqueSlug('post'),
      title: 'Published',
      status: 'published',
      publishedAt: new Date(),
    });
    const draft = await q.createPost({ slug: uniqueSlug('post'), title: 'Draft', status: 'draft' });
    const trashed = await q.createPost({
      slug: uniqueSlug('post'),
      title: 'Trashed',
      status: 'published',
      publishedAt: new Date(),
    });
    createdPostIds.push(published.id, draft.id, trashed.id);
    await q.softDeletePost(trashed.id);

    const publishedOnly = await q.listPosts({ status: 'published', limit: 100 });
    const ids = publishedOnly.map((p) => p.id);
    expect(ids).toContain(published.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(trashed.id);
  });

  it('hardDeletePost removes the row', async () => {
    const created = await q.createPost({ slug: uniqueSlug('post'), title: 'Doomed' });
    await q.hardDeletePost(created.id);
    expect(await q.getPostById(created.id)).toBeNull();
  });
});

describe('queries/tags', () => {
  it('upsertTagByName normalizes and is idempotent', async () => {
    const raw = `  Some Tag ${randomUUID().slice(0, 8)}  `;
    createdTagNames.push(
      raw
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    );

    const first = await q.upsertTagByName(raw);
    const second = await q.upsertTagByName(raw);

    expect(first.id).toBe(second.id);
    expect(first.name).toMatch(/^some-tag-/);
  });

  it('listTagsWithPostCount counts linked posts', async () => {
    const tagName = `count-test-${randomUUID().slice(0, 8)}`;
    createdTagNames.push(tagName);
    const tag = await q.upsertTagByName(tagName);

    const post = await q.createPost({ slug: uniqueSlug('post'), title: 'Tagged' });
    createdPostIds.push(post.id);
    await db.execute(sql`INSERT INTO post_tags (post_id, tag_id) VALUES (${post.id}, ${tag.id})`);

    const rows = await q.listTagsWithPostCount();
    const row = rows.find((r) => r.id === tag.id);
    expect(row?.postCount).toBe(1);
  });
});

describe('queries/redirects', () => {
  it('insertRedirect / getRedirectByOldSlug round-trip', async () => {
    const post = await q.createPost({ slug: uniqueSlug('post'), title: 'Renamed' });
    createdPostIds.push(post.id);
    const oldSlug = uniqueSlug('old');

    await q.insertRedirect(post.id, oldSlug);

    const found = await q.getRedirectByOldSlug(oldSlug);
    expect(found?.postId).toBe(post.id);
  });

  it('listRedirectsForPost returns every retired slug for a post', async () => {
    const post = await q.createPost({ slug: uniqueSlug('post'), title: 'Renamed twice' });
    createdPostIds.push(post.id);
    const first = uniqueSlug('old');
    const second = uniqueSlug('old');

    await q.insertRedirect(post.id, first);
    await q.insertRedirect(post.id, second);

    const rows = await q.listRedirectsForPost(post.id);
    expect(rows.map((r) => r.oldSlug).sort()).toEqual([first, second].sort());
  });
});

describe('purge sequence → gone_slugs (BLOG-22 AC3)', () => {
  it('a purged post and every retired slug resolve to a gone_slugs row with reason=purged', async () => {
    const currentSlug = uniqueSlug('post');
    const retiredSlug = uniqueSlug('old');

    const post = await q.createPost({ slug: currentSlug, title: 'To be purged' });
    await q.insertRedirect(post.id, retiredSlug);

    // Simulate the purge cron (BLOG-21): tombstone every slug the post
    // ever had, then hard-delete the row.
    await db.insert(goneSlugs).values([
      { slug: currentSlug, postId: post.id, reason: 'purged' },
      { slug: retiredSlug, postId: post.id, reason: 'purged' },
    ]);
    await q.hardDeletePost(post.id);

    const rows = await db
      .select()
      .from(goneSlugs)
      .where(sql`${goneSlugs.slug} IN (${currentSlug}, ${retiredSlug})`);

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.reason === 'purged')).toBe(true);
    // The post row itself is gone — redirects cascaded with it.
    expect(await q.getPostById(post.id)).toBeNull();
  });

  it('re-purging the same slug is idempotent (ON CONFLICT DO NOTHING)', async () => {
    const slug = uniqueSlug('post');
    await db.insert(goneSlugs).values({ slug, reason: 'purged' });
    await expect(
      db.insert(goneSlugs).values({ slug, reason: 'purged' }).onConflictDoNothing(),
    ).resolves.not.toThrow();
  });
});
