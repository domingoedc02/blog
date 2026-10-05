import { decode } from 'next-auth/jwt';
import { describe, expect, it } from 'vitest';

import {
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  isSecureSiteUrl,
  sessionCookie,
  verifyAdminSession,
} from '@/lib/auth/session';

import { mintSessionToken, sessionCookieHeader } from '../helpers/session';
import { TEST_AUTH_SECRET, TEST_GOOGLE_SUB, TEST_SITE_URL } from '../setup/test-env';

const CONFIG = {
  secret: TEST_AUTH_SECRET,
  siteUrl: TEST_SITE_URL,
  allowList: `google:${TEST_GOOGLE_SUB}`,
};

function requestWithCookie(cookie?: string): Request {
  return new Request(`${TEST_SITE_URL}/api/admin/posts`, {
    headers: cookie ? { cookie } : {},
  });
}

describe('session settings (spec/security "Session & token handling")', () => {
  it('uses a 30-day max age rolled forward after 24 h', () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(2_592_000);
    expect(SESSION_UPDATE_AGE_SECONDS).toBe(86_400);
  });

  it('names the cookie __Secure-authjs.session-token over HTTPS with HttpOnly, Secure, SameSite=Lax', () => {
    expect(isSecureSiteUrl('https://personal-blog.example')).toBe(true);
    expect(sessionCookie(true)).toEqual({
      name: '__Secure-authjs.session-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: true },
    });
  });

  it('drops the __Secure- prefix and Secure flag only for plain-HTTP local dev', () => {
    expect(isSecureSiteUrl('http://localhost:3000')).toBe(false);
    expect(sessionCookie(false).name).toBe('authjs.session-token');
    expect(sessionCookie(false).options.secure).toBe(false);
    expect(sessionCookie(false).options.httpOnly).toBe(true);
  });

  it('issues a JWT whose exp is maxAge (30 days) after iat', async () => {
    const token = await mintSessionToken({ sub: TEST_GOOGLE_SUB, provider: 'google' });
    const claims = await decode({
      token,
      secret: TEST_AUTH_SECRET,
      salt: sessionCookie(true).name,
    });
    expect(claims?.exp).toBeTypeOf('number');
    expect(claims?.iat).toBeTypeOf('number');
    // iat and exp come from two clock reads inside Auth.js's encode(); allow 1 s of rounding.
    expect(
      Math.abs((claims?.exp ?? 0) - (claims?.iat ?? 0) - SESSION_MAX_AGE_SECONDS),
    ).toBeLessThanOrEqual(1);
  });
});

describe('verifyAdminSession — the shared admin gate', () => {
  it('is unauthenticated with no cookie', async () => {
    expect(await verifyAdminSession(requestWithCookie(), CONFIG)).toEqual({
      status: 'unauthenticated',
    });
  });

  it('is ok for a valid, allow-listed token', async () => {
    const token = await mintSessionToken({ sub: TEST_GOOGLE_SUB, provider: 'google' });
    expect(await verifyAdminSession(requestWithCookie(sessionCookieHeader(token)), CONFIG)).toEqual(
      { status: 'ok', provider: 'google', accountId: TEST_GOOGLE_SUB },
    );
  });

  it('rotating AUTH_SECRET invalidates a previously issued token (incident response)', async () => {
    const issuedUnderOldSecret = await mintSessionToken(
      { sub: TEST_GOOGLE_SUB, provider: 'google' },
      { secret: 'the-secret-before-rotation' },
    );
    const result = await verifyAdminSession(
      requestWithCookie(sessionCookieHeader(issuedUnderOldSecret)),
      { ...CONFIG, secret: 'the-secret-after-rotation' },
    );
    expect(result).toEqual({ status: 'unauthenticated' });
  });

  it('is unauthenticated for an expired token', async () => {
    // Auth.js decodes with a 15 s clock tolerance, so expire it well past that.
    const token = await mintSessionToken(
      { sub: TEST_GOOGLE_SUB, provider: 'google' },
      { maxAge: -60 },
    );
    expect(
      (await verifyAdminSession(requestWithCookie(sessionCookieHeader(token)), CONFIG)).status,
    ).toBe('unauthenticated');
  });

  it('ignores a token set under the non-secure cookie name on an HTTPS site', async () => {
    const token = await mintSessionToken(
      { sub: TEST_GOOGLE_SUB, provider: 'google' },
      { secure: false },
    );
    const result = await verifyAdminSession(
      requestWithCookie(sessionCookieHeader(token, false)),
      CONFIG,
    );
    expect(result.status).toBe('unauthenticated');
  });

  it('is forbidden when the token is valid but the identity is no longer allow-listed', async () => {
    const token = await mintSessionToken({ sub: TEST_GOOGLE_SUB, provider: 'google' });
    const result = await verifyAdminSession(requestWithCookie(sessionCookieHeader(token)), {
      ...CONFIG,
      allowList: 'github:8341223',
    });
    expect(result).toEqual({ status: 'forbidden', provider: 'google', accountId: TEST_GOOGLE_SUB });
  });

  it('is forbidden for every valid token when the allow-list is empty (fail closed)', async () => {
    const token = await mintSessionToken({ sub: TEST_GOOGLE_SUB, provider: 'google' });
    const result = await verifyAdminSession(requestWithCookie(sessionCookieHeader(token)), {
      ...CONFIG,
      allowList: '',
    });
    expect(result.status).toBe('forbidden');
  });
});
