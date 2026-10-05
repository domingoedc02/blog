/**
 * The one set of request body-size caps (spec/architecture request-pipeline
 * step 4), shared by both enforcement layers so they can never drift:
 * - `src/middleware.ts` (BLOG-5): the cheap Edge-level `Content-Length`
 *   pre-check.
 * - `src/lib/http/with-route.ts` / `body-limit.ts` (BLOG-29): the streamed
 *   byte count inside the Route Handler, which a chunked or lying
 *   `Content-Length` can't bypass.
 *
 * Binary units (MiB/KiB), matching the values BLOG-5 shipped first.
 * Edge-safe: no `server-only` import, no Node APIs.
 */

/** 1 MiB: admin JSON routes (posts, autosave, slug, ...). */
export const ADMIN_JSON_BODY_LIMIT_BYTES = 1 * 1024 * 1024;

/** 200 KiB: `/api/contact`. */
export const CONTACT_BODY_LIMIT_BYTES = 200 * 1024;

/** 8 MiB: `/api/admin/upload` (multipart). Enforced by the upload route (BLOG-25/BLOG-32). */
export const UPLOAD_BODY_LIMIT_BYTES = 8 * 1024 * 1024;
