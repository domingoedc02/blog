import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { verifyAdminSession } from '@/lib/auth/session';
import { env } from '@/lib/env';
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
 * `/api/*` route (spec/architecture's request pipeline; spec/security's
 * Middleware & headers, Session & token handling, threats #3 and #9).
 * Public content pages get only the request id and security headers.
 *
 * Order: headers on every response → body-size cap (step 4) → session
 * (step 6) → Origin/CSRF (step 7, mutating methods only) → allow-list
 * re-check (step 8) → pass through.
 *
 * Session (BLOG-18): the Auth.js v5 JWT is decrypted and verified with
 * `AUTH_SECRET` — signature, expiry and the `provider`/`sub` claims — by
 * `verifyAdminSession()` (src/lib/auth/session.ts), the same helper the
 * per-handler re-check uses. A missing, tampered, expired or
 * wrong-secret token is unauthenticated: admin pages redirect to
 * `/admin/login`, `/api/admin/*` returns 401. A valid token whose identity
 * is no longer in `AUTHOR_ALLOWLIST` is forbidden: 403 on the API, and a
 * redirect to `/admin/login?error=AccessDenied` for pages. This replaces
 * BLOG-5's presence-only cookie check.
 *
 * The session is checked before the Origin check so an unauthenticated
 * cross-site request gets a generic 401, never a 403 that would confirm a
 * session exists. Middleware is the first gate, not the only one: every
 * `/api/admin/*` handler re-checks the session server-side (BLOG-29).
 */

const REQUEST_ID_HEADER = 'x-request-id';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const LOGIN_PATH = '/admin/login';

// Per spec/architecture's request-pipeline step 4. `/api/admin/upload`'s
// 8 MB cap is explicitly out of scope here (BLOG-5's Scope boundary
// note) — owned by lib/storage/upload.ts (BLOG-25).
// Values live in src/lib/security/body-limits.ts, shared with the
// Route Handler wrapper (src/lib/http/with-route.ts) so both layers agree.

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function applyHeaders(response: NextResponse, extra: readonly SecurityHeader[] = []): NextResponse {
  for (const header of buildSecurityHeaders(env.R2_PUBLIC_BASE_URL)) {
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

export async function middleware(request: NextRequest) {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
  const { pathname } = request.nextUrl;

  const isAdminPage = isUnder(pathname, '/admin');
  const isLoginPage = isUnder(pathname, LOGIN_PATH);
  const isAdminApi = isUnder(pathname, '/api/admin');
  const isAdminUpload = isUnder(pathname, '/api/admin/upload');
  const isContactApi = pathname === '/api/contact';
  const adminHeaders = isAdminPage || isAdminApi ? ADMIN_ONLY_HEADERS : [];

  const respond = (response: NextResponse) => {
    applyHeaders(response, adminHeaders);
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  };

  // --- Step 4: body-size cap (admin JSON + contact JSON routes only) ---
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

  // --- Step 6: session — Auth.js JWT verified (signature + expiry + claims) ---
  // The login page itself is exempt, or an unauthenticated visit would
  // redirect to itself forever.
  const gated = (isAdminPage && !isLoginPage) || isAdminApi;
  const session = gated
    ? await verifyAdminSession(request, {
        secret: env.AUTH_SECRET,
        siteUrl: env.SITE_URL,
        allowList: env.AUTHOR_ALLOWLIST,
      })
    : null;

  if (session?.status === 'unauthenticated') {
    if (isAdminApi) {
      return respond(jsonError(401, 'UNAUTHENTICATED', 'Sign in required.'));
    }
    return respond(NextResponse.redirect(new URL(LOGIN_PATH, request.url)));
  }

  // --- Step 7: Origin/CSRF check (mutating methods, /api/admin/* + /api/contact only) ---
  // Runs after the session check so an unauthenticated cross-site request
  // gets a generic 401, never a 403 that would confirm a session exists.
  if ((isAdminApi || isContactApi) && MUTATING_METHODS.has(request.method)) {
    try {
      assertSameOrigin(request, env.SITE_URL);
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return respond(jsonError(403, 'FORBIDDEN', error.message));
      }
      throw error;
    }
  }

  // --- Step 8: defensive allow-list re-check ---
  // A validly signed token whose identity is no longer allow-listed (the
  // allow-list changed after it was issued).
  if (session?.status === 'forbidden') {
    if (isAdminApi) {
      return respond(jsonError(403, 'FORBIDDEN', 'This account is not allowed here.'));
    }
    const login = new URL(LOGIN_PATH, request.url);
    login.searchParams.set('error', 'AccessDenied');
    return respond(NextResponse.redirect(login));
  }

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
