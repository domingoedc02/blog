/**
 * The pure/DB-generic half of `search.ts`, split out specifically so it has
 * no `import 'server-only'` in its chain (unlike `./client`, which pulls in
 * `src/lib/env.ts`'s `server-only` guard). `scripts/backfill-search.ts`
 * runs under plain Node via `tsx`, outside Next's bundler, where the real
 * `server-only` package throws on import rather than no-opping — so the
 * script builds its own throwaway DB connection and calls
 * {@link refreshSearchVectorWith} directly, instead of importing
 * `src/lib/db/search.ts` (which `./search.ts` wraps for the app runtime).
 */
import { sql } from 'drizzle-orm';
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { postTags, posts, tags } from './schema';

type Schema = Record<string, unknown>;
export type AnyDb = NeonHttpDatabase<Schema> | NodePgDatabase<Schema>;

interface ProseMirrorNode {
  type?: string;
  text?: string;
  content?: ProseMirrorNode[];
}

/**
 * Recursively concatenates every text node's `text` value, depth-first,
 * separated by a single space — a plain-text approximation of the
 * document good enough for the 'C' (lowest) search weight.
 */
export function extractPlainText(doc: unknown): string {
  if (doc === null || doc === undefined || typeof doc !== 'object') {
    return '';
  }

  const node = doc as ProseMirrorNode;
  const parts: string[] = [];

  if (typeof node.text === 'string') {
    parts.push(node.text);
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const childText = extractPlainText(child);
      if (childText) {
        parts.push(childText);
      }
    }
  }

  return parts.join(' ').trim();
}

/** Space-joins a post's tag names into the single string fed to the 'B' weight. */
export function joinTagNames(tagNames: readonly string[]): string {
  return tagNames.join(' ');
}

/**
 * Recomputes `posts.search_vector` for one post, per spec/data-model:
 * `setweight(title, 'A') || setweight(tagNames, 'B') || setweight(body, 'C')`.
 * Takes the Drizzle database instance as a parameter rather than importing
 * `./client` directly, so both the app runtime (`./search.ts`) and
 * standalone scripts (their own throwaway connection) can share this exact
 * logic instead of two copies drifting apart.
 */
export async function refreshSearchVectorWith(database: AnyDb, postId: string): Promise<void> {
  const [post] = await database
    .select({ title: posts.title, contentJson: posts.contentJson })
    .from(posts)
    .where(sql`${posts.id} = ${postId}`)
    .limit(1);

  if (!post) {
    throw new Error(`refreshSearchVector: no post with id ${postId}`);
  }

  const tagRows = await database
    .select({ name: tags.name })
    .from(postTags)
    .innerJoin(tags, sql`${postTags.tagId} = ${tags.id}`)
    .where(sql`${postTags.postId} = ${postId}`);

  const tagNames = joinTagNames(tagRows.map((row) => row.name));
  const plainTextBody = extractPlainText(post.contentJson);

  await database.execute(sql`
    UPDATE posts
    SET search_vector =
      setweight(to_tsvector('english', ${post.title}), 'A') ||
      setweight(to_tsvector('english', ${tagNames}), 'B') ||
      setweight(to_tsvector('english', ${plainTextBody}), 'C')
    WHERE id = ${postId}
  `);
}
