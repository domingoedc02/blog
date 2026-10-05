import { env } from '@/lib/env';

/**
 * Server-side Cloudflare Turnstile verification for the contact form
 * (BLOG-9; decision/contact-form; spec/security threat #5). The widget and
 * the public `TURNSTILE_SITE_KEY` are the frontend task's concern; this
 * module only checks the token the widget produced.
 *
 * FAIL CLOSED: the only pass condition is a 200 response whose JSON has
 * `success === true`. A timeout, network error, non-200, malformed JSON
 * or missing token all resolve `false`. The function never throws, so a
 * caller can't mistake a swallowed exception for a pass.
 *
 * The token is a single-use credential and `TURNSTILE_SECRET_KEY` is a
 * secret: neither is ever logged (spec/security audit logging, "never
 * logged: ... any secret value"). Failure logs carry only Cloudflare's
 * `error-codes` or the error class name.
 *
 * Call it AFTER the route's rate limit (see rate-limit.ts call-site
 * contract), so an over-limit caller never costs a Cloudflare round-trip.
 */

export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const DEFAULT_TIMEOUT_MS = 5000;

/** Cloudflare's documented response shape for siteverify. */
export interface TurnstileSiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
}

export interface VerifyTurnstileOptions {
  /** Defaults to `env.TURNSTILE_SECRET_KEY`. */
  secretKey?: string;
  /** Defaults to 5000 ms. */
  timeoutMs?: number;
  /** Defaults to the global `fetch` (injectable for tests). */
  fetchImpl?: typeof fetch;
}

function logFailure(reason: string, errorCodes?: string[]): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'turnstile.verify_failed',
      reason,
      ...(errorCodes && errorCodes.length > 0 ? { errorCodes } : {}),
    }),
  );
}

export async function verifyTurnstile(
  token: string,
  remoteIp?: string,
  options: VerifyTurnstileOptions = {},
): Promise<boolean> {
  if (typeof token !== 'string' || token.trim() === '') {
    logFailure('missing_token');
    return false;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const body = new URLSearchParams();
  body.set('secret', options.secretKey ?? env.TURNSTILE_SECRET_KEY);
  body.set('response', token);
  if (remoteIp && remoteIp !== 'unknown') {
    body.set('remoteip', remoteIp);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });

    if (response.status !== 200) {
      logFailure(`http_${response.status}`);
      return false;
    }

    const data = (await response.json()) as Partial<TurnstileSiteverifyResponse> | null;
    if (data?.success === true) {
      return true;
    }

    logFailure('rejected', Array.isArray(data?.['error-codes']) ? data['error-codes'] : undefined);
    return false;
  } catch (error) {
    // Timeout (AbortError), network failure or malformed JSON. Log the
    // error class only: a message could in theory echo request details.
    logFailure(error instanceof Error ? error.name : 'unknown_error');
    return false;
  } finally {
    clearTimeout(timer);
  }
}
