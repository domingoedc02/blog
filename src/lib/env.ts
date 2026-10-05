import 'server-only';
import { z } from 'zod';

/**
 * The full environment-variable surface for the app (spec/setup), validated
 * once at module load. Every other module reads env through this typed
 * object — never `process.env.X` directly (spec/file-structure, "new
 * environment variable" rule) — so a missing or malformed value fails the
 * boot immediately instead of surfacing as an `undefined` deep in a request.
 *
 * `R2_ENDPOINT` is local-only (points the S3 client at MinIO instead of the
 * real R2 endpoint) and so is optional. Everything else listed in
 * spec/setup's env table is required in every environment.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  AUTH_SECRET: z.string().min(1, 'AUTH_SECRET is required'),
  AUTH_URL: z.string().url().optional(),
  AUTH_GOOGLE_ID: z.string().min(1, 'AUTH_GOOGLE_ID is required'),
  AUTH_GOOGLE_SECRET: z.string().min(1, 'AUTH_GOOGLE_SECRET is required'),
  AUTH_GITHUB_ID: z.string().min(1, 'AUTH_GITHUB_ID is required'),
  AUTH_GITHUB_SECRET: z.string().min(1, 'AUTH_GITHUB_SECRET is required'),
  AUTHOR_ALLOWLIST: z.string().min(1, 'AUTHOR_ALLOWLIST is required'),

  SITE_URL: z.string().url('SITE_URL must be a valid URL'),

  R2_ACCOUNT_ID: z.string().min(1, 'R2_ACCOUNT_ID is required'),
  R2_ACCESS_KEY_ID: z.string().min(1, 'R2_ACCESS_KEY_ID is required'),
  R2_SECRET_ACCESS_KEY: z.string().min(1, 'R2_SECRET_ACCESS_KEY is required'),
  R2_BUCKET_NAME: z.string().min(1, 'R2_BUCKET_NAME is required'),
  R2_PUBLIC_BASE_URL: z.string().url('R2_PUBLIC_BASE_URL must be a valid URL'),
  R2_ENDPOINT: z.string().url().optional(),

  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  CONTACT_TO_EMAIL: z.string().email('CONTACT_TO_EMAIL must be a valid email'),
  CONTACT_FALLBACK_EMAIL: z.string().email('CONTACT_FALLBACK_EMAIL must be a valid email'),

  TURNSTILE_SITE_KEY: z.string().min(1, 'TURNSTILE_SITE_KEY is required'),
  TURNSTILE_SECRET_KEY: z.string().min(1, 'TURNSTILE_SECRET_KEY is required'),

  UPSTASH_REDIS_REST_URL: z.string().url('UPSTASH_REDIS_REST_URL must be a valid URL'),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1, 'UPSTASH_REDIS_REST_TOKEN is required'),

  UMAMI_WEBSITE_ID: z.string().min(1, 'UMAMI_WEBSITE_ID is required'),
  UMAMI_SCRIPT_URL: z.string().url('UMAMI_SCRIPT_URL must be a valid URL'),

  CRON_SECRET: z.string().min(1, 'CRON_SECRET is required'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses `process.env` against {@link envSchema}. Throws a `ZodError`
 * naming every missing/invalid field — called once, at module load, so a
 * misconfigured deploy fails at boot rather than mid-request.
 */
function loadEnv(): Env {
  return envSchema.parse(process.env);
}

export const env: Env = loadEnv();
