import { logger } from '@/lib/http/logger';

/**
 * Structured audit log (spec/security "Audit logging", threat #10:
 * repudiation of admin actions). One JSON line per meaningful event,
 * emitted explicitly at the call sites that matter — never a generic
 * "log the whole request" middleware, so content and PII can't leak in
 * through a shortcut (BLOG-18 Technical design).
 *
 * The auth events are wired by BLOG-18 (src/lib/auth/callbacks.ts). The
 * `post.*` events are the contract the post mutation routes call into.
 *
 * The field denylist is a security control, not hygiene: it is the
 * backstop against a future call site passing `email`, a message body,
 * post content or a credential. Outside production it throws, so the
 * mistake fails a test; in production it redacts the value and logs a
 * warning instead of taking the request down.
 */

export type AuditEvent =
  | 'auth.sign_in'
  | 'auth.sign_in_rejected'
  | 'auth.sign_out'
  | 'post.created'
  | 'post.edited'
  | 'post.published'
  | 'post.unpublished'
  | 'post.slug_changed'
  | 'post.soft_deleted'
  | 'post.restored'
  | 'post.purged'
  | 'media.upload_accepted'
  | 'media.upload_rejected'
  | 'contact.sent'
  | 'contact.failed'
  | 'rate_limit.exceeded'
  | 'cron.backup_export'
  | 'cron.trash_purge';

export type AuditFields = Record<string, string | number | boolean | null | undefined>;

/** Keys spec/security says are never logged. Compared case-insensitively. */
const FORBIDDEN_KEYS = new Set([
  'email',
  'name',
  'message',
  'body',
  'password',
  'token',
  'jwt',
  'contentjson',
  'content',
  'cookie',
  'authorization',
]);

/** Anything that looks like it carries a credential, whatever the exact key. */
const SECRET_SHAPED_KEY = /secret|token|passw|api[-_]?key|authorization|cookie|session|jwt/i;

export function isForbiddenAuditKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key.toLowerCase()) || SECRET_SHAPED_KEY.test(key);
}

export class AuditFieldError extends Error {
  constructor(event: AuditEvent, key: string) {
    super(`auditLog("${event}") was given forbidden field "${key}"; it must never be logged.`);
    this.name = 'AuditFieldError';
  }
}

export interface AuditSink {
  info(line: Record<string, unknown>): void;
  warn(line: Record<string, unknown>): void;
}

export interface AuditLoggerOptions {
  /** Throw on a forbidden field (dev/test) instead of redacting it (production). */
  strict: boolean;
  now?: () => Date;
}

export function createAuditLogger(sink: AuditSink, options: AuditLoggerOptions) {
  const now = options.now ?? (() => new Date());

  return function auditLog(event: AuditEvent, fields: AuditFields = {}): void {
    const safe: Record<string, unknown> = {};
    const redacted: string[] = [];

    for (const [key, value] of Object.entries(fields)) {
      if (isForbiddenAuditKey(key)) {
        if (options.strict) {
          throw new AuditFieldError(event, key);
        }
        redacted.push(key);
        safe[key] = '[REDACTED]';
        continue;
      }
      safe[key] = value;
    }

    if (redacted.length > 0) {
      sink.warn({ audit: true, event: 'audit.field_redacted', source: event, keys: redacted });
    }
    sink.info({ audit: true, event, at: now().toISOString(), ...safe });
  };
}

/**
 * The app-wide instance, writing through BLOG-29's shared pino logger
 * (src/lib/http/logger.ts) so audit lines and request lines share one
 * logger and one destination.
 */
export const auditLog = createAuditLogger(logger, {
  strict: process.env.NODE_ENV !== 'production',
});
