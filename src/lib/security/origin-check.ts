import { ForbiddenError } from '@/lib/errors';

/**
 * CSRF/Origin check for state-changing admin and contact requests
 * (spec/security threat #3; spec/architecture request-pipeline step 7).
 * `spec/security` rejected a double-submit CSRF token in favour of
 * `SameSite=Lax` + this Origin check — Auth.js already issues its own
 * CSRF cookie for its sign-in/out POSTs, so a second token system would
 * add state for no extra protection against the one realistic attacker
 * model here (a cross-site auto-submitted form/fetch against the single
 * admin's cookie).
 *
 * Deliberately takes `siteUrl` as a parameter rather than importing
 * `src/lib/env.ts` — this module has no other env dependency, and callers
 * (src/middleware.ts) already have `SITE_URL` to hand; see
 * src/lib/content/schema.ts's docblock for the same reasoning applied to
 * the image-origin check.
 */
export function assertSameOrigin(request: Request, siteUrl: string): void {
  const requestOrigin = extractRequestOrigin(request);

  // Fail closed: a mutating request with neither Origin nor a parseable
  // Referer is rejected outright, never treated as same-origin by default.
  if (!requestOrigin) {
    throw new ForbiddenError(
      'Request is missing both an Origin and a Referer header; cross-site requests must be rejected.',
    );
  }

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(siteUrl).origin;
  } catch {
    // A misconfigured SITE_URL is this project's fault, not the caller's —
    // but it must still fail closed rather than silently accept anything.
    throw new ForbiddenError('SITE_URL is not configured correctly; cannot verify request origin.');
  }

  if (requestOrigin !== expectedOrigin) {
    throw new ForbiddenError(
      `Origin "${requestOrigin}" does not match the expected "${expectedOrigin}".`,
    );
  }
}

/**
 * Prefers the `Origin` header; falls back to deriving an origin from
 * `Referer` only when `Origin` is absent (some same-site requests omit
 * it) — never the other way around, and never both absent.
 */
function extractRequestOrigin(request: Request): string | undefined {
  const origin = request.headers.get('origin');
  if (origin) {
    return safeOrigin(origin);
  }
  const referer = request.headers.get('referer');
  if (referer) {
    return safeOrigin(referer);
  }
  return undefined;
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
