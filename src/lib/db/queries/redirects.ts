import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '../client';
import { postSlugRedirects } from '../schema';

export type PostSlugRedirect = typeof postSlugRedirects.$inferSelect;

/**
 * Records a retired slug so the old URL 301s to the current one
 * (BLOG-34). The caller (the future slug-edit route) is responsible for
 * checking `old_slug` doesn't collide with a live `posts.slug` first —
 * this primitive only performs the insert.
 */
export async function insertRedirect(postId: string, oldSlug: string): Promise<PostSlugRedirect> {
  const [row] = await db.insert(postSlugRedirects).values({ postId, oldSlug }).returning();
  if (!row) {
    throw new Error('insertRedirect: insert returned no row');
  }
  return row;
}

/** Looks up a retired slug — the second step of the public post-page's 301 fallback chain. */
export async function getRedirectByOldSlug(oldSlug: string): Promise<PostSlugRedirect | null> {
  const [row] = await db
    .select()
    .from(postSlugRedirects)
    .where(eq(postSlugRedirects.oldSlug, oldSlug))
    .limit(1);
  return row ?? null;
}

/** Every slug a post has ever retired, oldest first — used when purging (writes `gone_slugs`). */
export async function listRedirectsForPost(postId: string): Promise<PostSlugRedirect[]> {
  return db
    .select()
    .from(postSlugRedirects)
    .where(eq(postSlugRedirects.postId, postId))
    .orderBy(postSlugRedirects.createdAt);
}
