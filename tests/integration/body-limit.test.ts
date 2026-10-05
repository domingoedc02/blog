import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { middleware } from '@/middleware';

/**
 * BLOG-5's AC names this file for "sends an oversized payload to each
 * route and asserts 413." As with middleware-admin-gate.test.ts, there is
 * no real `/api/admin/posts` or `/api/contact` route handler yet to send
 * a real buffered body to, so this exercises the middleware's
 * Content-Length-based fast-path check directly — the one place this
 * task's body cap actually runs ("before the body is fully
 * parsed/buffered"). A route handler that buffers a request without a
 * Content-Length header (e.g. chunked transfer) is NOT covered by this
 * check; flagging as a known gap for whichever task builds those
 * handlers (BLOG-29) to re-check buffered size server-side too.
 */
const SITE_URL = 'https://personal-blog.example';

function postWithContentLength(path: string, bytes: number): NextRequest {
  return new NextRequest(new URL(path, SITE_URL), {
    method: 'POST',
    headers: { 'content-length': String(bytes), cookie: '__Secure-authjs.session-token=x' },
  });
}

describe('body-size cap — 413 before the body would be parsed', () => {
  it('rejects a 1 MB + 1 byte /api/admin/posts body with 413 PAYLOAD_TOO_LARGE', async () => {
    const response = middleware(postWithContentLength('/api/admin/posts', 1024 * 1024 + 1));
    expect(response.status).toBe(413);
    const body = await response.json();
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('accepts a 1 MB /api/admin/posts body (at the boundary, not over it)', () => {
    const response = middleware(postWithContentLength('/api/admin/posts', 1024 * 1024));
    expect(response.status).not.toBe(413);
  });

  it('rejects a 200 KB + 1 byte /api/contact body with 413 PAYLOAD_TOO_LARGE', async () => {
    const response = middleware(postWithContentLength('/api/contact', 200 * 1024 + 1));
    expect(response.status).toBe(413);
  });

  it('accepts a 200 KB /api/contact body (at the boundary, not over it)', () => {
    const response = middleware(postWithContentLength('/api/contact', 200 * 1024));
    expect(response.status).not.toBe(413);
  });
});
