import type { NextConfig } from 'next';

// A relative import, not the `@/*` alias: next.config.ts is loaded by
// Next's own config loader before the app's path-alias resolution is
// guaranteed to apply, so this plays it safe.
import { ADMIN_ONLY_HEADERS, buildSecurityHeaders } from './src/lib/security/headers';

/**
 * CSRF/Origin check, rate limiting, session/auth and per-route zod
 * validation (request-pipeline steps 4-9) are deliberately NOT handled
 * here; see src/middleware.ts (BLOG-5), BLOG-9, BLOG-18, BLOG-29.
 *
 * The header VALUES live in src/lib/security/headers.ts, shared with
 * src/middleware.ts so the two can't drift (BLOG-5).
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Every route, including the 404/not-found render.
        source: '/:path*',
        headers: buildSecurityHeaders(process.env.R2_PUBLIC_BASE_URL),
      },
      {
        // Admin surface: never cached, never indexed. Additive to the headers above.
        source: '/admin/:path*',
        headers: ADMIN_ONLY_HEADERS,
      },
      {
        source: '/api/admin/:path*',
        headers: ADMIN_ONLY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
