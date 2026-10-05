import { describe, expect, it } from 'vitest';

import { isAllowListed, parseAllowList } from '@/lib/auth/allow-list';

const RAW = 'google:109283746502938475,github:8341223';

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

  it('skips malformed entries rather than throwing', () => {
    expect(parseAllowList('google:123,not-a-pair,:,github:,:456')).toEqual([
      { provider: 'google', id: '123' },
    ]);
  });

  it('returns an empty list for an empty string', () => {
    expect(parseAllowList('')).toEqual([]);
  });
});

describe('isAllowListed (decision/auth, spec/security threat #2)', () => {
  it('matches an allow-listed provider:id pair', () => {
    expect(isAllowListed('google', '109283746502938475', RAW)).toBe(true);
    expect(isAllowListed('github', '8341223', RAW)).toBe(true);
  });

  it('rejects an id not in the allow-list', () => {
    expect(isAllowListed('google', '000000000000000000', RAW)).toBe(false);
  });

  it('rejects the right id under the wrong provider', () => {
    expect(isAllowListed('github', '109283746502938475', RAW)).toBe(false);
  });

  it('fails closed when the allow-list is empty', () => {
    expect(isAllowListed('google', '109283746502938475', '')).toBe(false);
  });

  it('fails closed when the allow-list is undefined (unset env var)', () => {
    expect(isAllowListed('google', '109283746502938475', undefined)).toBe(false);
  });
});
