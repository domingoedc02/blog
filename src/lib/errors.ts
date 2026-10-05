import { ZodError } from 'zod';

/**
 * Shared error classes + the `toErrorResponse()` HTTP-status mapper, per
 * spec/file-structure ("error classes + a toErrorResponse() mapper, all in
 * lib/errors.ts") and spec/conventions' naming rule (PascalCase, suffixed
 * `Error`). The full status/code table is spec/api's Errors section —
 * every mapping below is copied from there, not re-derived.
 *
 * Seeded by BLOG-14 (`ValidationError`) and extended by BLOG-5
 * (`ForbiddenError`, `UnauthenticatedError`, `PayloadTooLargeError`). This
 * revision (BLOG-29) adds the rest of spec/api's error set
 * (`NotFoundError`, `ConflictError`, `GoneError`, `UnprocessableEntityError`,
 * `RateLimitError`, `UpstreamError`) and the `toErrorResponse()` mapper
 * (spec/architecture request-pipeline step 11) — every class below keeps
 * its *existing* constructor shape where one was already seeded; add to
 * this file rather than redefining any of them.
 *
 * `ValidationError` also now accepts an explicit `code` string in place of
 * the original `{ path, reason }` options object, so API routes can throw
 * a specific 400 code (`INVALID_SLUG`, `BOT_DETECTED`, ...) through the
 * same class content-validation already uses — both call sites work:
 *   - content validation: `new ValidationError(message, { path, reason })`
 *     — code defaults to `VALIDATION_ERROR`, `path`/`reason` carried as
 *     `details` for debugging.
 *   - API routes: `new ValidationError(message, "INVALID_SLUG")`.
 */

/** Discriminated shape every non-2xx API response body carries (spec/api). */
export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retryAfter?: number;
  };
}

export interface ErrorResponse {
  status: number;
  body: ErrorResponseBody;
  /** Extra response headers the error wants set (e.g. `Retry-After`). */
  headers?: Record<string, string>;
}

/**
 * Thrown by {@link import("./content/validate").validatePostContent} when a
 * `contentJson` payload contains a disallowed node type, mark type,
 * attribute, or URL scheme, *and* by any API route that needs to reject a
 * request body/query with a specific 400 `code` from spec/api's table.
 */
export class ValidationError extends Error {
  readonly code: string;
  readonly path?: string;
  readonly reason?: string;

  constructor(message: string, codeOrOptions?: string | { path: string; reason: string }) {
    super(message);
    this.name = 'ValidationError';
    if (typeof codeOrOptions === 'string') {
      this.code = codeOrOptions;
    } else {
      this.code = 'VALIDATION_ERROR';
      if (codeOrOptions) {
        this.path = codeOrOptions.path;
        this.reason = codeOrOptions.reason;
      }
    }
  }
}

/**
 * Thrown by {@link import("./security/origin-check").assertSameOrigin} on
 * an Origin/Referer mismatch (spec/security threat #3, CSRF on admin
 * mutations), and by src/middleware.ts's step-8 allow-list re-check on an
 * authenticated-but-not-allow-listed account (BLOG-5). Maps to 403
 * `FORBIDDEN`.
 */
export class ForbiddenError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Thrown when `/admin/*` or `/api/admin/*` is reached with no valid
 * session (spec/architecture request-pipeline step 6, BLOG-5). Maps to
 * 401 `UNAUTHENTICATED`.
 */
export class UnauthenticatedError extends Error {
  readonly code = 'UNAUTHENTICATED';
  constructor(message: string) {
    super(message);
    this.name = 'UnauthenticatedError';
  }
}

/**
 * Thrown when a request body exceeds its route's configured cap
 * (spec/architecture request-pipeline step 4 — 1 MB admin JSON, 200 KB
 * `/api/contact`, 8 MB `/api/admin/upload`; BLOG-5). Maps to 413
 * `PAYLOAD_TOO_LARGE`.
 */
export class PayloadTooLargeError extends Error {
  readonly code = 'PAYLOAD_TOO_LARGE';
  readonly limitBytes: number;

  constructor(message: string, options: { limitBytes: number }) {
    super(message);
    this.name = 'PayloadTooLargeError';
    this.limitBytes = options.limitBytes;
  }
}

