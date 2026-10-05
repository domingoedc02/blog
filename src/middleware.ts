import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Step 1 of the request pipeline (spec/architecture): stamp every request
 * with a request id, forwarded to the app on the request and echoed back on
 * the response, so a log line and the response that caused it can be
 * correlated.
 *
 * This is scaffolding only: steps 4-9 of the pipeline (body-size limits,
 * rate limiting, session/auth gate, CSRF/Origin check, author allow-list,
 * per-route zod validation) are explicitly out of scope here and owned by
 * BLOG-5, BLOG-9, BLOG-18 and BLOG-29. The static security headers (step 3)
 * are wired separately in next.config.ts's `headers()`.
 */
const REQUEST_ID_HEADER = 'x-request-id';

export function middleware(request: NextRequest) {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on every request except static assets and image optimization
     * files, which don't need a request id or the security headers above
     * (those are set independently via next.config.ts for every route).
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
