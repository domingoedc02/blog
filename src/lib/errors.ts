/**
 * Shared error classes, per spec/file-structure ("error classes + a
 * toErrorResponse() mapper, all in lib/errors.ts") and spec/conventions'
 * naming rule (PascalCase, suffixed `Error`).
 *
 * This file currently seeds just `ValidationError`, which
 * src/lib/content/validate.ts throws. The API-foundation task (BLOG-29)
 * owns the full error set (RateLimitError, etc.) and the `toErrorResponse()`
 * HTTP-status mapper described in spec/file-structure — add to this file
 * rather than redefining `ValidationError` elsewhere.
 */

/**
 * Thrown by {@link import("./content/validate").validatePostContent} when a
 * `contentJson` payload contains a disallowed node type, mark type,
 * attribute, or URL scheme. `path` is a dot/bracket path to the offending
 * node (e.g. `content[2].content[0]`), so a caller can report exactly
 * where the payload failed without re-walking the tree.
 */
export class ValidationError extends Error {
  readonly path: string;
  readonly reason: string;

  constructor(message: string, options: { path: string; reason: string }) {
    super(message);
    this.name = 'ValidationError';
    this.path = options.path;
    this.reason = options.reason;
  }
}