/** Unknown id/slug → 404 `NOT_FOUND`. */
export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message = 'Not found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * A slug (or similar unique value) collides with another live row → 409.
 * Defaults to `SLUG_CONFLICT` (this task's only named 409 in spec/api), but
 * accepts an explicit `code` for a future non-slug conflict.
 */
export class ConflictError extends Error {
  readonly code: string;
  constructor(message = 'That value is already in use.', code = 'SLUG_CONFLICT') {
    super(message);
    this.name = 'ConflictError';
    this.code = code;
  }
}

/** Deleted/purged post or slug, or restoring an already-purged post → 410 `GONE`. */
export class GoneError extends Error {
  readonly code = 'GONE';
  constructor(message = 'This no longer exists.') {
    super(message);
    this.name = 'GoneError';
  }
}

/**
 * Content-sniff/decode failure on an upload → 422. Defaults to the generic
 * `UNPROCESSABLE_ENTITY`; the upload route (BLOG-25/BLOG-32) passes the
 * specific `UNPROCESSABLE_IMAGE` spec/api names.
 */
export class UnprocessableEntityError extends Error {
  readonly code: string;
  constructor(message = 'Could not process this request.', code = 'UNPROCESSABLE_ENTITY') {
    super(message);
    this.name = 'UnprocessableEntityError';
    this.code = code;
  }
}

/**
 * A rate limit was tripped → 429 `RATE_LIMITED`. `retryAfterSeconds` is
 * mandatory (not optional/defaulted) so a 429 can never leave this module
 * without a `Retry-After` value — spec/api requires every 429 to carry one.
 */
export class RateLimitError extends Error {
  readonly code = 'RATE_LIMITED';
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** An external vendor call failed (e.g. Resend send) → 502 `UPSTREAM_ERROR`. */
export class UpstreamError extends Error {
  readonly code = 'UPSTREAM_ERROR';
  constructor(message = 'An upstream service failed.') {
    super(message);
    this.name = 'UpstreamError';
  }
}

interface MappedError {
  status: number;
  code: string;
  message?: string;
  details?: Record<string, unknown>;
  retryAfterSeconds?: number;
}

function mapKnownError(error: unknown): MappedError | null {
  if (error instanceof ZodError) {
    // src/lib/http/with-route.ts's body/query schema.parse() throws this
    // directly — mapped here so every zod failure, anywhere, produces the
    // same VALIDATION_ERROR envelope spec/api fixes, not an ad hoc shape.
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed.',
      details: { fields: error.flatten() },
    };
  }
  if (error instanceof ValidationError) {
    const details =
      error.path !== undefined || error.reason !== undefined
        ? { path: error.path, reason: error.reason }
        : undefined;
    return { status: 400, code: error.code, ...(details ? { details } : {}) };
  }
  if (error instanceof UnauthenticatedError) return { status: 401, code: error.code };
  if (error instanceof ForbiddenError) return { status: 403, code: error.code };
  if (error instanceof NotFoundError) return { status: 404, code: error.code };
  if (error instanceof ConflictError) return { status: 409, code: error.code };
  if (error instanceof GoneError) return { status: 410, code: error.code };
  if (error instanceof PayloadTooLargeError) {
    return { status: 413, code: error.code, details: { limitBytes: error.limitBytes } };
  }
  if (error instanceof UnprocessableEntityError) return { status: 422, code: error.code };
  if (error instanceof RateLimitError) {
    return { status: 429, code: error.code, retryAfterSeconds: error.retryAfterSeconds };
  }
  if (error instanceof UpstreamError) return { status: 502, code: error.code };
  return null;
}

/**
 * Maps any thrown error to the exact `{status, body, headers}` spec/api's
 * Errors table fixes. An unmapped error becomes a generic `500
 * INTERNAL_ERROR` — this function never puts the real message/stack of an
 * unmapped error in the response; the caller (`src/lib/http/with-route.ts`)
 * is responsible for logging the original error server-side, keyed by
 * `requestId`.
 */
export function toErrorResponse(error: unknown): ErrorResponse {
  const mapped = mapKnownError(error);

  if (!mapped) {
    return {
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } },
    };
  }

  const message = mapped.message ?? (error instanceof Error ? error.message : 'Request failed.');
  const headers =
    mapped.retryAfterSeconds !== undefined
      ? { 'Retry-After': String(mapped.retryAfterSeconds) }
      : undefined;

  return {
    status: mapped.status,
    body: {
      error: {
        code: mapped.code,
        message,
        ...(mapped.details ? { details: mapped.details } : {}),
        ...(mapped.retryAfterSeconds !== undefined ? { retryAfter: mapped.retryAfterSeconds } : {}),
      },
    },
    ...(headers ? { headers } : {}),
  };
}
