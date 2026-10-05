import 'server-only';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { z, ZodSchema } from 'zod';

import { verifyAdminSession, type AdminSessionResult } from '@/lib/auth/session';
import { env } from '@/lib/env';
import {
  ForbiddenError,
  RateLimitError,
  UnauthenticatedError,
  ValidationError,
  toErrorResponse,
} from '@/lib/errors';
import type { ErrorResponse } from '@/lib/errors';
import { ADMIN_JSON_BODY_LIMIT_BYTES } from '@/lib/security/body-limits';

import { readLimitedBody } from './body-limit';
import { logger } from './logger';

/**
 * Default cap: the admin JSON limit, from the one shared constant set
 * (src/lib/security/body-limits.ts) the Edge middleware also uses.
 */
export const DEFAULT_BODY_LIMIT_BYTES = ADMIN_JSON_BODY_LIMIT_BYTES;

/**
 * Parses a request body as JSON. A malformed body is a client error, not a
 * server fault: it's rethrown as `400 VALIDATION_ERROR` instead of letting
 * the raw `SyntaxError` fall through to the generic 500 branch.
 */
function parseJsonBody(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('Request body is not valid JSON.', 'VALIDATION_ERROR');
  }
}

/**
 * Builds a `NextResponse` from a mapped error, only including `headers` in
 * `ResponseInit` when present — `exactOptionalPropertyTypes` rejects an
 * explicit `headers: undefined`.
 */
function errorToNextResponse(mapped: ErrorResponse): NextResponse {
  return NextResponse.json(mapped.body, {
    status: mapped.status,
    ...(mapped.headers ? { headers: mapped.headers } : {}),
  });
}

export interface WithRouteOptions<
  BodySchema extends ZodSchema | undefined = undefined,
  QuerySchema extends ZodSchema | undefined = undefined,
> {
  /** Validates and types the parsed JSON body. Omit for a route with no body (e.g. a GET). */
  bodySchema?: BodySchema;
  /** Validates and types `?query` params. */
  querySchema?: QuerySchema;
  /** Byte cap enforced before the body is parsed. Defaults to {@link DEFAULT_BODY_LIMIT_BYTES}. */
  bodyLimitBytes?: number;
}

type Infer<S extends ZodSchema | undefined> = S extends ZodSchema ? z.infer<S> : undefined;

export interface RouteHandlerArgs<
  BodySchema extends ZodSchema | undefined,
  QuerySchema extends ZodSchema | undefined,
  Context,
> {
  request: NextRequest;
  context: Context;
  body: Infer<BodySchema>;
  query: Infer<QuerySchema>;
  requestId: string;
}

export type RouteHandler<
  BodySchema extends ZodSchema | undefined,
  QuerySchema extends ZodSchema | undefined,
  Context,
> = (
  args: RouteHandlerArgs<BodySchema, QuerySchema, Context>,
) => Promise<NextResponse> | NextResponse;

export type WrappedRoute<Context> = (
  request: NextRequest,
  context: Context,
) => Promise<NextResponse>;

/**
 * The one canonical Route Handler wrapper every `/api/*` route composes
 * (spec/file-structure: "copy the shape of an existing route... rather
 * than inventing a new error-handling style"). Implements request pipeline
 * steps 1 (reads the request id `src/middleware.ts` set), 2 (logging), 4
 * (body limit), 9 (zod validation) and 11 (error mapping) of
 * spec/architecture. Steps 5-8 (rate limit, session/auth, CSRF, allow-list)
 * are NOT here — compose {@link withAuth}/{@link withRateLimit} around
 * this, in pipeline order, from the route's own export.
 */
export function withRoute<
  BodySchema extends ZodSchema | undefined = undefined,
  QuerySchema extends ZodSchema | undefined = undefined,
  Context = unknown,
