import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { env } from '@/lib/env';
import { RateLimitError, UnauthenticatedError } from '@/lib/errors';

/**
 * Sliding-window rate limiting for every abuse-exposed route (BLOG-9;
 * spec/security "Rate limiting & abuse"; spec/api "Idempotency & rate
 * limits"; decision/contact-form). One shared Upstash REST client (no
 * persistent TCP connection, so it suits Vercel's function model) and one
 * named limiter per route, so the exact numbers live in this one file
 * security-eng can audit, not scattered across route handlers.
 *
 * CALL-SITE CONTRACT (decision/contact-form): on `/api/contact` the rate
 * limit is checked FIRST, before `verifyTurnstile()` and before any
 * DB/Resend call. A request over its limit must never cost us a
 * Cloudflare round-trip or an email:
 *
 *   await enforceRateLimit(contactLimiter, rateLimitKey(request, 'contact'));
 *   await enforceRateLimit(contactDailyLimiter, rateLimitKey(request, 'contact'));
 *   if (!(await verifyTurnstile(token, clientIp(request)))) { ...reject... }
 *   // only now: validate body, send via Resend
 *
 * FAIL CLOSED: if Upstash is unreachable, errors, or times out, the
 * limiter never "allows everything". It falls back to a conservative
 * in-memory counter for this function instance (half the route's limit,
 * minimum 1, same window) and logs a warning so a persistent Upstash
 * outage is visible in Vercel's logs. NOTE: `@upstash/ratelimit` itself
 * fails OPEN by default (after `timeout`, 5s, it returns
 * `success: true, reason: "timeout"`), so that response is treated as a
 * backend failure here, not as a pass.
 */

/** The routes with an abuse limit, per spec/security's Rate limiting table. */
export type RateLimitScope = 'contact' | 'search' | 'auth-callback' | 'upload';

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  /** Unix epoch milliseconds when the caller's window frees up. */
  reset: number;
  /** Whole seconds until a retry can succeed (>= 1 when denied, 0 when allowed). */
  retryAfterSeconds: number;
  /** True when the decision came from the in-memory fail-closed fallback. */
  degraded: boolean;
}

/** The minimal surface of `Ratelimit` this module relies on (injectable for tests). */
export interface RateLimitBackend {
  limit(identifier: string): Promise<{
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
    reason?: string;
  }>;
}

export interface Limiter {
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
  check(identifier: string): Promise<RateLimitResult>;
}

export interface CreateLimiterOptions {
  /** Override the Upstash-backed backend (tests only). */
  backend?: RateLimitBackend;
  /** Clock override for the fallback path (tests only). */
  now?: () => number;
}

const KEY_PREFIX = 'blog:rl';

let sharedRedis: Redis | undefined;

function getRedis(): Redis {
  sharedRedis ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return sharedRedis;
}

function upstashBackend(name: string, limit: number, windowSeconds: number): RateLimitBackend {
  let ratelimit: Ratelimit | undefined;
  return {
    limit(identifier) {
      // Built lazily so importing this module never opens a client
      // (keeps `next build` and unrelated imports side-effect free).
      ratelimit ??= new Ratelimit({
        redis: getRedis(),
        limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
        prefix: `${KEY_PREFIX}:${name}`,
        analytics: false,
        // 2s, not the 5s default: a slow Upstash should degrade to the
        // conservative fallback quickly instead of holding the request.
        timeout: 2000,
      });
      return ratelimit.limit(identifier);
    },
  };
}

function toRetryAfterSeconds(reset: number, now: number): number {
  return Math.max(1, Math.ceil((reset - now) / 1000));
}

/**
 * Builds a named sliding-window limiter: `limit` requests per
 * `windowSeconds`, keyed by whatever identifier the caller passes
 * (see {@link rateLimitKey}).
 */
