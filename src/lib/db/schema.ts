import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The single source of truth for the data model (spec/file-structure,
 * spec/data-model). `drizzle-kit generate` reads this file to produce the
 * migrations in `drizzle/*.sql` — never hand-edit a committed migration,
 * change this file and generate a new one instead.
 *
 * No `users`/`accounts`/`sessions` tables: Auth.js runs JWT-only sessions
 * (decision/auth), so there is nothing to persist for auth, and nothing in
 * this schema stores reader-identifying or contact-form data (see "Personal
 * data" in spec/data-model).
 */

/**
 * Postgres `tsvector`, maintained by application code
 * (`src/lib/db/search.ts`), not a `GENERATED` column — it must include
 * joined tag names, which a stored-generated column can't express.
 */
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * The single content entity. One row per post, including drafts. Trash is
 * not a `status` value — it's the independent `deletedAt` column, so a
 * draft or a published post can both be trashed (spec/data-model
 * "Lifecycle & retention").
 */
export const posts = pgTable(
  'posts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    excerpt: text('excerpt'),
    contentJson: jsonb('content_json').notNull().default({}),
    status: text('status').notNull().default('draft'),
    coverImageKey: text('cover_image_key'),
    coverImageAlt: text('cover_image_alt'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // Maintained by refreshSearchVector(); see src/lib/db/search.ts.
    searchVector: tsvector('search_vector'),
  },
  (table) => [
    // A trashed post's slug is NOT reserved — a new post may reuse it
    // before the trashed one is purged (spec/data-model "Keys &
    // constraints").
    uniqueIndex('idx_posts_slug_active')
      .on(table.slug)
      .where(sql`${table.deletedAt} is null`),
    index('idx_posts_status_published_at').on(table.status, table.publishedAt.desc()),
    index('idx_posts_deleted_at').on(table.deletedAt),
    index('idx_posts_search_vector').using('gin', table.searchVector),
    index('idx_posts_title_trgm').using('gin', sql`${table.title} gin_trgm_ops`),
    check('posts_slug_format', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('posts_status_valid', sql`${table.status} in ('draft', 'published')`),
  ],
);

/**
 * One row per retired slug, so an edited slug 301-redirects
 * (answer/post-lifecycle). A post's *current* slug lives only on
 * `posts.slug`.
 */
export const postSlugRedirects = pgTable(
  'post_slug_redirects',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    oldSlug: text('old_slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Unique globally — a retired slug can never collide with another
    // post's current or retired slug (spec/data-model "Keys & constraints").
    uniqueIndex('idx_post_slug_redirects_old_slug').on(table.oldSlug),
  ],
);

/** Free-form tags, not a fixed taxonomy (research/domain-rules). */
export const tags = pgTable(
  'tags',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    // Normalized lowercase/kebab-case at write time (see queries/tags.ts).
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('idx_tags_name').on(table.name)],
);

/** Many-to-many join between posts and tags. */
export const postTags = pgTable(
  'post_tags',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.postId, table.tagId] })],
);

/**
 * One row per uploaded, optimised image (decision/media-storage). A post
 * must exist (even as an empty draft) before its first upload.
 */
export const media = pgTable(
  'media',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    // posts/<postId>/<uuid>.webp — one-to-one with the actual R2 object.
    r2Key: text('r2_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    mimeType: text('mime_type').notNull(),
    altText: text('alt_text'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('idx_media_r2_key').on(table.r2Key)],
);

/**
 * Tombstones: keep the 410 contract alive after a post row is
 * hard-deleted by the purge job. No FK to `posts` — the row it pointed to
 * is gone by the time this is read; `postId` is kept for audit only
 * (spec/data-model "gone_slugs").
 */
export const goneSlugs = pgTable(
  'gone_slugs',
  {
    slug: text('slug').primaryKey(),
    postId: uuid('post_id'),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('gone_slugs_reason_valid', sql`${table.reason} in ('deleted', 'purged')`)],
);
