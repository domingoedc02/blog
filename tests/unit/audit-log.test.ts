import { describe, expect, it } from 'vitest';

import {
  AuditFieldError,
  createAuditLogger,
  isForbiddenAuditKey,
  type AuditSink,
} from '@/lib/audit-log';

function recordingSink() {
  const info: Record<string, unknown>[] = [];
  const warn: Record<string, unknown>[] = [];
  const sink: AuditSink = {
    info: (line) => info.push(line),
    warn: (line) => warn.push(line),
  };
  return { sink, info, warn };
}

const FIXED_NOW = () => new Date('2026-10-06T12:00:00.000Z');

const FORBIDDEN = [
  'email',
  'Email',
  'message',
  'password',
  'token',
  'contentJson',
  'accessToken',
  'refresh_token',
  'clientSecret',
  'AUTH_SECRET',
  'apiKey',
  'authorization',
  'cookie',
  'sessionToken',
];

describe('auditLog — one structured line per event', () => {
  it('emits the event, a timestamp and the given fields', () => {
    const { sink, info } = recordingSink();
    const auditLog = createAuditLogger(sink, { strict: true, now: FIXED_NOW });

    auditLog('auth.sign_in', { provider: 'google', accountId: '123', ip: '203.0.113.7' });

    expect(info).toEqual([
      {
        audit: true,
        event: 'auth.sign_in',
        at: '2026-10-06T12:00:00.000Z',
        provider: 'google',
        accountId: '123',
        ip: '203.0.113.7',
      },
    ]);
  });

  it('allows the fields the auth and post events need', () => {
    for (const key of ['provider', 'accountId', 'ip', 'postId', 'action', 'reason', 'count']) {
      expect(isForbiddenAuditKey(key)).toBe(false);
    }
  });
});

describe('auditLog — field denylist guard (spec/security "never logged")', () => {
  it.each(FORBIDDEN)('throws in dev/test when given "%s"', (key) => {
    const { sink, info } = recordingSink();
    const auditLog = createAuditLogger(sink, { strict: true });
    expect(() => auditLog('post.published', { postId: 'p1', [key]: 'leak' })).toThrow(
      AuditFieldError,
    );
    expect(info).toHaveLength(0); // nothing emitted at all
  });

  it.each(FORBIDDEN)(
    'redacts "%s" and warns in production instead of emitting the value',
    (key) => {
      const { sink, info, warn } = recordingSink();
      const auditLog = createAuditLogger(sink, { strict: false });

      auditLog('post.published', { postId: 'p1', [key]: 'leak' });

      expect(JSON.stringify(info)).not.toContain('leak');
      expect(info[0]?.[key]).toBe('[REDACTED]');
      expect(info[0]?.postId).toBe('p1');
      expect(warn).toEqual([
        { audit: true, event: 'audit.field_redacted', source: 'post.published', keys: [key] },
      ]);
    },
  );
});
