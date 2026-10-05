/**
 * Shared helper for the `tests/integration/db/**` suite: stubs the full
 * env surface `src/lib/env.ts` requires (its zod schema parses ALL of
 * `process.env` at import time, not just `DATABASE_URL`) and points
 * `DATABASE_URL` at a disposable Postgres — the CI service container
 * (spec/operations) or a local one via `docker compose up -d postgres`.
 *
 * `TEST_DATABASE_URL` overrides the default so a developer can point this
 * suite at a Postgres on a non-standard port without touching
 * `.env.local`'s own `DATABASE_URL`.
 */
export function testDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgresql://blog:blog_dev_password@localhost:5432/blog'
  );
}

export function applyTestEnv(): void {
  Object.assign(process.env, {
    DATABASE_URL: testDatabaseUrl(),
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
  });
}
