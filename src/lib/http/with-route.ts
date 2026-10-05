import 'server-only';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { z, ZodSchema } from 'zod';

import { RateLimitError, UnauthenticatedError, toErrorResponse } from '@/lib/errors';
import type { ErrorResponse } from '@/lib/errors';

import { readLimitedBody } from './body-limit';
import { logger } from './logger';

/** 1 MB — the admin JSON default per spec/architecture's body-limit table. */
export const DEFAULT_BODY_LIMIT_BYTES = 1_000_000;

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
        const json = text.length > 0 ? JSON.parse(text) : undefined;
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
 * Fail-closed composition point for pipeline step 6 (session/auth), for a
 * Route Handler to compose around {@link withRoute} (BLOG-5 already wires
 * the equivalent gate at the `/admin/*` middleware level; this is the
 * same fail-closed stub for individual `/api/admin/*` route handlers).
 * Always rejects with 401 until BLOG-18 (Auth hardening, reassigned to
 * frontend-dev) lands the real Auth.js session check — a route that
 * composes this is loudly broken (every request 401s) rather than
 * silently unprotected, per this issue's explicit design decision.
 *
 * TODO(BLOG-18): replace the body with a real session check, reusing
 * BLOG-5's `src/lib/auth/allow-list.ts` rather than writing a second one.
 */
export function withAuth<Context>(_route: WrappedRoute<Context>): WrappedRoute<Context> {
  // `_route` is deliberately unused: this stub never calls through to the
  // wrapped route, by design, until BLOG-18 lands the real check.
  return async (_request: NextRequest, _context: Context): Promise<NextResponse> => {
    const mapped = toErrorResponse(
      new UnauthenticatedError(
        'Session verification is not wired yet (pending BLOG-18) — failing closed.',
      ),
    );
    return errorToNextResponse(mapped);
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
