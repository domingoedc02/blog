import type { Account, Profile } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

import { auditLog } from '@/lib/audit-log';
import { isAllowListed, isAuthProvider, type AuthProvider } from '@/lib/auth/allow-list';

/**
 * Auth.js callbacks and events, kept apart from the NextAuth() call in
 * config.ts so they can be unit-tested without a running Auth.js.
 *
 * The `signIn` callback is the ONLY place identity is authorised
 * (decision/auth). It compares the provider's immutable account id —
 * Google `profile.sub`, GitHub `profile.id` — with `AUTHOR_ALLOWLIST`.
 * Email is deliberately not the key (spec/security).
 */

/** The provider's immutable account id, as a string. `undefined` when it can't be read. */
export function providerAccountId(
  provider: AuthProvider,
  profile: Profile | undefined,
  account: Account | null | undefined,
): string | undefined {
  const fromProfile = provider === 'google' ? profile?.sub : profile?.id;
  const id = fromProfile ?? account?.providerAccountId;
  if (typeof id === 'string' && id.length > 0) {
    return id;
  }
  if (typeof id === 'number' && Number.isFinite(id)) {
    // GitHub's profile.id is numeric.
    return String(id);
  }
  return undefined;
}

/** First hop of `x-forwarded-for` (Vercel sets it), else `x-real-ip`. Never the whole header. */
export function clientIp(request: Request | undefined): string | undefined {
  const forwarded = request?.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) {
    return first;
  }
  return request?.headers.get('x-real-ip')?.trim() || undefined;
}

export interface SignInParams {
  account: Account | null | undefined;
  profile?: Profile | undefined;
}

/**
 * Returns `true` to allow the sign-in, `false` to reject it. On `false`
 * Auth.js creates no session and redirects to `pages.error`
 * (`/admin/login?error=AccessDenied`).
 */
export function handleSignIn({ account, profile }: SignInParams, request?: Request): boolean {
  const provider = account?.provider;
  const ip = clientIp(request);

  if (!isAuthProvider(provider)) {
    auditLog('auth.sign_in_rejected', { provider: provider ?? null, accountId: null, ip });
    return false;
  }

  const accountId = providerAccountId(provider, profile, account);
  if (!accountId || !isAllowListed(provider, accountId)) {
    auditLog('auth.sign_in_rejected', { provider, accountId: accountId ?? null, ip });
    return false;
  }

  auditLog('auth.sign_in', { provider, accountId, ip });
  return true;
}

export interface JwtParams {
  token: JWT;
  account?: Account | null | undefined;
  profile?: Profile | undefined;
}

/**
 * On sign-in (when `account` is present) pins the claims the admin gate
 * reads: `sub` = the provider account id that passed the allow-list, and
 * `provider`. Later calls return the token unchanged. Claims issued:
 * `{ sub, email, provider, iat, exp }` (spec/security).
 */
export function handleJwt({ token, account, profile }: JwtParams): JWT {
  if (!account) {
    return token;
  }
  const provider = account.provider;
  if (!isAuthProvider(provider)) {
    return token;
  }
  const accountId = providerAccountId(provider, profile, account);
  const next: JWT = { ...token, provider };
  if (accountId) {
    next.sub = accountId;
  }
  // Only the claims spec/security lists; drop name/picture Auth.js adds by default.
  delete next.name;
  delete next.picture;
  return next;
}

export function handleSignOut(token: JWT | null | undefined): void {
  const provider = token?.provider;
  auditLog('auth.sign_out', {
    provider: isAuthProvider(provider) ? provider : null,
    accountId: typeof token?.sub === 'string' ? token.sub : null,
  });
}
