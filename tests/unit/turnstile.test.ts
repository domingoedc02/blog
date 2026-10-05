import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * BLOG-9 Turnstile helper. `fetch` is always injected, so nothing here
 * touches Cloudflare. Every failure mode must resolve `false`, never throw,
 * and never log the token or the secret.
 */
const SECRET = 'test-turnstile-secret-DO-NOT-LOG-0x5ec7e7';
const TOKEN = 'test-turnstile-token-DO-NOT-LOG-0x70ce';

vi.mock('@/lib/env', () => ({
  env: { TURNSTILE_SECRET_KEY: 'test-turnstile-secret-DO-NOT-LOG-0x5ec7e7' },
}));

const { TURNSTILE_SITEVERIFY_URL, verifyTurnstile } = await import('@/lib/security/turnstile');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifyTurnstile', () => {
  it('resolves true only when siteverify returns 200 with success: true, posting secret, token and IP', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ success: true }));

    await expect(verifyTurnstile(TOKEN, '203.0.113.7', { fetchImpl })).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init?.method).toBe('POST');
    const body = init?.body as URLSearchParams;
    expect(body.get('secret')).toBe(SECRET);
    expect(body.get('response')).toBe(TOKEN);
    expect(body.get('remoteip')).toBe('203.0.113.7');
  });

  it('omits remoteip when the IP is unknown', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ success: true }));
    await verifyTurnstile(TOKEN, 'unknown', { fetchImpl });
    expect((fetchImpl.mock.calls[0]![1]?.body as URLSearchParams).has('remoteip')).toBe(false);
  });

  it('resolves false (not an exception) when Cloudflare rejects the token (BLOG-9 AC3)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ success: false, 'error-codes': ['invalid-input-response'] }),
    );
    await expect(verifyTurnstile(TOKEN, undefined, { fetchImpl })).resolves.toBe(false);
  });

  it.each([400, 429, 500, 503])('fails closed on HTTP %i (BLOG-9 AC4)', async (status) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Even a body claiming success must not pass on a non-200.
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ success: true }, status));
    await expect(verifyTurnstile(TOKEN, undefined, { fetchImpl })).resolves.toBe(false);
  });

  it('fails closed on a network error (BLOG-9 AC4)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(verifyTurnstile(TOKEN, undefined, { fetchImpl })).resolves.toBe(false);
  });

  it('fails closed on a timeout by aborting the request (BLOG-9 AC4)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
    await expect(verifyTurnstile(TOKEN, undefined, { fetchImpl, timeoutMs: 20 })).resolves.toBe(
      false,
    );
    expect(fetchImpl.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  });

  it('fails closed on malformed JSON and on a body without success: true', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const notJson = vi.fn<typeof fetch>(
      async () => new Response('<html>oops</html>', { status: 200 }),
    );
    await expect(verifyTurnstile(TOKEN, undefined, { fetchImpl: notJson })).resolves.toBe(false);

    const truthyButNotTrue = vi.fn<typeof fetch>(async () => jsonResponse({ success: 'true' }));
    await expect(verifyTurnstile(TOKEN, undefined, { fetchImpl: truthyButNotTrue })).resolves.toBe(
      false,
    );
  });

  it('resolves false without calling Cloudflare for an empty token', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(verifyTurnstile('', undefined, { fetchImpl })).resolves.toBe(false);
    await expect(verifyTurnstile('   ', undefined, { fetchImpl })).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never writes the token or the secret to any log line (BLOG-9 AC7)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const scenarios: Array<typeof fetch> = [
      async () => jsonResponse({ success: true }),
      async () => jsonResponse({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
      async () => jsonResponse({ success: false }, 500),
      async () => {
        throw new Error(`boom with ${TOKEN} and ${SECRET} in the message`);
      },
      async () => new Response('not json', { status: 200 }),
    ];
    for (const fetchImpl of scenarios) {
      await verifyTurnstile(TOKEN, '203.0.113.7', { fetchImpl });
    }

    const everything = [...warn.mock.calls, ...log.mock.calls, ...error.mock.calls]
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join('\n');
    expect(warn).toHaveBeenCalled();
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain(SECRET);
  });
});
