import { NextResponse } from 'next/server';

/**
 * `POST /api/contact`: placeholder only. It returns `501 NOT_IMPLEMENTED`
 * in spec/api's error envelope and has no logic.
 *
 * It deliberately does NOT validate, run the honeypot check or answer
 * `202`. A `202 {ok:true}` with no send behind it would tell readers their
 * message was sent while silently dropping it. The real handler (zod
 * validation via `src/lib/validation/contact.ts`, honeypot, rate limit,
 * Turnstile `siteverify`, Resend send, `502 UPSTREAM_ERROR` on failure) is
 * BLOG-16's, built on `withRoute` from `src/lib/http/with-route.ts`.
 *
 * TODO(BLOG-16): replace this placeholder with the real contact handler.
 */
export function POST(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'The contact form is not available yet.',
      },
    },
    { status: 501 },
  );
}