>(
  handler: RouteHandler<BodySchema, QuerySchema, Context>,
  options: WithRouteOptions<BodySchema, QuerySchema> = {},
): WrappedRoute<Context> {
  return async (request: NextRequest, context: Context): Promise<NextResponse> => {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
    const startedAt = Date.now();
    const path = new URL(request.url).pathname;

    const withRequestId = (response: NextResponse): NextResponse => {
      response.headers.set('x-request-id', requestId);
      return response;
    };

    const logLine = (status: number, extra?: Record<string, unknown>) => ({
      requestId,
      method: request.method,
      path,
      status,
      durationMs: Date.now() - startedAt,
      ...extra,
    });

    try {
      let body: Infer<BodySchema> = undefined as Infer<BodySchema>;
      if (options.bodySchema) {
        const limit = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
        const text = await readLimitedBody(request, limit);
        const json = parseJsonBody(text);
        body = options.bodySchema.parse(json) as Infer<BodySchema>;
      }

      let query: Infer<QuerySchema> = undefined as Infer<QuerySchema>;
      if (options.querySchema) {
        const params = Object.fromEntries(new URL(request.url).searchParams.entries());
        query = options.querySchema.parse(params) as Infer<QuerySchema>;
      }

      const response = await handler({ request, context, body, query, requestId });
      logger.info(logLine(response.status));
      return withRequestId(response);
    } catch (error) {
      const mapped = toErrorResponse(error);
      logger.error(
        logLine(mapped.status, {
          err:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : error,
        }),
      );
      return withRequestId(errorToNextResponse(mapped));
    }
  };
}

/**
 * Pipeline steps 6 and 8 (session + allow-list) for an individual
 * `/api/admin/*` Route Handler, composed around {@link withRoute}:
 * `export const POST = withAuth(withRoute(handler, options))`.
 *
 * Middleware is the first gate; this is the per-handler server-side
 * re-check (spec/security: "Every `/api/admin/*` handler re-checks the
 * session server-side on each request"). Both call the same
 * `verifyAdminSession()` (src/lib/auth/session.ts, BLOG-18), so the check
 * is written once:
 *
 * - no/tampered/expired/wrong-secret Auth.js JWT → 401 `UNAUTHENTICATED`
 * - valid JWT whose identity is no longer in `AUTHOR_ALLOWLIST` → 403
 *   `FORBIDDEN`
 * - otherwise the wrapped route runs.
 *
 * Any failure inside the check itself fails closed as a 401.
 */
export function withAuth<Context>(route: WrappedRoute<Context>): WrappedRoute<Context> {
  return async (request: NextRequest, context: Context): Promise<NextResponse> => {
    let result: AdminSessionResult;
    try {
      result = await verifyAdminSession(request, {
        secret: env.AUTH_SECRET,
        siteUrl: env.SITE_URL,
        allowList: env.AUTHOR_ALLOWLIST,
      });
    } catch {
      result = { status: 'unauthenticated' };
    }

    if (result.status === 'unauthenticated') {
      return errorToNextResponse(toErrorResponse(new UnauthenticatedError('Sign in required.')));
    }
    if (result.status === 'forbidden') {
      return errorToNextResponse(
        toErrorResponse(new ForbiddenError('This account is not allowed here.')),
      );
    }
    return route(request, context);
  };
}

/**
 * Fail-closed composition point for pipeline step 5 (rate limit). Always
 * rejects with 429 until BLOG-9 (abuse protection) lands the real Upstash
 * sliding-window limiter — same fail-closed rationale as {@link withAuth}.
 *
 * TODO(BLOG-9): replace the body with a real `@upstash/ratelimit` check.
 */
export function withRateLimit<Context>(
  _route: WrappedRoute<Context>,
  defaultRetryAfterSeconds = 60,
): WrappedRoute<Context> {
  // `_route` is deliberately unused: this stub never calls through to the
  // wrapped route, by design, until BLOG-9 lands the real limiter.
  return async (_request: NextRequest, _context: Context): Promise<NextResponse> => {
    const mapped = toErrorResponse(
      new RateLimitError(
        'Rate limiting is not wired yet (pending BLOG-9) — failing closed.',
        defaultRetryAfterSeconds,
      ),
    );
    return errorToNextResponse(mapped);
  };
}
