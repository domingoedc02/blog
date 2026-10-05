/**
 * Shared error classes, per spec/file-structure ("error classes + a
 * toErrorResponse() mapper, all in lib/errors.ts") and spec/conventions'
 * naming rule (PascalCase, suffixed `Error`).
 *
 * Seeded by BLOG-14 (`ValidationError`) and extended by BLOG-5
 * (`ForbiddenError`, `UnauthenticatedError`, `PayloadTooLargeError`) rather
 * than redefined elsewhere. BLOG-29 (API foundation) owns the full error
 * set this still lacks (`NotFoundError`, `ConflictError`, `GoneError`,
 * `RateLimitError`) and the `toErrorResponse()` HTTP-status mapper
 * described in spec/file-structure/spec/architecture step 11 — add to
 * this file rather than redefining any of the classes below.
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

/**
 * Thrown by {@link import("./security/origin-check").assertSameOrigin} on
 * an Origin/Referer mismatch (spec/security threat #3, CSRF on admin
 * mutations), and by src/middleware.ts's step-8 allow-list re-check on an
 * authenticated-but-not-allow-listed account. Maps to HTTP 403.
 */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Thrown when `/admin/*` or `/api/admin/*` is reached with no valid
 * session (spec/architecture request-pipeline step 6). Maps to HTTP 401.
 */
export class UnauthenticatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Thrown when a request body exceeds its route's configured cap
 * (spec/architecture request-pipeline step 4 — 1 MB admin JSON, 200 KB
 * `/api/contact`, 8 MB `/api/admin/upload`). Maps to HTTP 413.
 */
export class PayloadTooLargeError extends Error {
  readonly limitBytes: number;

  constructor(message: string, options: { limitBytes: number }) {
    super(message);
    this.name = 'PayloadTooLargeError';
    this.limitBytes = options.limitBytes;
  }
}
