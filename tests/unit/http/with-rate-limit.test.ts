import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import type { RateLimitBackend } from '@/lib/security/rate-limit';

/**
 * BLOG-9: the real `withRateLimit` composition point (replaces BLOG-29's
 * always-429 stub). The limiter uses an injected in-memory backend, so no
 * Upstash; the wrapped route is a spy, so we can assert it is never
 * reached when the request is over its limit.
 */
vi.mock('@/lib/env', () => ({
  env: { UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' },
}));
vi.mock('@/lib/http/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { withRateLimit } = await import('@/lib/http/with-route');
const { createLimiter, rateLimitKey } = await import('@/lib/security/rate-limit');
const { logger } = await import('@/lib/http/logger');

function countingBackend(limit: number): RateLimitBackend {
  const seen = new Map<string, number>();
  return {
    async limit(identifier) {
      const count = (seen.get(identifier) ?? 0) + 1;
      seen.set(identifier, count);
      return {
        success: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        reset: Date.now() + 30_000,
      };
    },
  };
}

function post(ip: string): NextRequest {
  return new NextRequest('https://personal-blog.example/api/contact', {
    method: 'POST',
    headers: { 'x-forwarded-for': ip, 'x-request-id': 'req-123' },
  });
}

describe('withRateLimit (BLOG-9)', () => {
  it('calls the route while under the limit and returns 429 + Retry-After once over it, without calling the route', async () => {
    const route = vi.fn(async () => NextResponse.json({ ok: true }));
    const limiter = createLimiter('test-contact', 2, 600, { backend: countingBackend(2) });
    const POST = withRateLimit(route, {
      limiter,
      key: (request) => rateLimitKey(request, 'contact'),
    });

    expect((await POST(post('203.0.113.1'), undefined)).status).toBe(200);
    expect((await POST(post('203.0.113.1'), undefined)).status).toBe(200);

    const third = await POST(post('203.0.113.1'), undefined);
    expect(third.status).toBe(429);
    expect(third.headers.get('Retry-After')).toBe('30');
    expect(third.headers.get('x-request-id')).toBe('req-123');
    expect(await third.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', retryAfter: 30 },
    });

    expect(route).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'rate_limit.rejected',
        limiter: 'test-contact',
        status: 429,
      }),
    );
  });

  it('keys per client: one IP over the limit does not block another', async () => {
    const route = vi.fn(async () => NextResponse.json({ ok: true }));
    const POST = withRateLimit(route, {
      limiter: createLimiter('test-ip', 1, 60, { backend: countingBackend(1) }),
      key: (request) => rateLimitKey(request, 'search'),
    });

    expect((await POST(post('203.0.113.2'), undefined)).status).toBe(200);
    expect((await POST(post('203.0.113.2'), undefined)).status).toBe(429);
    expect((await POST(post('198.51.100.9'), undefined)).status).toBe(200);
  });

  it('maps a throwing key function (upload without a session) to 401 and never calls the route', async () => {
    const route = vi.fn(async () => NextResponse.json({ ok: true }));
    const POST = withRateLimit(route, {
      limiter: createLimiter('test-upload', 20, 60, { backend: countingBackend(20) }),
      key: (request) => rateLimitKey(request, 'upload', null),
    });

    const response = await POST(post('203.0.113.3'), undefined);
    expect(response.status).toBe(401);
    expect(route).not.toHaveBeenCalled();
  });

  it('still fails closed (429 on every call) when used without a limiter, like the original stub', async () => {
    const route = vi.fn(async () => NextResponse.json({ ok: true }));
    const POST = withRateLimit(route);

    const response = await POST(post('203.0.113.4'), undefined);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(route).not.toHaveBeenCalled();
  });
});
