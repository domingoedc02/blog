import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RateLimitError, UnauthenticatedError } from '@/lib/errors';

/**
 * BLOG-9 rate-limit module. `@upstash/ratelimit` is replaced by an
 * in-memory fake that honours the exact `slidingWindow(limit, window)`
 * config the module passes, so these tests prove both the numbers and the
 * enforcement without a network. `fake.mode` switches the fake into the
 * two failure modes the module must fail closed on: a thrown error, and
 * Upstash's own fail-open `{ success: true, reason: "timeout" }`.
 */
const fake = vi.hoisted(() => ({
  now: 1_700_000_000_000,
  mode: 'ok' as 'ok' | 'throw' | 'timeout',
  configs: new Map<string, { tokens: number; windowMs: number; timeout?: number | undefined }>(),
  hits: new Map<string, number[]>(),
}));

vi.mock('@/lib/env', () => ({
  env: {
    UPSTASH_REDIS_REST_URL: 'https://fake.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'fake-token',
  },
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor(readonly config: unknown) {}
  },
}));

vi.mock('@upstash/ratelimit', () => {
  function parseDuration(duration: string): number {
    const match = /^(\d+) s$/.exec(duration);
    if (!match) {
      throw new Error(`fake Ratelimit: unexpected duration "${duration}"`);
    }
    return Number(match[1]) * 1000;
  }

  class Ratelimit {
    private readonly tokens: number;
    private readonly windowMs: number;
    private readonly prefix: string;

    constructor(config: {
      limiter: { tokens: number; windowMs: number };
      prefix: string;
      timeout?: number;
    }) {
      this.tokens = config.limiter.tokens;
      this.windowMs = config.limiter.windowMs;
      this.prefix = config.prefix;
      fake.configs.set(config.prefix, { ...config.limiter, timeout: config.timeout });
    }

    static slidingWindow(tokens: number, window: string) {
      return { tokens, windowMs: parseDuration(window) };
    }

    async limit(identifier: string) {
      if (fake.mode === 'throw') {
        throw new Error('fetch failed: ECONNREFUSED');
      }
      if (fake.mode === 'timeout') {
        return {
          success: true,
          limit: this.tokens,
          remaining: this.tokens,
          reset: 0,
          reason: 'timeout',
        };
      }
      const key = `${this.prefix}:${identifier}`;
      const recent = (fake.hits.get(key) ?? []).filter((t) => t > fake.now - this.windowMs);
      const reset = (recent[0] ?? fake.now) + this.windowMs;
      if (recent.length >= this.tokens) {
        fake.hits.set(key, recent);
        return { success: false, limit: this.tokens, remaining: 0, reset };
      }
      recent.push(fake.now);
      fake.hits.set(key, recent);
      return { success: true, limit: this.tokens, remaining: this.tokens - recent.length, reset };
    }
  }

  return { Ratelimit };
});

const rateLimit = await import('@/lib/security/rate-limit');
const {
  authCallbackLimiter,
  contactDailyLimiter,
  contactLimiter,
  createLimiter,
  enforceRateLimit,
  rateLimitKey,
  searchLimiter,
  uploadLimiter,
} = rateLimit;

function requestWith(headers: Record<string, string> = {}): Request {
  return new Request('https://personal-blog.example/api/contact', { method: 'POST', headers });
}