export function createLimiter(
  name: string,
  limit: number,
  windowSeconds: number,
  options: CreateLimiterOptions = {},
): Limiter {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`createLimiter(${name}): limit must be a positive integer`);
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error(`createLimiter(${name}): windowSeconds must be a positive integer`);
  }

  const backend = options.backend ?? upstashBackend(name, limit, windowSeconds);
  const now = options.now ?? (() => Date.now());
  const windowMs = windowSeconds * 1000;

  // Fail-closed fallback: per-instance, per-identifier timestamps of
  // recent hits, capped at half the real limit (never unlimited).
  const fallbackLimit = Math.max(1, Math.floor(limit / 2));
  const fallbackHits = new Map<string, number[]>();

  function fallback(identifier: string, cause: unknown): RateLimitResult {
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'rate_limit.degraded',
        limiter: name,
        fallbackLimit,
        // Never log the identifier itself (an IP or account id) at warn level.
        cause: cause instanceof Error ? cause.message : String(cause),
      }),
    );

    const current = now();
    const recent = (fallbackHits.get(identifier) ?? []).filter((t) => t > current - windowMs);
    const oldest = recent[0];

    if (recent.length >= fallbackLimit && oldest !== undefined) {
      fallbackHits.set(identifier, recent);
      const reset = oldest + windowMs;
      return {
        success: false,
        limit: fallbackLimit,
        remaining: 0,
        reset,
        retryAfterSeconds: toRetryAfterSeconds(reset, current),
        degraded: true,
      };
    }

    recent.push(current);
    fallbackHits.set(identifier, recent);
    return {
      success: true,
      limit: fallbackLimit,
      remaining: fallbackLimit - recent.length,
      reset: (recent[0] ?? current) + windowMs,
      retryAfterSeconds: 0,
      degraded: true,
    };
  }

  return {
    name,
    limit,
    windowSeconds,
    async check(identifier) {
      let response: Awaited<ReturnType<RateLimitBackend['limit']>>;
      try {
        response = await backend.limit(identifier);
      } catch (error) {
        return fallback(identifier, error);
      }

      // Upstash's own timeout path reports success:true — that is a
      // fail-open, not a pass. Route it through the fail-closed fallback.
      if (response.reason === 'timeout') {
        return fallback(identifier, new Error('Upstash rate-limit request timed out'));
      }

      return {
        success: response.success,
        limit: response.limit,
        remaining: response.remaining,
        reset: response.reset,
        retryAfterSeconds: response.success ? 0 : toRetryAfterSeconds(response.reset, now()),
        degraded: false,
      };
    },
  };
}

/**
 * Checks `limiter` for `identifier` and throws {@link RateLimitError}
 * (429 `RATE_LIMITED` + `Retry-After`, via BLOG-29's `toErrorResponse`) when denied.
 * Returns the result when allowed so a caller can set
 * `RateLimit-Remaining`-style headers if it wants to.
 */
export async function enforceRateLimit(
  limiter: Limiter,
  identifier: string,
): Promise<RateLimitResult> {
  const result = await limiter.check(identifier);
  if (!result.success) {
    // RateLimitError is BLOG-29's (positional retryAfterSeconds). The
    // limiter already guarantees a whole number >= 1 when denied, so the
    // Retry-After header it becomes is always valid (RFC 9110).
    throw new RateLimitError(
      `Rate limit exceeded for ${limiter.name}.`,
      Math.max(1, Math.ceil(result.retryAfterSeconds)),
    );
  }
  return result;
}

/**
 * The client IP for anonymous routes: the first `x-forwarded-for` entry
 * (Vercel sets it, and prepends the real client), then `x-real-ip`.
 * Requests with neither share one conservative `unknown` bucket rather
 * than bypassing the limit.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) {
    return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp || 'unknown';
}

/**
 * The limiter key for a route. Anonymous routes key on client IP; the
 * admin upload route keys on the authenticated session's account id, not
 * the IP (spec/security: that limit "bounds abuse even from a stolen
 * session", which only works per-session). Upload without a session fails
 * closed with {@link UnauthenticatedError} rather than falling back to IP.
 */
export function rateLimitKey(
  request: Request,
  scope: RateLimitScope,
  session?: { accountId: string } | null,
): string {
  if (scope === 'upload') {
    const accountId = session?.accountId?.trim();
    if (!accountId) {
      throw new UnauthenticatedError('Upload rate limiting requires an authenticated session.');
    }
    return `account:${accountId}`;
  }
  return `ip:${clientIp(request)}`;
}

/*
 * Per-route limiters. Numbers are the single source of truth from
 * spec/security's and spec/api's Rate limiting tables (BLOG-9 Files).
 * Changing one is a security-eng-reviewed change.
 */

/** `/api/contact`: 5 per 10 minutes per IP (decision/contact-form). */
export const contactLimiter = createLimiter('contact', 5, 10 * 60);

/** `/api/contact`: 20 per 24 hours per IP, on top of the 10-minute window. */
export const contactDailyLimiter = createLimiter('contact-daily', 20, 24 * 60 * 60);

/** `/api/auth/callback/*`: 10 per 5 minutes per IP. */
export const authCallbackLimiter = createLimiter('auth-callback', 10, 5 * 60);

/** `/api/search`: 30 per minute per IP. */
export const searchLimiter = createLimiter('search', 30, 60);

/** `/api/admin/upload`: 20 per minute per authenticated session (spec/api). */
export const uploadLimiter = createLimiter('upload', 20, 60);
