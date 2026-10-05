import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { middleware } from '@/middleware';

import { mintSessionToken, sessionCookieHeader } from '../helpers/session';
import { TEST_GITHUB_ID, TEST_GOOGLE_SUB, TEST_SITE_URL } from '../setup/test-env';

const SITE_URL = TEST_SITE_URL;

let validCookie: string;
let notAllowListedCookie: string;
let wrongSecretCookie: string;
let expiredCookie: string;
let claimlessCookie: string;

beforeAll(async () => {
  validCookie = sessionCookieHeader(
    await mintSessionToken({ sub: TEST_GOOGLE_SUB, provider: 'google' }),
  );
  notAllowListedCookie = sessionCookieHeader(
    await mintSessionToken({ sub: '999999999', provider: 'github' }),
  );
  wrongSecretCookie = sessionCookieHeader(
    await mintSessionToken(
      { sub: TEST_GOOGLE_SUB, provider: 'google' },
      { secret: 'a-different-secret-the-server-does-not-hold' },
    ),
  );
  expiredCookie = sessionCookieHeader(
    await mintSessionToken({ sub: TEST_GOOGLE_SUB, provider: 'google' }, { maxAge: -60 }),
  );
  claimlessCookie = sessionCookieHeader(await mintSessionToken({ sub: TEST_GOOGLE_SUB }));
});

function makeRequest(
  path: string,
  options: { method?: string; headers?: Record<string, string>; cookie?: string } = {},
): NextRequest {
  const headers = { ...options.headers };
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  return new NextRequest(new URL(path, SITE_URL), {
    method: options.method ?? 'GET',
    headers,
  });
}

describe('middleware — security headers on every response (BLOG-5 AC)', () => {
  it('carries the exact header set, including both third-party CSP origins, on a public route', async () => {
    const response = await middleware(makeRequest('/'));
    const csp = response.headers.get('content-security-policy');
    expect(csp).toContain(
      "script-src 'self' https://cloud.umami.is https://challenges.cloudflare.com",
    );
    expect(csp).toContain(
      "connect-src 'self' https://cloud.umami.is https://challenges.cloudflare.com",
    );
    expect(response.headers.get('strict-transport-security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('does not carry Cache-Control: no-store on a public route', async () => {
    const response = await middleware(makeRequest('/'));
    expect(response.headers.get('cache-control')).not.toBe('no-store');
  });

  it('carries no-store + noindex on /admin/* even on a redirect', async () => {
    const response = await middleware(makeRequest('/admin'));
    expect(response.status).toBe(307);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('content-security-policy')).toContain('https://cloud.umami.is');
  });

  it('carries no-store + noindex on an unauthenticated /api/admin/* 401', async () => {
    const response = await middleware(makeRequest('/api/admin/posts'));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });
});

describe('middleware — admin session gate verifies the Auth.js JWT (BLOG-18)', () => {
  it('redirects a page request with no session to /admin/login', async () => {
    const response = await middleware(makeRequest('/admin/posts'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${SITE_URL}/admin/login`);
  });

  it('never gates /admin/login itself (no redirect loop)', async () => {
    const response = await middleware(makeRequest('/admin/login'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not treat /administrator as part of the admin zone', async () => {
    const response = await middleware(makeRequest('/administrator'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).not.toBe('no-store');
  });

  it('returns 401 UNAUTHENTICATED for an API request with no session', async () => {
    const response = await middleware(makeRequest('/api/admin/posts'));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
  });

  // The BLOG-5 presence-only check would have let every one of these through.
  for (const [label, cookie] of [
    ['an opaque, non-JWT cookie value', () => sessionCookieHeader('a-session-token-value')],
    ['a token signed with a different secret', () => wrongSecretCookie],
    ['an expired token', () => expiredCookie],
    ['a token without the provider claim', () => claimlessCookie],
  ] as const) {
    it(`rejects ${label}: 401 on the API, redirect on pages`, async () => {
      const api = await middleware(makeRequest('/api/admin/posts', { cookie: cookie() }));
      expect(api.status).toBe(401);
      const page = await middleware(makeRequest('/admin/posts', { cookie: cookie() }));
      expect(page.status).toBe(307);
      expect(page.headers.get('location')).toBe(`${SITE_URL}/admin/login`);
    });
  }

  it('passes a valid, allow-listed session through on pages and the API', async () => {
    const page = await middleware(makeRequest('/admin/posts', { cookie: validCookie }));
    expect(page.status).toBe(200);
    const api = await middleware(makeRequest('/api/admin/posts', { cookie: validCookie }));
    expect(api.status).toBe(200);
  });

  it('accepts a valid GitHub session too (providers are allow-listed independently)', async () => {
    const githubCookie = sessionCookieHeader(
      await mintSessionToken({ sub: TEST_GITHUB_ID, provider: 'github' }),
    );
    const response = await middleware(makeRequest('/api/admin/posts', { cookie: githubCookie }));
    expect(response.status).toBe(200);
  });

  it('returns 403 FORBIDDEN for a valid token whose identity is not allow-listed', async () => {
    const response = await middleware(
      makeRequest('/api/admin/posts', { cookie: notAllowListedCookie }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('FORBIDDEN');
  });

  it('sends a not-allow-listed page visit to /admin/login?error=AccessDenied', async () => {
    const response = await middleware(makeRequest('/admin', { cookie: notAllowListedCookie }));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${SITE_URL}/admin/login?error=AccessDenied`);
  });
});

describe('middleware — Origin/CSRF check (BLOG-5 AC)', () => {
  it('rejects a mutating admin request with a mismatched Origin as 403, with a valid session', async () => {
    const response = await middleware(
      makeRequest('/api/admin/posts', {
        method: 'POST',
        cookie: validCookie,
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('FORBIDDEN');
  });

  it('returns 401, not 403, when the session is missing AND the Origin is wrong', async () => {
    const response = await middleware(
      makeRequest('/api/admin/posts', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('lets a mutating admin request with a matching Origin and a valid session through', async () => {
    const response = await middleware(
      makeRequest('/api/admin/posts', {
        method: 'POST',
        cookie: validCookie,
        headers: { origin: SITE_URL, 'content-length': '10' },
      }),
    );
    expect(response.status).toBe(200);
  });

  it('rejects a POST to /api/contact with no Origin and no Referer (fail closed)', async () => {
    const response = await middleware(makeRequest('/api/contact', { method: 'POST' }));
    expect(response.status).toBe(403);
  });

  it('lets a GET with a mismatched Origin through (reads have no side effect to forge)', async () => {
    const response = await middleware(
      makeRequest('/api/admin/posts', {
        cookie: validCookie,
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe('middleware — body-size cap (BLOG-5 AC)', () => {
  it('rejects an oversized /api/admin/* JSON body with 413, before the session check', async () => {
    const response = await middleware(
      makeRequest('/api/admin/posts', {
        method: 'POST',
        headers: { 'content-length': String(1024 * 1024 + 1) },
      }),
    );
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects an oversized /api/contact JSON body with 413', async () => {
    const response = await middleware(
      makeRequest('/api/contact', {
        method: 'POST',
        headers: { 'content-length': String(200 * 1024 + 1) },
      }),
    );
    expect(response.status).toBe(413);
  });

  it('does not apply the 1 MB admin cap to /api/admin/upload (owned by the storage task)', async () => {
    const response = await middleware(
      makeRequest('/api/admin/upload', {
        method: 'POST',
        cookie: validCookie,
        headers: { origin: SITE_URL, 'content-length': String(2 * 1024 * 1024) },
      }),
    );
    expect(response.status).not.toBe(413);
  });
});
