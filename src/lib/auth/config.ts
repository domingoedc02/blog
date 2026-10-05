import NextAuth, { type NextAuthConfig } from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';

import { handleJwt, handleSignIn, handleSignOut } from '@/lib/auth/callbacks';
import {
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  isSecureSiteUrl,
  sessionCookie,
} from '@/lib/auth/session';
import { env } from '@/lib/env';

/**
 * Auth.js v5 configuration (decision/auth, spec/security "Authentication
 * flow" and "Session & token handling").
 *
 * - Providers: Google and GitHub only. No credentials provider, so there
 *   are no passwords and no password-reset flow anywhere.
 * - Session: JWT, no database session table. 30-day max age, rolled
 *   forward after 24 h. Revocation is rotating `AUTH_SECRET`, which
 *   invalidates every session at once (the documented incident response).
 * - Cookie: `__Secure-authjs.session-token` over HTTPS, `HttpOnly`,
 *   `Secure`, `SameSite=Lax`, `Path=/`.
 *
 * Lazy init (a function of the request) so the `signIn` callback can
 * record the client IP in the audit log.
 */
export function buildAuthConfig(request?: Request): NextAuthConfig {
  const secure = isSecureSiteUrl(env.SITE_URL);

  return {
    secret: env.AUTH_SECRET,
    providers: [
      Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET }),
      GitHub({ clientId: env.AUTH_GITHUB_ID, clientSecret: env.AUTH_GITHUB_SECRET }),
    ],
    session: {
      strategy: 'jwt',
      maxAge: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
    },
    jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
    useSecureCookies: secure,
    cookies: { sessionToken: sessionCookie(secure) },
    pages: {
      signIn: '/admin/login',
      error: '/admin/login',
    },
    callbacks: {
      signIn: ({ account, profile }) => handleSignIn({ account, profile }, request),
      jwt: ({ token, account, profile }) => handleJwt({ token, account, profile }),
    },
    events: {
      signOut: (message) => {
        handleSignOut('token' in message ? message.token : null);
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth((request) => buildAuthConfig(request));
