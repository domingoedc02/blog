import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { middleware } from '@/middleware';

const SITE_URL = 'https://personal-blog.example';
const ORIGINAL_SITE_URL = process.env.SITE_URL;

// src/middleware.ts reads SITE_URL directly from process.env for the
// Origin check (see src/lib/security/origin-check.ts's docblock for why
// it's dependency-injected rather than imported from src/lib/env.ts).
beforeAll(() => {
  process.env.SITE_URL = SITE_URL;
});
afterAll(() => {
  process.env.SITE_URL = ORIGINAL_SITE_URL;
});

function makeRequest(
  path: string,
  options: { method?: string; headers?: Record<string, string>; sessionCookie?: boolean } = {},
): NextRequest {
  const headers = { ...options.headers };
  if (options.sessionCookie) {
    headers.cookie = '__Secure-authjs.session-token=a-session-token-value';
  }
  return new NextRequest(new URL(path, SITE_URL), {
    method: options.method ?? 'GET',
    headers,
  });
}

describe('middleware — security headers on every response (BLOG-5 AC)', () => {
  it('carries the exact header set, including both third-party CSP origins, on a public route', () => {
    const response = middleware(makeRequest('/'));
    const csp = response.headers.get('content-security-policy');
    expect(csp).toContain('https://cloud.umami.is');
    expect(csp).toContain('https://challenges.cloudflare.com');
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

  it('does not carry Cache-Control: no-store on a public route', () => {
    const response = middleware(makeRequest('/'));
    expect(response.headers.get('cache-control')).not.toBe('no-store');
  });

  it('carries Cache-Control: no-store and X-Robots-Tag: noindex on /admin/* even on a redirect response', () => {
    const response = middleware(makeRequest('/admin'));
    expect(response.status).toBe(307); // redirect to /admin/login
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('content-security-policy')).toContain('https://cloud.umami.is');
  });

  it('carries Cache-Control: no-store and X-Robots-Tag: noindex on an unauthenticated /api/admin/* 401', () => {
    const response = middleware(makeRequest('/api/admin/posts'));
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
  });
});

describe('middleware — admin session gate (BLOG-5 AC)', () => {
  it('redirects a page request to /admin/login when no session cookie is present', async () => {
    const response = middleware(makeRequest('/admin/posts'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${SITE_URL}/admin/login`);
  });

  it('returns 401 UNAUTHENTICATED for an API request when no session cookie is present', async () => {
    const response = middleware(makeRequest('/api/admin/posts'));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('passes an admin page request through when a session cookie is present', () => {
    const response = middleware(makeRequest('/admin/posts', { sessionCookie: true }));
    expect(response.status).not.toBe(307);
  });
});

describe('middleware — Origin/CSRF check (BLOG-5 AC)', () => {
  it('rejects a mutating admin API request with a mismatched Origin as 403, with a valid session', async () => {
    const response = middleware(
      makeRequest('/api/admin/posts', {
        method: 'POST',
        sessionCookie: true,
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('returns 401, not 403, when both the session is missing AND the Origin is wrong (no information leak)', async () => {
    const response = middleware(
      makeRequest('/api/admin/posts', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(response.status).toBe(401);
  });

  it('allows a mutating admin API request with a matching Origin and a valid session through', () => {
    const response = middleware(
      makeRequest('/api/admin/posts', {
        method: 'POST',
        sessionCookie: true,
        headers: { origin: SITE_URL, 'content-length': '10' },
      }),
    );
    expect(response.status).not.toBe(403);
    expect(response.status).not.toBe(401);
  });

  it('rejects a POST to /api/contact with no Origin and no Referer (fail closed)', async () => {
    const response = middleware(makeRequest('/api/contact', { method: 'POST' }));
    expect(response.status).toBe(403);
  });

  it('allows a GET to /api/admin/posts with a mismatched Origin through (reads have no side effect to forge)', () => {
    const response = middleware(
      makeRequest('/api/admin/posts', {
        sessionCookie: true,
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(response.status).not.toBe(403);
  });
});

describe('middleware — body-size cap (BLOG-5 AC)', () => {
  it('rejects an oversized /api/admin/* JSON body with 413, before the session check', async () => {
    const response = middleware(
      makeRequest('/api/admin/posts', {
        method: 'POST',
        headers: { 'content-length': String(1024 * 1024 + 1) },
      }),
    );
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects an oversized /api/contact JSON body with 413', async () => {
    const response = middleware(
      makeRequest('/api/contact', {
        method: 'POST',
        headers: { 'content-length': String(200 * 1024 + 1) },
      }),
    );
    expect(response.status).toBe(413);
  });

  it('does not apply the 1 MB admin cap to /api/admin/upload (owned by the storage task)', () => {
    const response = middleware(
      makeRequest('/api/admin/upload', {
        method: 'POST',
        sessionCookie: true,
        headers: { origin: SITE_URL, 'content-length': String(2 * 1024 * 1024) },
      }),
    );
    expect(response.status).not.toBe(413);
  });

  it('allows a body under the cap through', () => {
    const response = middleware(
      makeRequest('/api/contact', {
        method: 'POST',
        headers: { 'content-length': '100', origin: SITE_URL },
      }),
    );
    expect(response.status).not.toBe(413);
  });
});
