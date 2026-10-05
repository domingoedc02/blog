import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAllowListed, matchesAllowList, parseAllowList } from '@/lib/auth/allow-list';

const RAW = 'google:109283746502938475,github:8341223';
const FUZZ_IDS = ['', ' ', '0', '109283746502938475', '8341223', 'google:109283746502938475', '*'];

describe('parseAllowList', () => {
  it('parses provider:id pairs', () => {
    expect(parseAllowList(RAW)).toEqual([
      { provider: 'google', id: '109283746502938475' },
      { provider: 'github', id: '8341223' },
    ]);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseAllowList(' google:123 , github:456 ')).toEqual([
      { provider: 'google', id: '123' },
      { provider: 'github', id: '456' },
    ]);
  });

  it('skips malformed entries rather than throwing or widening the list', () => {
    expect(parseAllowList('google:123,not-a-pair,:,github:,:456')).toEqual([
      { provider: 'google', id: '123' },
    ]);
  });
});

describe('matchesAllowList — the comparison (decision/auth, spec/security threat #2)', () => {
  it('matches an allow-listed provider:id pair on either provider', () => {
    expect(matchesAllowList('google', '109283746502938475', RAW)).toBe(true);
    expect(matchesAllowList('github', '8341223', RAW)).toBe(true);
  });

  it('rejects an id that is not listed', () => {
    expect(matchesAllowList('google', '000000000000000000', RAW)).toBe(false);
  });

  it('rejects the right id under the wrong provider', () => {
    expect(matchesAllowList('github', '109283746502938475', RAW)).toBe(false);
  });

  it('rejects an unknown provider even if its entry is listed', () => {
    expect(matchesAllowList('twitter', '1', 'twitter:1')).toBe(false);
  });

  // BLOG-18 AC: an unset or empty allow-list rejects every sign-in on both providers.
  for (const raw of [undefined, '', '   ', ',', ':']) {
    it(`fails closed for every id on both providers when AUTHOR_ALLOWLIST is ${JSON.stringify(raw)}`, () => {
      for (const provider of ['google', 'github']) {
        for (const id of FUZZ_IDS) {
          expect(matchesAllowList(provider, id, raw)).toBe(false);
        }
      }
    });
  }

  // BLOG-18 AC: a missing per-provider entry fails closed for that provider only.
  it('with only a google entry, rejects every GitHub id and still accepts Google', () => {
    const googleOnly = 'google:109283746502938475';
    for (const id of FUZZ_IDS) {
      expect(matchesAllowList('github', id, googleOnly)).toBe(false);
    }
    expect(matchesAllowList('google', '109283746502938475', googleOnly)).toBe(true);
  });

  it('with only a github entry, rejects every Google id and still accepts GitHub', () => {
    const githubOnly = 'github:8341223';
    for (const id of FUZZ_IDS) {
      expect(matchesAllowList('google', id, githubOnly)).toBe(false);
    }
    expect(matchesAllowList('github', '8341223', githubOnly)).toBe(true);
  });
});

describe('isAllowListed — reads AUTHOR_ALLOWLIST through src/lib/env.ts', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/env');
    vi.resetModules();
  });

  it('matches the configured allow-list', () => {
    // tests/setup/test-env.ts sets AUTHOR_ALLOWLIST to the same two test ids.
    expect(isAllowListed('google', '109283746502938475')).toBe(true);
    expect(isAllowListed('github', '8341223')).toBe(true);
    expect(isAllowListed('github', '1')).toBe(false);
  });

  it('fails closed on both providers when env carries an empty AUTHOR_ALLOWLIST', async () => {
    vi.resetModules();
    vi.doMock('@/lib/env', () => ({ env: { AUTHOR_ALLOWLIST: '' } }));
    const fresh = await import('@/lib/auth/allow-list');
    for (const id of FUZZ_IDS) {
      expect(fresh.isAllowListed('google', id)).toBe(false);
      expect(fresh.isAllowListed('github', id)).toBe(false);
    }
  });
});
