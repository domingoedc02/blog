import { getToken } from 'next-auth/jwt';

import { isAuthProvider, matchesAllowList, type AuthProvider } from '@/lib/auth/allow-list';

/**
 * Session settings and the one shared admin-session check.
 *
 * Kept free of `next-auth`'s NextAuth() instance (providers, callbacks) so
 * it runs unchanged in the Edge middleware and in a Node route handler. The
 * caller passes in the secret, site URL and allow-list from src/lib/env.ts,
 * which keeps this function testable with any combination of the three.
 *
 * `verifyAdminSession()` is the helper both gates use — src/middleware.ts
 * (the first gate) and BLOG-29's per-handler re-check (`withAuth`) — so the
 * check is written once (team-lead's note on BLOG-18).
 */

/** spec/security "Session & token handling": 30 days, re-issued after 24 h. */
export const SESSION_MAX_AGE_SECONDS = 2_592_000;
export const SESSION_UPDATE_AGE_SECONDS = 86_400;

/** Secure (`__Secure-` prefixed, `Secure` flag) whenever the site is served over HTTPS. */
export function isSecureSiteUrl(siteUrl: string): boolean {
  try {
    return new URL(siteUrl).protocol === 'https:';
  } catch {
    // Unparseable SITE_URL: prefer the stricter cookie. env.ts rejects this at boot anyway.
    return true;
  }
}

/**
 * The session cookie, stated explicitly rather than left to Auth.js
 * defaults so the flags are reviewable and testable. These match Auth.js
 * v5's own secure-context defaults; the name doubles as the JWT salt.
 */
export function sessionCookie(secure: boolean) {
  return {
    name: `${secure ? '__Secure-' : ''}authjs.session-token`,
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      secure,
    },
  };
}

export interface AdminSessionConfig {
  secret: string;
  siteUrl: string;
  allowList: string | undefined;
}

export type AdminSessionResult =
  | { status: 'ok'; provider: AuthProvider; accountId: string }
  | { status: 'unauthenticated' }
  | { status: 'forbidden'; provider: AuthProvider; accountId: string };

/**
 * Verifies the Auth.js JWT session on a request: signature (decryption with
 * `AUTH_SECRET`), expiry, the claims this app issues, then the allow-list.
 *
 * - no cookie, a token that fails to decrypt (wrong/rotated secret,
 *   tampered), an expired token, or one missing `provider`/`sub` →
 *   `unauthenticated` (401 / redirect to login)
 * - a valid token whose identity is no longer on the allow-list →
 *   `forbidden` (403)
 */
export async function verifyAdminSession(
  request: Request,
  config: AdminSessionConfig,
): Promise<AdminSessionResult> {
  const secure = isSecureSiteUrl(config.siteUrl);
  const cookie = sessionCookie(secure);

  const token = await getToken({
    req: request,
    secret: config.secret,
    secureCookie: secure,
    cookieName: cookie.name,
    salt: cookie.name,
    // getToken() logs decode failures through this logger; a bad cookie is
    // an expected 401, not something to print a stack trace for.
    logger: { error: () => {}, warn: () => {}, debug: () => {} },
  });

  if (!token) {
    return { status: 'unauthenticated' };
  }

  const provider = token.provider;
  const accountId = token.sub;
  if (!isAuthProvider(provider) || typeof accountId !== 'string' || accountId.length === 0) {
    return { status: 'unauthenticated' };
  }

  if (!matchesAllowList(provider, accountId, config.allowList)) {
    return { status: 'forbidden', provider, accountId };
  }

  return { status: 'ok', provider, accountId };
}
