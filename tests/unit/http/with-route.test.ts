import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { POST } from '@/app/api/contact/route';
import { readLimitedBody } from '@/lib/http/body-limit';
import { logger } from '@/lib/http/logger';
import {
  DEFAULT_BODY_LIMIT_BYTES,
  withAuth,
  withRateLimit,
  withRoute,
} from '@/lib/http/with-route';
import { ADMIN_JSON_BODY_LIMIT_BYTES, CONTACT_BODY_LIMIT_BYTES } from '@/lib/security/body-limits';

import { mintSessionToken, sessionCookieHeader } from '../../helpers/session';
import { TEST_GOOGLE_SUB } from '../../setup/test-env';

const REPO_ROOT = join(__dirname, '..', '..', '..');

/**
 * A minimal `Request`-like object `readLimitedBody` actually uses (just
 * `.headers.get` and `.body.getReader`) — exercised directly rather than
 * via a real `NextRequest`, because constructing a `NextRequest` around a
 * streaming body makes the underlying runtime (undici) eagerly pull at
 * least one chunk itself for its own buffering, which would make a
 * "the stream is never read" assertion flaky for reasons unrelated to
 * this module's own logic.
 */
function fakeStreamingRequest(headers: Record<string, string>, body: ReadableStream<Uint8Array>) {
  return { headers: new Headers(headers), body } as unknown as Request;
}

describe('readLimitedBody (BLOG-29 AC4, security-eng carry-forward from BLOG-5)', () => {
  it('rejects via a truthful Content-Length before the body stream is ever acquired', async () => {
    // A bare ReadableStream's own internal queue-filling (per the Streams
    // spec) calls its `pull()` once regardless of whether anything ever
    // reads it, so that isn't a reliable signal of *this module's*
    // behaviour. What matters is whether `readLimitedBody` itself ever
    // calls `.getReader()` — spied directly.
    const getReader = vi.fn();
    const body = { getReader } as unknown as ReadableStream<Uint8Array>;
    const request = fakeStreamingRequest({ 'content-length': String(2_000_000) }, body);

    await expect(readLimitedBody(request, 1_000_000)).rejects.toMatchObject({
      name: 'PayloadTooLargeError',
    });
    expect(getReader).not.toHaveBeenCalled();
  });

  it('aborts mid-stream — never buffers the full body — when Content-Length is absent', async () => {
    const chunkSize = 600_000;
    let chunksEmitted = 0;
    const totalChunksAvailable = 5; // 3,000,000 bytes total if fully drained

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksEmitted >= totalChunksAvailable) {
          controller.close();
          return;
        }
        chunksEmitted += 1;
        controller.enqueue(new Uint8Array(chunkSize));
      },
    });
    const request = fakeStreamingRequest({}, body);

    await expect(readLimitedBody(request, 1_000_000)).rejects.toMatchObject({
      name: 'PayloadTooLargeError',
    });
    // 1,000,000-byte limit / 600,000-byte chunks: exceeded after the 2nd
    // chunk (1,200,000 total) — the stream must not have been drained to
    // its full 5-chunk/3,000,000-byte length.
    expect(chunksEmitted).toBeLessThan(totalChunksAvailable);
  });

  it('a lying (too-low) Content-Length does not bypass the limit — the streamed byte count still wins', async () => {
    const chunkSize = 600_000;
    let chunksEmitted = 0;
    const totalChunksAvailable = 5;

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunksEmitted >= totalChunksAvailable) {
          controller.close();
          return;
        }
        chunksEmitted += 1;
        controller.enqueue(new Uint8Array(chunkSize));
      },
    });
    // Declares far under the limit (and under its own real size) — a
    // forged/stale header, e.g. from chunked transfer-encoding.
    const request = fakeStreamingRequest({ 'content-length': '100' }, body);

    await expect(readLimitedBody(request, 1_000_000)).rejects.toMatchObject({
      name: 'PayloadTooLargeError',
    });
    expect(chunksEmitted).toBeLessThan(totalChunksAvailable);
  });

  it('returns the full text when within the limit', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"ok":true}'));
        controller.close();
      },
    });
    const request = fakeStreamingRequest({}, body);

    await expect(readLimitedBody(request, 1_000_000)).resolves.toBe('{"ok":true}');
  });
});

describe('withRoute logging (BLOG-29 AC5)', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('logs {requestId, method, path, status, durationMs} on success', async () => {
    const route = withRoute(() => NextResponse.json({ ok: true }));
    const request = new NextRequest('http://localhost/api/test', {
      headers: { 'x-request-id': 'req-123' },
    });

    await route(request, {});

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-123',
        method: 'GET',
        path: '/api/test',
        status: 200,
        durationMs: expect.any(Number),
      }),
    );
  });

  it('on an unexpected error, the client gets a generic 500 while the log line carries the real error and requestId', async () => {
    const route = withRoute(() => {
      throw new Error('db exploded');
    });
    const request = new NextRequest('http://localhost/api/test', {
      headers: { 'x-request-id': 'req-456' },
    });

    const response = await route(request, {});
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(json)).not.toContain('db exploded');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-456',
        err: expect.objectContaining({ message: 'db exploded' }),
      }),
    );
  });
});

