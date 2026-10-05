import 'server-only';

import { eq, sql } from 'drizzle-orm';

import { db } from '../client';
import { postTags, tags } from '../schema';

export type Tag = typeof tags.$inferSelect;

/** Lowercase, hyphenated — matches `research/domain-rules`'s free-form tag convention. */
export function normalizeTagName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Normalises `name`, then inserts it or returns the existing row —
 * "create on first use" (BLOG-36). Not transactional with any
 * `post_tags` write; the caller links the returned tag's `id` afterward.
 */
export async function upsertTagByName(rawName: string): Promise<Tag> {
  const name = normalizeTagName(rawName);
  if (!name) {
    throw new Error(`upsertTagByName: "${rawName}" normalizes to an empty tag name`);
  }

  const [row] = await db
    .insert(tags)
    .values({ name })
    .onConflictDoNothing({ target: tags.name })
    .returning();

  if (row) {
    return row;
  }

  const existing = await getTagByName(name);
  if (!existing) {
    throw new Error(`upsertTagByName: insert conflicted on "${name}" but it could not be re-read`);
  }
  return existing;
}

export async function getTagByName(name: string): Promise<Tag | null> {
  const [row] = await db.select().from(tags).where(eq(tags.name, name)).limit(1);
  return row ?? null;
}

export interface TagWithPostCount extends Tag {
  postCount: number;
}

/** Every tag with how many posts reference it, for the tag index page (BLOG-11). */
export async function listTagsWithPostCount(): Promise<TagWithPostCount[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      createdAt: tags.createdAt,
      postCount: sql<number>`count(${postTags.postId})::int`,
    })
    .from(tags)
    .leftJoin(postTags, eq(postTags.tagId, tags.id))
    .groupBy(tags.id, tags.name, tags.createdAt);

  return rows;
}

/** Prefix-match autocomplete (`GET /api/admin/tags`, spec/api). */
export async function searchTagsByPrefix(prefix: string, limit = 10): Promise<Tag[]> {
  const normalized = normalizeTagName(prefix);
  if (!normalized) {
    return [];
  }
  return db
    .select()
    .from(tags)
    .where(sql`${tags.name} LIKE ${normalized + '%'}`)
    .limit(limit);
}
