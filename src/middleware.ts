import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { ForbiddenError } from '@/lib/errors';
import { ADMIN_JSON_BODY_LIMIT_BYTES, CONTACT_BODY_LIMIT_BYTES } from '@/lib/security/body-limits';
import {
  ADMIN_ONLY_HEADERS,
  buildSecurityHeaders,
  type SecurityHeader,
} from '@/lib/security/headers';
import { assertSameOrigin } from '@/lib/security/origin-check';

/**
 * The global security layer in front of every admin page and every
 * `/api/*` route (spec/architecture's request pipeline, spec/security's
 * Middleware & headers / Input validation / threat model #3 and #9).
 * Public content pages carry none of this — static/ISR HTML from the CDN
 * (decision/rendering-caching) — the `matcher` below still runs on them
 * for the request-id + header stamping, but every other check below
 * early-exits for a non-admin, non-API path.
 *
 * Order (per the issue's Technical design, matching spec/architecture's
 * numbered pipeline): headers set first → body-size check → admin session
 * gate → Origin/CSRF check (mutating methods only) → defensive allow-list
 * re-check (admin API only) → pass through. Session check runs BEFORE the
 * Origin check on admin routes so an unauthenticated cross-site request
 * gets a generic 401, never a 403 that would leak "there is a valid
 * session, just the wrong origin" to a prober (spec/security).
 *
 * KNOWN GAP, documented rather than silently skipped (BLOG-5's own
 * Dependencies section sanctions this): `src/lib/auth/allow-list.ts`'s
 * `isAllowListed()` is a complete, tested, real implementation, but
 * BLOG-18 (Auth hardening & audit logging) — which configures Auth.js
 * and hasn't landed yet — is what will give this middleware a *decoded*
 * session (provider + account id) to check it against. Until then:
 *   - The admin session gate below only checks that the Auth.js session
 *     COOKIE IS PRESENT (`hasSessionCookie`), not that its JWT is
 *     cryptographically valid.
 *   - The step-8 defensive allow-list re-check is not wired at all (there
 *     is no decoded identity yet to check) — see the TODO at its call site.
 * BLOG-18 should replace `hasSessionCookie` with `next-auth/jwt`'s
 * `getToken()` (returning the decoded token) and then call
 * `isAllowListed(token.provider, token.sub, process.env.AUTHOR_ALLOWLIST)`
 * where this file's TODO marks it.
 */

const REQUEST_ID_HEADER = 'x-request-id';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Per spec/architecture's request-pipeline step 4. `/api/admin/upload`'s
// 8 MB cap is explicitly out of scope here (this issue's Scope boundary
// note) — owned by lib/storage/upload.ts (BLOG-25).
// Values live in src/lib/security/body-limits.ts, shared with the
// Route Handler wrapper (src/lib/http/with-route.ts) so both layers agree.

// decision/auth's documented Auth.js v5 cookie name (Secure in
// production/preview over HTTPS, the non-`__Secure-` prefixed name in
// local HTTP dev).
const SESSION_COOKIE_NAMES = ['__Secure-authjs.session-token', 'authjs.session-token'];

function hasSessionCookie(request: NextRequest): boolean {
  return SESSION_COOKIE_NAMES.some((name) => {
    const value = request.cookies.get(name)?.value;
    return typeof value === 'string' && value.length > 0;
  });
}

function applyHeaders(response: NextResponse, extra: readonly SecurityHeader[] = []): NextResponse {
  for (const header of buildSecurityHeaders(process.env.R2_PUBLIC_BASE_URL)) {
    response.headers.set(header.key, header.value);
  }
  for (const header of extra) {
    response.headers.set(header.key, header.value);
  }
  return response;
}

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export function middleware(request: NextRequest) {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  const { pathname } = request.nextUrl;

  const isAdminPage = pathname.startsWith('/admin');
  const isAdminApi = pathname.startsWith('/api/admin');
  const isAdminUpload =
    pathname === '/api/admin/upload' || pathname.startsWith('/api/admin/upload/');
  const isContactApi = pathname === '/api/contact';
  const adminHeaders = isAdminPage || isAdminApi ? ADMIN_ONLY_HEADERS : [];

  const respond = (response: NextResponse) => {
    applyHeaders(response, adminHeaders);
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  };

  // --- Step: body-size cap (admin JSON + contact JSON routes only) ---
  if ((isAdminApi && !isAdminUpload) || isContactApi) {
    const limit = isContactApi ? CONTACT_BODY_LIMIT_BYTES : ADMIN_JSON_BODY_LIMIT_BYTES;
    const contentLength = request.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) > limit) {
      return respond(
        jsonError(
          413,
          'PAYLOAD_TOO_LARGE',
          `Request body exceeds the ${limit}-byte limit for this route.`,
        ),
      );
    }
  }

  // --- Step: admin session gate (/admin/* pages, /api/admin/* routes) ---
  if (isAdminPage || isAdminApi) {
    if (!hasSessionCookie(request)) {
      if (isAdminPage) {
        return respond(NextResponse.redirect(new URL('/admin/login', request.url)));
      }
      return respond(jsonError(401, 'UNAUTHENTICATED', 'Sign in required.'));
    }
  }

  // --- Step: Origin/CSRF check (mutating methods, /api/admin/* + /api/contact only) ---
  if ((isAdminApi || isContactApi) && MUTATING_METHODS.has(request.method)) {
    try {
      assertSameOrigin(request, process.env.SITE_URL ?? '');
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return respond(jsonError(403, 'FORBIDDEN', error.message));
      }
      throw error;
    }
  }

  // --- Step: defensive allow-list re-check (/api/admin/* only) ---
  // TODO(BLOG-18): once Auth.js is configured, decode the session here
  // (next-auth/jwt's getToken()) and call
  // isAllowListed(token.provider, token.sub, process.env.AUTHOR_ALLOWLIST),
  // responding 403 FORBIDDEN on a false — see this file's docblock.

  // --- Pass through ---
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  return respond(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  matcher: [
    /*
     * Run on every request except static assets and image optimization
     * files, which don't need a request id, the security headers, or any
     * of the checks above.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