describe('withRoute malformed JSON (devops review fix)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('a body that is not valid JSON is a 400 VALIDATION_ERROR, not a 500, and the handler never runs', async () => {
    const handler = vi.fn(() => NextResponse.json({ ok: true }));
    const route = withRoute(handler, { bodySchema: z.object({ title: z.string() }) });

    const request = new NextRequest('http://localhost/api/admin/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"title": "unterminated',
    });

    const response = await route(request, {});
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('shared body-limit constants (devops review fix)', () => {
  it('withRoute defaults to the same admin JSON cap the Edge middleware uses', () => {
    expect(DEFAULT_BODY_LIMIT_BYTES).toBe(ADMIN_JSON_BODY_LIMIT_BYTES);
    expect(ADMIN_JSON_BODY_LIMIT_BYTES).toBe(1024 * 1024);
    expect(CONTACT_BODY_LIMIT_BYTES).toBe(200 * 1024);
  });
});

describe('POST /api/contact placeholder (devops review fix)', () => {
  it('answers 501 NOT_IMPLEMENTED and never claims the message was sent', async () => {
    const response = POST();
    const json = await response.json();
    expect(response.status).toBe(501);
    expect(json.error.code).toBe('NOT_IMPLEMENTED');
    expect(json).not.toHaveProperty('ok');
  });
});

describe('withRoute body schema (BLOG-29 AC7)', () => {
  it('the handler receives the exact parsed, typed object zod produced', async () => {
    const schema = z.object({ title: z.string() });
    let received: unknown;

    const route = withRoute(
      ({ body }) => {
        received = body;
        return NextResponse.json({ ok: true });
      },
      { bodySchema: schema },
    );

    const request = new NextRequest('http://localhost/api/admin/posts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hello', extraField: 'dropped-by-zod' }),
    });

    await route(request, {});
    expect(received).toEqual({ title: 'Hello' });
  });
});

describe('withAuth — real Auth.js session check (BLOG-18)', () => {
  const ok = () => withAuth(withRoute(() => NextResponse.json({ ok: true })));
  const requestWith = (cookie?: string) =>
    new NextRequest('https://personal-blog.example/api/admin/posts', {
      headers: cookie ? { cookie } : {},
    });

  it('rejects 401 UNAUTHENTICATED with no session, without calling the route', async () => {
    let called = false;
    const route = withAuth(
      withRoute(() => {
        called = true;
        return NextResponse.json({ ok: true });
      }),
    );
    const response = await route(requestWith(), {});
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(called).toBe(false);
  });

  it('rejects 401 for a token signed with another secret', async () => {
    const token = await mintSessionToken(
      { sub: TEST_GOOGLE_SUB, provider: 'google' },
      { secret: 'rotated-away-secret' },
    );
    const response = await ok()(requestWith(sessionCookieHeader(token)), {});
    expect(response.status).toBe(401);
  });

  it('rejects 403 FORBIDDEN for a valid token that is not allow-listed', async () => {
    const token = await mintSessionToken({ sub: '1', provider: 'github' });
    const response = await ok()(requestWith(sessionCookieHeader(token)), {});
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('FORBIDDEN');
  });

  it('calls the wrapped route for a valid, allow-listed session', async () => {
    const token = await mintSessionToken({ sub: TEST_GOOGLE_SUB, provider: 'google' });
    const response = await ok()(requestWith(sessionCookieHeader(token)), {});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('withRateLimit fail-closed stub', () => {
  it('withRateLimit always rejects 429 with Retry-After (pending BLOG-9)', async () => {
    const limitedRoute = withRateLimit(withRoute(() => NextResponse.json({ ok: true })));
    const response = await limitedRoute(new NextRequest('http://localhost/api/contact'), {});
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeTruthy();
  });
});

describe('every src/app/api/admin/**/route.ts imports withAuth (BLOG-29 AC6)', () => {
  function findAdminRouteFiles(dir: string): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return [];
    }
    const results: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        results.push(...findAdminRouteFiles(full));
      } else if (entry === 'route.ts') {
        results.push(full);
      }
    }
    return results;
  }

  /** The actual check — unit-tested below against fixture content, not just the real tree. */
  function importsWithAuth(source: string): boolean {
    return /\bwithAuth\b/.test(source) && /from\s+['"]@\/lib\/http\/with-route['"]/.test(source);
  }

  it('detection: flags a route.ts that never imports withAuth', () => {
    expect(importsWithAuth("export const GET = () => new Response('ok');")).toBe(false);
  });

  it('detection: accepts a route.ts that imports and composes withAuth', () => {
    expect(
      importsWithAuth(
        "import { withAuth, withRoute } from '@/lib/http/with-route';\nexport const GET = withAuth(withRoute(() => {}));",
      ),
    ).toBe(true);
  });

  it('the real repository tree has no admin route yet that violates this (vacuous today, enforced from the first one)', () => {
    const adminApiDir = join(REPO_ROOT, 'src', 'app', 'api', 'admin');
    const files = findAdminRouteFiles(adminApiDir);
    const violations = files.filter((file) => !importsWithAuth(readFileSync(file, 'utf-8')));
    expect(violations).toEqual([]);
  });
});
