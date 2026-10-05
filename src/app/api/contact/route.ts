import { NextResponse } from 'next/server';

import { ValidationError } from '@/lib/errors';
import { withRateLimit, withRoute } from '@/lib/http/with-route';
import { contactSchema } from '@/lib/validation/contact';

/**
 * `POST /api/contact` (spec/api). Skeleton only: validates the envelope
 * and the honeypot, then responds `202`. The real business logic — the
 * Turnstile `siteverify` call and the Resend send, and the `502
 * UPSTREAM_ERROR` path when Resend fails — is a future story (BLOG-16);
 * this task's job is only to establish the canonical `withRoute` shape a
 * future route handler fills in, per spec/file-structure's "copy the shape
 * of an existing route" rule.
 *
 * Wrapped in {@link withRateLimit}: spec/api fixes a real 5-requests/
 * 10-minutes/IP limit here, but the actual Upstash limiter is BLOG-9's
 * (abuse protection) job. Until that lands, this route fails closed with
 * `429` on every call — intentionally loud rather than silently
 * unprotected (this task's design decision, see with-route.ts).
 */
const handler = withRoute(
  ({ body }) => {
    if (body.honeypot) {
      throw new ValidationError('Spam signal detected.', 'BOT_DETECTED');
    }

    // TODO(BLOG-16): verify body.turnstileToken via src/lib/security/turnstile.ts,
    // then send via src/lib/email/resend-client.ts, mapping a send failure to
    // UpstreamError (502 UPSTREAM_ERROR). Nothing from this payload is ever
    // persisted (decision/contact-form).
    return NextResponse.json({ ok: true }, { status: 202 });
  },
  { bodySchema: contactSchema, bodyLimitBytes: 200_000 },
);

export const POST = withRateLimit(handler);
