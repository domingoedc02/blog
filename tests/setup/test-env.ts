/**
 * Fills every variable src/lib/env.ts requires with an obviously fake
 * value, for any key the shell or CI hasn't already set. src/middleware.ts
 * and src/lib/auth/* read config through env.ts, which validates the whole
 * schema at import (BLOG-19), so a test that imports them needs a complete
 * environment. Nothing here is a real credential.
 */
export const TEST_SITE_URL = 'https://personal-blog.example';
export const TEST_AUTH_SECRET = 'test-only-auth-secret-not-real-0123456789abcdef';
export const TEST_GOOGLE_SUB = '109283746502938475';
export const TEST_GITHUB_ID = '8341223';

const TEST_ENV: Record<string, string> = {
  DATABASE_URL: 'postgresql://blog:blog_dev_password@localhost:5432/blog',
  AUTH_SECRET: TEST_AUTH_SECRET,
  AUTH_URL: TEST_SITE_URL,
  AUTH_GOOGLE_ID: 'test-google-client-id',
  AUTH_GOOGLE_SECRET: 'test-google-client-secret',
  AUTH_GITHUB_ID: 'test-github-client-id',
  AUTH_GITHUB_SECRET: 'test-github-client-secret',
  AUTHOR_ALLOWLIST: `google:${TEST_GOOGLE_SUB},github:${TEST_GITHUB_ID}`,
  SITE_URL: TEST_SITE_URL,
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
  R2_BUCKET_NAME: 'blog-media',
  R2_PUBLIC_BASE_URL: 'http://localhost:9000/blog-media',
  RESEND_API_KEY: 'test-resend-key',
  CONTACT_TO_EMAIL: 'author@example.test',
  CONTACT_FALLBACK_EMAIL: 'author@example.test',
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  UPSTASH_REDIS_REST_URL: 'https://test.upstash.example',
  UPSTASH_REDIS_REST_TOKEN: 'test-upstash-token',
  UMAMI_WEBSITE_ID: 'test-website-id',
  UMAMI_SCRIPT_URL: 'https://cloud.umami.is/script.js',
  CRON_SECRET: 'test-cron-secret',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
