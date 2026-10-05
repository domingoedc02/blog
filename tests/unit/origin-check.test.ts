import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '@/lib/errors';
import { assertSameOrigin } from '@/lib/security/origin-check';

const SITE_URL = 'https://personal-blog.example';

function requestWith(headers: Record<string, string>): Request {
  return new Request('https://personal-blog.example/api/admin/posts', {
    method: 'POST',
    headers,
  });
}

describe('assertSameOrigin (BLOG-5 AC)', () => {
  it("passes when Origin matches SITE_URL's origin", () => {
    expect(() => assertSameOrigin(requestWith({ origin: SITE_URL }), SITE_URL)).not.toThrow();
  });

  it("throws ForbiddenError when Origin does not match SITE_URL's origin", () => {
    expect(() =>
      assertSameOrigin(requestWith({ origin: 'https://evil.example' }), SITE_URL),
    ).toThrow(ForbiddenError);
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(() =>
      assertSameOrigin(requestWith({ referer: `${SITE_URL}/admin/posts/1/edit` }), SITE_URL),
    ).not.toThrow();
  });

  it('rejects a mismatched Referer when Origin is absent', () => {
    expect(() =>
      assertSameOrigin(requestWith({ referer: 'https://evil.example/attack' }), SITE_URL),
    ).toThrow(ForbiddenError);
  });

  it('fails closed when both Origin and Referer are absent (never fail open)', () => {
    expect(() => assertSameOrigin(requestWith({}), SITE_URL)).toThrow(ForbiddenError);
  });

  it('prefers Origin over a mismatched Referer when both are present', () => {
    expect(() =>
      assertSameOrigin(
        requestWith({ origin: SITE_URL, referer: 'https://evil.example/attack' }),
        SITE_URL,
      ),
    ).not.toThrow();
  });

  it('fails closed when SITE_URL itself is misconfigured', () => {
    expect(() => assertSameOrigin(requestWith({ origin: SITE_URL }), 'not-a-url')).toThrow(
      ForbiddenError,
    );
  });
});
