import { z } from 'zod';

/**
 * Shape stubs for the future admin post routes (spec/api). `contentJson`
 * is intentionally `z.unknown()` here — its actual ProseMirror-document
 * shape is validated by `src/lib/content/validate.ts`'s
 * `validatePostContent` (BLOG-14), not re-specified as a zod schema; a
 * route composes both: this schema for the envelope's other fields,
 * `validatePostContent` for `contentJson` itself.
 */

/** `POST /api/admin/posts` — create a draft from just a title. */
export const createPostSchema = z.object({
  title: z.string().min(1),
});

/** `PATCH /api/admin/posts/:id` — partial update, every field optional. */
export const updatePostSchema = z.object({
  title: z.string().min(1).optional(),
  excerpt: z.string().optional(),
  contentJson: z.unknown().optional(),
  coverImageKey: z.string().optional(),
  coverImageAlt: z.string().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

/**
 * `POST /api/admin/posts/:id/autosave` — never `slug`, `tags`, or publish
 * fields (spec/api): a strictly narrower subset of {@link updatePostSchema}.
 */
export const autosavePostSchema = z.object({
  title: z.string().min(1).optional(),
  excerpt: z.string().optional(),
  contentJson: z.unknown().optional(),
});

/** `PATCH /api/admin/posts/:id/slug` — kebab-case, matching the DB's `CHECK`. */
export const slugSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug must be lowercase, hyphen-separated.'),
});

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
export type AutosavePostInput = z.infer<typeof autosavePostSchema>;
export type SlugInput = z.infer<typeof slugSchema>;
