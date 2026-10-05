import type { NextConfig } from 'next';

/**
 * The R2/MinIO public origin allowed as an image source in the CSP.
 *
 * `R2_PUBLIC_BASE_URL` is a full base URL (e.g. `http://localhost:9000/blog-media`
 * locally, or the real R2 public domain in preview/production — see spec/setup).
 * next.config.ts runs in plain Node before `src/lib/env.ts` validation applies to
 * the app, so it reads `process.env` directly here and falls back to the local
 * MinIO origin used by docker-compose when the var isn't set yet.
 */
function r2Origin(): string {
  const raw = process.env.R2_PUBLIC_BASE_URL;
  if (!raw) {
    return 'http://localhost:9000';
  }
  try {
    return new URL(raw).origin;
  } catch {
    return 'http://localhost:9000';
  }
}

/**
 * Security headers, applied to every route. Exact values and ordering come
 * from spec/security "Middleware & headers" — this file wires the mechanism,
 * it does not invent or alter any header value. CSRF/Origin check, rate
 * limiting, session/auth and per-route zod validation (pipeline steps 4-9)
 * are deliberately NOT handled here; see BLOG-5, BLOG-9, BLOG-18, BLOG-29.
 */
function securityHeaders() {
  return [
    {
      key: 'Content-Security-Policy',
      value: [
        "default-src 'self'",
        "script-src 'self' https://cloud.umami.is https://challenges.cloudflare.com",
        "style-src 'self' 'unsafe-inline'",
        `img-src 'self' data: ${r2Origin()}`,
        "font-src 'self'",
        "connect-src 'self' https://cloud.umami.is https://challenges.cloudflare.com",
        'frame-src https://challenges.cloudflare.com',
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
        'upgrade-insecure-requests',
      ].join('; '),
    },
    {
      key: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
    },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
    },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Every route, including the 404/not-found render.
        source: '/:path*',
        headers: securityHeaders(),
      },
      {
        // Admin surface: never cached, never indexed. Additive to the headers above.
        source: '/admin/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex' },
        ],
      },
      {
        source: '/api/admin/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'X-Robots-Tag', value: 'noindex' },
        ],
      },
    ];
  },
};

export default nextConfig;
