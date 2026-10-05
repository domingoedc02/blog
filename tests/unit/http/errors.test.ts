import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';

import {
  ConflictError,
  GoneError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  toErrorResponse,
} from '@/lib/errors';

describe('toErrorResponse (BLOG-29 AC1)', () => {
  it.each([
    { error: new ConflictError('dup'), status: 409, code: 'SLUG_CONFLICT' },
    { error: new NotFoundError('missing'), status: 404, code: 'NOT_FOUND' },
    { error: new GoneError('gone'), status: 410, code: 'GONE' },
  ])('maps $error.name to $status/$code', ({ error, status, code }) => {
    const result = toErrorResponse(error);
    expect(result.status).toBe(status);
    expect(result.body.error.code).toBe(code);
  });
});

describe('ValidationError codes (BLOG-29 AC2)', () => {
  it('an explicit non-generic code is preserved, not overwritten with the generic one', () => {
    const result = toErrorResponse(new ValidationError('bad slug', 'INVALID_SLUG'));
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('INVALID_SLUG');
  });

  it('defaults to VALIDATION_ERROR when no code is given', () => {
    const result = toErrorResponse(new ValidationError('bad input'));
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('still accepts the original { path, reason } shape from src/lib/content/validate.ts', () => {
    const error = new ValidationError('disallowed node', {
      path: 'content[0]',
      reason: 'disallowed-node',
    });
    expect(error.code).toBe('VALIDATION_ERROR');
    const result = toErrorResponse(error);
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(result.body.error.details).toEqual({ path: 'content[0]', reason: 'disallowed-node' });
  });

  it('maps a raw ZodError (thrown by with-route.ts schema.parse) to the same envelope', () => {
    const schema = z.object({ q: z.string().min(2) });
    const parseResult = schema.safeParse({ q: 'x' });
    expect(parseResult.success).toBe(false);
    if (parseResult.success) throw new Error('expected failure');

    const result = toErrorResponse(parseResult.error);
    expect(parseResult.error).toBeInstanceOf(ZodError);
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(result.body.error.details?.fields).toBeDefined();
  });
});

describe('RateLimitError (BLOG-29 AC3)', () => {
  it('carries a Retry-After header and error.retryAfter in the body', () => {
    const result = toErrorResponse(new RateLimitError('slow down', 30));
    expect(result.status).toBe(429);
    expect(result.body.error.code).toBe('RATE_LIMITED');
    expect(result.body.error.retryAfter).toBe(30);
    expect(result.headers?.['Retry-After']).toBe('30');
  });
});

describe('unexpected errors (BLOG-29 AC5)', () => {
  it('maps to a generic 500 INTERNAL_ERROR with no internal message', () => {
    const result = toErrorResponse(new Error('db exploded'));
    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
    expect(result.body.error.message).not.toContain('db exploded');
  });

  it('maps a non-Error thrown value the same way', () => {
    const result = toErrorResponse('a string was thrown');
    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL_ERROR');
  });
});
