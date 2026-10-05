/**
 * Idempotent local-dev seed: 5 tags, 3 posts (2 published, 1 draft) — the
 * exact counts `spec/setup` documents for `pnpm db:seed`. Running this
 * twice must not duplicate rows (BLOG-22's acceptance criteria).
 *
 * Like `migrate.ts`, this is standalone CLI tooling run via `tsx`, so it
 * builds its own `pg`-backed Drizzle connection from `process.env`
 * directly rather than importing the `server-only`-guarded
 * `src/lib/db/client.ts` (see the comment there and in `migrate.ts`).
 */
import { eq, isNull, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { postTags, posts, tags } from '../src/lib/db/schema';
import { refreshSearchVectorWith } from '../src/lib/db/search-core';

const SEED_TAGS = ['typescript', 'nextjs', 'postgres', 'career', 'devops'] as const;

interface SeedPost {
  slug: string;
  title: string;
  excerpt: string;
  contentJson: unknown;
  status: 'draft' | 'published';
  tags: readonly string[];
}

const SEED_POSTS: SeedPost[] = [
  {
    slug: 'why-postgres-is-still-the-right-default',
    title: 'Why Postgres is still the right default',
    excerpt: 'A durable, boring, extremely well-understood database beats a trendier one.',
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Postgres gives you full-text search, JSONB and strong consistency in one box.',
            },
          ],
        },
      ],
    },
    status: 'published',
    tags: ['postgres', 'devops'],
  },
  {
    slug: 'typescript-strict-mode-is-worth-it',
    title: 'TypeScript strict mode is worth it',
    excerpt: 'noUncheckedIndexedAccess catches the bugs eslint never will.',
    contentJson: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Strict mode moves a whole class of bugs to compile time.' },
          ],
        },
      ],
    },
    status: 'published',
    tags: ['typescript', 'nextjs'],
  },
  {
    slug: 'notes-on-switching-roles',
    title: 'Notes on switching roles (draft)',
    excerpt: 'Unfinished thoughts on moving from IC to a more cross-functional role.',
    contentJson: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Still drafting this one.' }] },
      ],
    },
    status: 'draft',
    tags: ['career'],
  },
];

function isLocalDatabaseUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to seed the database.');
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: isLocalDatabaseUrl(databaseUrl) ? false : { rejectUnauthorized: false },
  });
  const db = drizzle(pool, { schema: { posts, tags, postTags } });

  try {
    const tagIdByName = new Map<string, string>();
    for (const name of SEED_TAGS) {
      const [inserted] = await db.insert(tags).values({ name }).onConflictDoNothing().returning();
      const row = inserted ?? (await db.select().from(tags).where(eq(tags.name, name)).limit(1))[0];
      if (!row) {
        throw new Error(`seed: failed to create or find tag "${name}"`);
      }
      tagIdByName.set(name, row.id);
    }
    console.log(`Tags OK (${tagIdByName.size}/${SEED_TAGS.length}).`);

    let createdCount = 0;
    for (const seedPost of SEED_POSTS) {
      const [existing] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.slug, seedPost.slug), isNull(posts.deletedAt)))
        .limit(1);

      if (existing) {
        continue;
      }

      const [post] = await db
        .insert(posts)
        .values({
          slug: seedPost.slug,
          title: seedPost.title,
          excerpt: seedPost.excerpt,
          contentJson: seedPost.contentJson,
          status: seedPost.status,
          publishedAt: seedPost.status === 'published' ? new Date() : null,
        })
        .returning();

      if (!post) {
        throw new Error(`seed: failed to insert post "${seedPost.slug}"`);
      }

      for (const tagName of seedPost.tags) {
        const tagId = tagIdByName.get(tagName);
        if (!tagId) {
          throw new Error(`seed: post "${seedPost.slug}" references unknown tag "${tagName}"`);
        }
        await db.insert(postTags).values({ postId: post.id, tagId }).onConflictDoNothing();
      }

      await refreshSearchVectorWith(db, post.id);
      createdCount += 1;
    }

    console.log(
      `Posts: created ${createdCount}, skipped ${SEED_POSTS.length - createdCount} (already seeded).`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