beforeEach(() => {
  fake.now = 1_700_000_000_000;
  fake.mode = 'ok';
  fake.hits.clear();
  vi.spyOn(Date, 'now').mockImplementation(() => fake.now);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('per-route limiter numbers (spec/security + spec/api tables)', () => {
  it.each([
    [contactLimiter, 'contact', 5, 600],
    [contactDailyLimiter, 'contact-daily', 20, 86_400],
    [authCallbackLimiter, 'auth-callback', 10, 300],
    [searchLimiter, 'search', 30, 60],
    [uploadLimiter, 'upload', 20, 60],
  ] as const)('%s.name=%s is %i per %i s', async (limiter, name, limit, windowSeconds) => {
    expect(limiter.name).toBe(name);
    expect(limiter.limit).toBe(limit);
    expect(limiter.windowSeconds).toBe(windowSeconds);

    // And that is what actually reaches Upstash, as a sliding window.
    await limiter.check('ip:203.0.113.1');
    expect(fake.configs.get(`blog:rl:${name}`)).toMatchObject({
      tokens: limit,
      windowMs: windowSeconds * 1000,
      timeout: 2000,
    });
  });
});

describe('contactLimiter (BLOG-9 AC1)', () => {
  it('allows 5 requests in 10 minutes from one IP and denies the 6th with the window as Retry-After', async () => {
    const key = rateLimitKey(requestWith({ 'x-forwarded-for': '203.0.113.7' }), 'contact');

    for (let i = 0; i < 5; i += 1) {
      fake.now += 1000;
      expect((await contactLimiter.check(key)).success).toBe(true);
    }

    fake.now += 1000;
    const sixth = await contactLimiter.check(key);
    expect(sixth.success).toBe(false);
    expect(sixth.degraded).toBe(false);
    // First hit was 5 s before the 6th, so the window frees up in 595 s.
    expect(sixth.retryAfterSeconds).toBe(595);
  });

  it('does not let one IP exhaust another IP’s window', async () => {
    for (let i = 0; i < 5; i += 1) {
      await contactLimiter.check('ip:203.0.113.7');
    }
    expect((await contactLimiter.check('ip:203.0.113.7')).success).toBe(false);
    expect((await contactLimiter.check('ip:198.51.100.2')).success).toBe(true);
  });

  it('allows again once the 10-minute window has slid past', async () => {
    for (let i = 0; i < 5; i += 1) {
      await contactLimiter.check('ip:203.0.113.7');
    }
    fake.now += 10 * 60 * 1000 + 1;
    expect((await contactLimiter.check('ip:203.0.113.7')).success).toBe(true);
  });
});

describe('uploadLimiter (BLOG-9 AC2: 20 per minute per session)', () => {
  it('allows 20 uploads in a minute for one account and denies the 21st', async () => {
    const key = rateLimitKey(requestWith(), 'upload', { accountId: 'github:8341223' });

    for (let i = 0; i < 20; i += 1) {
      expect((await uploadLimiter.check(key)).success).toBe(true);
    }
    const twentyFirst = await uploadLimiter.check(key);
    expect(twentyFirst.success).toBe(false);
    expect(twentyFirst.retryAfterSeconds).toBe(60);
  });

  it('is a 1-minute window, not 10 minutes: the 21st succeeds 61 s later', async () => {
    const key = 'account:github:8341223';
    for (let i = 0; i < 20; i += 1) {
      await uploadLimiter.check(key);
    }
    fake.now += 61_000;
    expect((await uploadLimiter.check(key)).success).toBe(true);
  });
});

describe('fail closed when Upstash is unavailable (BLOG-9 AC5)', () => {
  it('falls back to half the limit in memory (never unlimited) and logs a warning', async () => {
    fake.mode = 'throw';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // contact: limit 5 -> fallback 2.
    const first = await contactLimiter.check('ip:203.0.113.9');
    const second = await contactLimiter.check('ip:203.0.113.9');
    const third = await contactLimiter.check('ip:203.0.113.9');

    expect(first).toMatchObject({ success: true, degraded: true, limit: 2 });
    expect(second).toMatchObject({ success: true, degraded: true });
    expect(third).toMatchObject({ success: false, degraded: true });
    expect(third.retryAfterSeconds).toBeGreaterThanOrEqual(1);

    expect(warn).toHaveBeenCalled();
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('rate_limit.degraded');
    expect(logged).toContain('ECONNREFUSED');
    // The identifier (an IP) is not written to the warn log.
    expect(logged).not.toContain('203.0.113.9');
  });

  it('treats Upstash’s own fail-open timeout response as a failure, not a pass', async () => {
    fake.mode = 'timeout';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await contactLimiter.check('ip:203.0.113.10'));
    }

    // Upstash said success:true five times; the module only let 2 through.
    expect(results.filter((r) => r.success)).toHaveLength(2);
    expect(results.every((r) => r.degraded)).toBe(true);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('timed out');
  });

  it('a limit of 1 still falls back to 1, never 0 or unlimited', async () => {
    fake.mode = 'throw';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tiny = createLimiter('tiny', 1, 60);
    expect((await tiny.check('x')).success).toBe(true);
    expect((await tiny.check('x')).success).toBe(false);
  });
});

describe('enforceRateLimit', () => {
  it('throws RateLimitError (code RATE_LIMITED, whole-second retryAfterSeconds) when denied', async () => {
    for (let i = 0; i < 5; i += 1) {
      await enforceRateLimit(contactLimiter, 'ip:203.0.113.11');
    }

    const error = await enforceRateLimit(contactLimiter, 'ip:203.0.113.11').catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RateLimitError);
    const rateLimitError = error as RateLimitError;
    expect(rateLimitError.code).toBe('RATE_LIMITED');
    expect(rateLimitError.retryAfterSeconds).toBe(600);
    expect(Number.isInteger(rateLimitError.retryAfterSeconds)).toBe(true);
  });

  it('returns the result when allowed', async () => {
    await expect(enforceRateLimit(searchLimiter, 'ip:203.0.113.12')).resolves.toMatchObject({
      success: true,
    });
  });
});

describe('rateLimitKey (BLOG-9 AC6)', () => {
  it('keys upload on the session account id, not x-forwarded-for', () => {
    const request = requestWith({ 'x-forwarded-for': '203.0.113.20' });
    const key = rateLimitKey(request, 'upload', { accountId: 'google:109283746502938475' });
    expect(key).toBe('account:google:109283746502938475');
    expect(key).not.toContain('203.0.113.20');
  });

  it('fails closed for upload without a session instead of falling back to IP', () => {
    const request = requestWith({ 'x-forwarded-for': '203.0.113.20' });
    expect(() => rateLimitKey(request, 'upload')).toThrow(UnauthenticatedError);
    expect(() => rateLimitKey(request, 'upload', null)).toThrow(UnauthenticatedError);
    expect(() => rateLimitKey(request, 'upload', { accountId: '  ' })).toThrow(
      UnauthenticatedError,
    );
  });

  it('keys anonymous routes on the first x-forwarded-for entry', () => {
    const request = requestWith({ 'x-forwarded-for': '203.0.113.30, 10.0.0.1, 10.0.0.2' });
    expect(rateLimitKey(request, 'contact')).toBe('ip:203.0.113.30');
    expect(rateLimitKey(request, 'search')).toBe('ip:203.0.113.30');
    expect(rateLimitKey(request, 'auth-callback')).toBe('ip:203.0.113.30');
  });

  it('falls back to x-real-ip, then a shared "unknown" bucket (never an unlimited bypass)', () => {
    expect(rateLimitKey(requestWith({ 'x-real-ip': '198.51.100.5' }), 'contact')).toBe(
      'ip:198.51.100.5',
    );
    expect(rateLimitKey(requestWith(), 'contact')).toBe('ip:unknown');
  });
});

describe('createLimiter validation', () => {
  it('rejects a non-positive limit or window', () => {
    expect(() => createLimiter('bad', 0, 60)).toThrow();
    expect(() => createLimiter('bad', 5, 0)).toThrow();
    expect(() => createLimiter('bad', 1.5, 60)).toThrow();
  });
});
