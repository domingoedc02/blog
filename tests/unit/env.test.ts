import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

/**
 * src/lib/env.ts throws at module-load time if any required variable is
 * missing or malformed, per BLOG-19's acceptance criteria: "Given
 * .env.local is missing a required variable ... then it throws a clear
 * error naming the missing variable instead of starting with undefined."
 */

const COMPLETE_ENV = {
  DATABASE_URL: 'postgresql://blog:blog_dev_password@localhost:5432/blog',
  AUTH_SECRET: 'test-secret',
  AUTH_URL: 'http://localhost:3000',
  AUTH_GOOGLE_ID: 'google-id',
  AUTH_GOOGLE_SECRET: 'google-secret',
  AUTH_GITHUB_ID: 'github-id',
  AUTH_GITHUB_SECRET: 'github-secret',
  AUTHOR_ALLOWLIST: 'google:123,github:456',
  SITE_URL: 'http://localhost:3000',
  R2_ACCOUNT_ID: 'account',
  R2_ACCESS_KEY_ID: 'access-key',
  R2_SECRET_ACCESS_KEY: 'secret-key',
  R2_BUCKET_NAME: 'blog-media',
  R2_PUBLIC_BASE_URL: 'http://localhost:9000/blog-media',
  R2_ENDPOINT: 'http://localhost:9000',
  RESEND_API_KEY: 'resend-key',
  CONTACT_TO_EMAIL: 'author@example.com',
  CONTACT_FALLBACK_EMAIL: 'author@example.com',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  UPSTASH_REDIS_REST_URL: 'https://us1-example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'token',
  UMAMI_WEBSITE_ID: 'website-id',
  UMAMI_SCRIPT_URL: 'https://cloud.umami.is/script.js',
  CRON_SECRET: 'cron-secret',
};

const ORIGINAL_ENV = { ...process.env };

describe('src/lib/env.ts', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('exposes every required variable, typed, when the environment is complete', async () => {
    process.env = { ...process.env, ...COMPLETE_ENV };
    const { env } = await import('@/lib/env');
    expect(env.SITE_URL).toBe('http://localhost:3000');
    expect(env.AUTHOR_ALLOWLIST).toBe('google:123,github:456');
  });

  it('throws a ZodError naming the missing field when AUTH_SECRET is absent', async () => {
    const { AUTH_SECRET: _omit, ...incomplete } = COMPLETE_ENV;
    process.env = { ...process.env, ...incomplete };
    delete process.env.AUTH_SECRET; // tests/setup/test-env.ts pre-fills it

    await expect(import('@/lib/env')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ZodError);
      const zodError = error as ZodError;
      expect(zodError.issues.some((issue) => issue.path.includes('AUTH_SECRET'))).toBe(true);
      return true;
    });
  });

  it('throws a ZodError naming the field when a URL variable is malformed', async () => {
    process.env = { ...process.env, ...COMPLETE_ENV, SITE_URL: 'not-a-url' };

    await expect(import('@/lib/env')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ZodError);
      const zodError = error as ZodError;
      expect(zodError.issues.some((issue) => issue.path.includes('SITE_URL'))).toBe(true);
      return true;
    });
  });
});
