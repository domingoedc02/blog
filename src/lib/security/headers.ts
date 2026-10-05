/**
 * The single source of truth for the project's security headers — resolves
 * BLOG-5's own Open Question #2 ("the CSP string live in one exported
 * constant imported by both [next.config.ts and middleware.ts] ... needs a
 * quick spike before coding"). Both call sites import this module rather
 * than each keeping their own copy, so the two can never drift.
 *
 * Deliberately framework-agnostic (no `next/server` import) so it loads
 * identically in `next.config.ts` (plain Node, build time) and
 * `src/middleware.ts` (Edge runtime, request time).
 *
 * Exact values and ordering come from spec/security's "Middleware &
 * headers" section (mirrored verbatim in spec/architecture's canonical CSP
 * string) — this module wires the mechanism, it does not invent or alter
 * any header value. `script-src`/`connect-src` must each keep both
 * `https://cloud.umami.is` and `https://challenges.cloudflare.com`, or
 * Umami's pageview script / the Turnstile widget silently breaks — not
 * just "deviates from the spec" (per the issue's own warning and
 * system-architect's BLOG-5 review comment).
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

/**
 * `R2_PUBLIC_BASE_URL` is a full base URL (e.g.
 * `http://localhost:9000/blog-media` locally, the real R2 public domain in
 * preview/production — spec/setup). Only the origin is needed for the CSP
 * `img-src` entry. Falls back to the local MinIO origin docker-compose
 * uses when the var isn't configured yet, so headers() still produces a
 * syntactically valid CSP in a fresh checkout before devops provisions R2.
 */
export function resolveR2Origin(rawBaseUrl: string | undefined): string {
  const fallback = 'http://localhost:9000';
  if (!rawBaseUrl) {
    return fallback;
  }
  try {
    return new URL(rawBaseUrl).origin;
  } catch {
    return fallback;
  }
}

export function buildContentSecurityPolicy(r2PublicBaseUrl: string | undefined): string {
  const r2Origin = resolveR2Origin(r2PublicBaseUrl);
  return [
    "default-src 'self'",
    "script-src 'self' https://cloud.umami.is https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${r2Origin}`,
    "font-src 'self'",
    "connect-src 'self' https://cloud.umami.is https://challenges.cloudflare.com",
    'frame-src https://challenges.cloudflare.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Applied to every response, including errors — spec/security, step 3 of spec/architecture's request pipeline. */
export function buildSecurityHeaders(r2PublicBaseUrl: string | undefined): SecurityHeader[] {
  return [
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(r2PublicBaseUrl) },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
    },
    // Kept alongside `frame-ancestors 'none'` for pre-Chromium-92 browsers — defence-in-depth, not redundant.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
}

/** Additive, on top of {@link buildSecurityHeaders} — `/admin/*` and `/api/admin/*` only. */
export const ADMIN_ONLY_HEADERS: SecurityHeader[] = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'X-Robots-Tag', value: 'noindex' },
];
