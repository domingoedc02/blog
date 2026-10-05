import 'server-only';

import { db } from './client';
import { extractPlainText, joinTagNames, refreshSearchVectorWith } from './search-core';

export { extractPlainText, joinTagNames };

/**
 * App-runtime entry point: recomputes `posts.search_vector` for one post
 * using the real app `db` (Neon in prod/preview, local Postgres in dev —
 * see `./client`). See `./search-core` for the actual implementation,
 * shared with `scripts/backfill-search.ts`.
 */
export async function refreshSearchVector(postId: string): Promise<void> {
  return refreshSearchVectorWith(db, postId);
}
