import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { readLimitedBody } from '@/lib/http/body-limit';
import { logger } from '@/lib/http/logger';
import { withAuth, withRateLimit, withRoute } from '@/lib/http/with-route';

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

describe('withAuth / withRateLimit fail-closed stubs', () => {
  it('withAuth always rejects 401 (pending BLOG-18)', async () => {
    const protectedRoute = withAuth(withRoute(() => NextResponse.json({ ok: true })));
    const response = await protectedRoute(new NextRequest('http://localhost/api/admin/posts'), {});
    expect(response.status).toBe(401);
  });

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
