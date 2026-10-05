import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Boots the real dev server and fetches `/`, per BLOG-19's acceptance
 * criteria: "Given the running dev server, when any response is inspected,
 * then it carries X-Request-Id, Content-Security-Policy,
 * Strict-Transport-Security, X-Content-Type-Options: nosniff, and
 * X-Frame-Options: DENY with the exact values from spec/security."
 *
 * Nothing in the current scaffold imports src/lib/env.ts from a code path
 * the server loads at boot, so this intentionally runs without a
 * .env.local — once a later task wires env.ts into a page/layout, this
 * test's environment will need the same vars tests/unit/env.test.ts uses.
 */
const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 3100 + Math.floor(Math.random() * 400);
const BASE_URL = `http://localhost:${PORT}`;

let server: ChildProcess;

async function waitForServer(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await fetch(BASE_URL);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Dev server did not become ready on ${BASE_URL}: ${String(lastError)}`);
}

describe('security headers (spec/security, next.config.ts)', () => {
  beforeAll(async () => {
    server = spawn('pnpm', ['exec', 'next', 'dev', '--port', String(PORT)], {
      cwd: ROOT,
      stdio: 'pipe',
      env: { ...process.env },
    });
    await waitForServer(60_000);
  }, 70_000);

  afterAll(() => {
    server?.kill('SIGTERM');
  });

  it('carries the request id and the exact security header values on /', async () => {
    const response = await fetch(`${BASE_URL}/`);

    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/i);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('strict-transport-security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
  });
});
