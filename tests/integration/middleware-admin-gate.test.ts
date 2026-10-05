import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from '@/middleware';

import { mintSessionToken, sessionCookieHeader } from '../helpers/session';
import { TEST_GOOGLE_SUB, TEST_SITE_URL } from '../setup/test-env';

/**
 * BLOG-5 AC: `/admin` and `/api/admin/posts` with no cookie → redirect / 401.
 * BLOG-18 adds: the same paths with a real Auth.js session pass through.
 * No `/admin` page or `/api/admin/posts` handler exists yet, so this drives
 * the middleware directly; once those routes land, add a `next start` +
 * `fetch` version alongside it (tests/integration/headers.test.ts pattern).
 */
const SITE_URL = TEST_SITE_URL;

describe('admin route gate', () => {
  it('GET /admin with no session redirects to /admin/login', async () => {
    const response = await middleware(new NextRequest(new URL('/admin', SITE_URL)));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${SITE_URL}/admin/login`);
  });

  it('GET /api/admin/posts with no session returns 401 UNAUTHENTICATED', async () => {
    const response = await middleware(new NextRequest(new URL('/api/admin/posts', SITE_URL)));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' },
    });
  });

  it('GET /admin with a valid allow-listed session passes through', async () => {
    const cookie = sessionCookieHeader(
      await mintSessionToken({ sub: TEST_GOOGLE_SUB, provider: 'google' }),
    );
    const response = await middleware(
      new NextRequest(new URL('/admin', SITE_URL), { headers: { cookie } }),
    );
    expect(response.status).toBe(200);
  });
});
