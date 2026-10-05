import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from '@/middleware';

/**
 * BLOG-5's AC names this file for "hits `/admin` and `/api/admin/posts`
 * with no cookie and asserts redirect/401 respectively." There is no real
 * `/admin` page or `/api/admin/posts` route handler yet (BLOG-18/BLOG-29,
 * neither landed) to run a true end-to-end HTTP test against, so this
 * exercises the same middleware logic directly — once those routes
 * exist, add a real `next start` + `fetch` version alongside this one
 * (the pattern tests/integration/headers.test.ts already uses for the
 * public side) rather than replacing it.
 */
const SITE_URL = 'https://personal-blog.example';

describe('admin route gate — no session cookie', () => {
  it('GET /admin redirects to /admin/login', () => {
    const response = middleware(new NextRequest(new URL('/admin', SITE_URL)));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(`${SITE_URL}/admin/login`);
  });

  it('GET /api/admin/posts returns 401 UNAUTHENTICATED', async () => {
    const response = middleware(new NextRequest(new URL('/api/admin/posts', SITE_URL)));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required.' } });
  });
});
