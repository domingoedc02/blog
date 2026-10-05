import type { Account, Profile } from 'next-auth';
import { decode } from 'next-auth/jwt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_MAX_AGE_SECONDS, sessionCookie } from '@/lib/auth/session';

import { mintSessionToken } from '../helpers/session';
import { TEST_AUTH_SECRET, TEST_GITHUB_ID, TEST_GOOGLE_SUB } from '../setup/test-env';

/**
 * BLOG-18 sign-in / sign-out acceptance criteria, driven through the same
 * callbacks src/lib/auth/config.ts hands to Auth.js. A full OAuth round
 * trip (provider consent → code exchange) needs real Google/GitHub apps and
 * is the manual check in spec/security's setup checklist; everything after
 * the provider returns a profile is exercised here.
 */

const auditCalls: { event: string; fields: Record<string, unknown> }[] = [];
vi.mock('@/lib/audit-log', () => ({
  auditLog: (event: string, fields: Record<string, unknown>) => {
    auditCalls.push({ event, fields });
  },
}));

const { buildAuthConfig } = await import('@/lib/auth/config');
const { handleJwt, handleSignIn, handleSignOut } = await import('@/lib/auth/callbacks');

function account(provider: 'google' | 'github', providerAccountId: string): Account {
  return { provider, providerAccountId, type: 'oidc' } as Account;
}

const request = new Request('https://personal-blog.example/api/auth/callback/google', {
  headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
});

beforeEach(() => {
  auditCalls.length = 0;
});

describe('signIn callback — allow-listed account', () => {
  it('Google: allows, and audit-logs auth.sign_in with provider, accountId and ip only', () => {
    const profile = { sub: TEST_GOOGLE_SUB, email: 'author@example.test' } as Profile;
    expect(handleSignIn({ account: account('google', TEST_GOOGLE_SUB), profile }, request)).toBe(
      true,
    );
    expect(auditCalls).toEqual([
      {
        event: 'auth.sign_in',
        fields: { provider: 'google', accountId: TEST_GOOGLE_SUB, ip: '203.0.113.7' },
      },
    ]);
    expect(JSON.stringify(auditCalls)).not.toContain('author@example.test');
  });

  it('GitHub: allows using the numeric profile.id', () => {
    const profile = {
      id: Number(TEST_GITHUB_ID),
      email: 'author@example.test',
    } as unknown as Profile;
    expect(handleSignIn({ account: account('github', TEST_GITHUB_ID), profile }, request)).toBe(
      true,
    );
    expect(auditCalls[0]?.fields.accountId).toBe(TEST_GITHUB_ID);
  });

  it('compares the account id, never the email', () => {
    const profile = { sub: '000000000000', email: 'author@example.test' } as Profile;
    expect(handleSignIn({ account: account('google', '000000000000'), profile }, request)).toBe(
      false,
    );
  });
});

describe('signIn callback — not allow-listed', () => {
  it.each([
    ['google', { sub: '111111111111111111' }],
    ['github', { id: 999 }],
  ] as const)('%s: rejects and audit-logs auth.sign_in_rejected', (provider, profile) => {
    const id = 'sub' in profile ? profile.sub : String(profile.id);
    expect(
      handleSignIn(
        { account: account(provider, id), profile: profile as unknown as Profile },
        request,
      ),
    ).toBe(false);
    expect(auditCalls).toEqual([
      { event: 'auth.sign_in_rejected', fields: { provider, accountId: id, ip: '203.0.113.7' } },
    ]);
  });

  it('rejects an unknown provider', () => {
    const rejected = handleSignIn(
      { account: { provider: 'twitter', providerAccountId: '1', type: 'oauth' } as Account },
      request,
    );
    expect(rejected).toBe(false);
    expect(auditCalls[0]?.event).toBe('auth.sign_in_rejected');
  });

  it('rejects when no account id can be read from the profile', () => {
    expect(
      handleSignIn(
        { account: { provider: 'google', type: 'oidc' } as Account, profile: {} },
        request,
      ),
    ).toBe(false);
  });

  it('Auth.js is configured to send a rejected sign-in to /admin/login (?error=AccessDenied)', () => {
    const config = buildAuthConfig(request);
    expect(config.pages).toEqual({ signIn: '/admin/login', error: '/admin/login' });
  });
});

describe('issued session', () => {
  it('jwt callback pins sub to the allow-listed account id and adds provider', () => {
    const token = handleJwt({
      token: { sub: 'auth-js-generated-id', email: 'author@example.test', name: 'A', picture: 'p' },
      account: account('google', TEST_GOOGLE_SUB),
      profile: { sub: TEST_GOOGLE_SUB } as Profile,
    });
    expect(token).toEqual({
      sub: TEST_GOOGLE_SUB,
      email: 'author@example.test',
      provider: 'google',
    });
  });

  it('jwt callback leaves an existing token unchanged on later requests', () => {
    const existing = { sub: TEST_GOOGLE_SUB, provider: 'google', email: 'a@example.test' };
    expect(handleJwt({ token: existing })).toBe(existing);
  });

  it('config: JWT strategy, 30-day maxAge, 24 h updateAge, secure session cookie', () => {
    const config = buildAuthConfig(request);
    expect(config.session).toEqual({ strategy: 'jwt', maxAge: 2_592_000, updateAge: 86_400 });
    expect(config.useSecureCookies).toBe(true);
    expect(config.cookies?.sessionToken).toEqual({
      name: '__Secure-authjs.session-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: true },
    });
    expect(config.providers.map((p) => (typeof p === 'function' ? p().id : p.id))).toEqual([
      'google',
      'github',
    ]);
  });

  it('a session JWT carries { sub, email, provider, iat, exp } with exp - iat = 30 days', async () => {
    const claims = handleJwt({
      token: { sub: 'x', email: 'author@example.test' },
      account: account('google', TEST_GOOGLE_SUB),
      profile: { sub: TEST_GOOGLE_SUB } as Profile,
    });
    const jwt = await mintSessionToken(claims);
    const decoded = await decode({
      token: jwt,
      secret: TEST_AUTH_SECRET,
      salt: sessionCookie(true).name,
    });
    expect(Object.keys(decoded ?? {}).sort()).toEqual(
      ['email', 'exp', 'iat', 'jti', 'provider', 'sub'].sort(),
    );
    expect(
      Math.abs((decoded?.exp ?? 0) - (decoded?.iat ?? 0) - SESSION_MAX_AGE_SECONDS),
    ).toBeLessThanOrEqual(1);
  });
});

describe('sign-out', () => {
  it('audit-logs auth.sign_out with provider and accountId', () => {
    handleSignOut({ sub: TEST_GOOGLE_SUB, provider: 'google', email: 'author@example.test' });
    expect(auditCalls).toEqual([
      { event: 'auth.sign_out', fields: { provider: 'google', accountId: TEST_GOOGLE_SUB } },
    ]);
  });

  it('still logs (with nulls) when there was no token', () => {
    handleSignOut(null);
    expect(auditCalls).toEqual([
      { event: 'auth.sign_out', fields: { provider: null, accountId: null } },
    ]);
  });
});
