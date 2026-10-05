import 'server-only';

import { and, desc, eq, isNull } from 'drizzle-orm';

import { db } from '../client';
import { posts } from '../schema';

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;

/**
 * Base CRUD primitives for `posts`. Deliberately thin: slug-redirect
 * orchestration on edit and the publish/trash/restore state machines
 * belong to the posts-domain stories that consume this layer (BLOG-22's
 * scope note), not here. Every function takes/returns plain data — no
 * HTTP/zod concerns, those live in the route handlers that call these.
 */

/** Inserts a new draft (or any status explicitly given) and returns it. */
export async function createPost(data: NewPost): Promise<Post> {
  const [row] = await db.insert(posts).values(data).returning();
  if (!row) {
    throw new Error('createPost: insert returned no row');
  }
  return row;
}

/** Fetches one post by id, including trashed/deleted ones, or null. */
export async function getPostById(id: string): Promise<Post | null> {
  const [row] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  return row ?? null;
}

/**
 * Fetches one *active* post (not deleted) by its *current* slug — the
 * public post-page lookup. Does not consider `post_slug_redirects` or
 * `gone_slugs`; the 301/410 fallback chain is the caller's job (see
 * spec/flows/user flow 2).
 */
export async function getActivePostBySlug(slug: string): Promise<Post | null> {
  const [row] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.slug, slug), isNull(posts.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Partial update by id. `updated_at` is bumped by the DB trigger, not here. */
export async function updatePost(
  id: string,
  patch: Partial<Omit<NewPost, 'id' | 'createdAt'>>,
): Promise<Post | null> {
  const [row] = await db.update(posts).set(patch).where(eq(posts.id, id)).returning();
  return row ?? null;
}

export interface ListPostsOptions {
  /** Filter by status; omit for both. */
  status?: 'draft' | 'published';
  /** Include trashed (deletedAt set) rows. Default false. */
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

/** Reverse-chronological list by `publishedAt`, the public listing's base query. */
export async function listPosts(options: ListPostsOptions = {}): Promise<Post[]> {
  const { status, includeDeleted = false, limit = 20, offset = 0 } = options;

  const conditions = [];
  if (status) {
    conditions.push(eq(posts.status, status));
  }
  if (!includeDeleted) {
    conditions.push(isNull(posts.deletedAt));
  }

  return db
    .select()
    .from(posts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(posts.publishedAt))
    .limit(limit)
    .offset(offset);
}

/** Trash (soft delete): sets `deletedAt`. Status is untouched. */
export async function softDeletePost(id: string): Promise<Post | null> {
  const [row] = await db
    .update(posts)
    .set({ deletedAt: new Date() })
    .where(eq(posts.id, id))
    .returning();
  return row ?? null;
}

/** Restore from Trash: clears `deletedAt`. Status is untouched. */
export async function restorePost(id: string): Promise<Post | null> {
  const [row] = await db.update(posts).set({ deletedAt: null }).where(eq(posts.id, id)).returning();
  return row ?? null;
}

/**
 * Hard-deletes the row (cascades `post_tags`/`post_slug_redirects`/`media`).
 * The purge cron (BLOG-21) is responsible for writing `gone_slugs` rows
 * *before* calling this — this primitive does not do that itself.
 */
export async function hardDeletePost(id: string): Promise<void> {
  await db.delete(posts).where(eq(posts.id, id));
}

/** Total post count, trashed included — used by the seed script's idempotency check. */
export async function countPosts(): Promise<number> {
  const rows = await db.select({ id: posts.id }).from(posts);
  return rows.length;
}
