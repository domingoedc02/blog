import { encode } from 'next-auth/jwt';

import { SESSION_MAX_AGE_SECONDS, sessionCookie } from '@/lib/auth/session';

import { TEST_AUTH_SECRET } from '../setup/test-env';

/** Mints a session JWT exactly as Auth.js issues it for this app (HTTPS cookie name as the salt). */
export async function mintSessionToken(
  claims: Record<string, unknown>,
  options: { secret?: string; maxAge?: number; secure?: boolean } = {},
): Promise<string> {
  const cookie = sessionCookie(options.secure ?? true);
  return encode({
    token: claims,
    secret: options.secret ?? TEST_AUTH_SECRET,
    salt: cookie.name,
    maxAge: options.maxAge ?? SESSION_MAX_AGE_SECONDS,
  });
}

export function sessionCookieHeader(token: string, secure = true): string {
  return `${sessionCookie(secure).name}=${token}`;
}
