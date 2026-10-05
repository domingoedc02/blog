import { env } from '@/lib/env';

/**
 * The author allow-list (decision/auth, spec/security threat #2: OAuth
 * allow-list bypass). One implementation, used by both enforcement points:
 *
 * - the Auth.js `signIn` callback (src/lib/auth/callbacks.ts) — the only
 *   place identity is authorised at sign-in, and
 * - the defensive re-check on every admin request
 *   (src/lib/auth/session.ts → src/middleware.ts, and BLOG-29's per-handler
 *   re-check), which catches a token issued before the allow-list changed.
 *
 * `AUTHOR_ALLOWLIST` (spec/setup) is ONE comma-separated list of
 * `provider:id` pairs, e.g. `google:109283746502938475,github:8341223`, where
 * `id` is the provider's immutable account id — Google's `sub`, GitHub's
 * numeric account id. Never an email or a username: both can change or be
 * reused. One value is shared by preview and production
 * (decision/ops-defaults).
 *
 * Providers are allow-listed independently (OR, not AND): a sign-in needs
 * only its own provider's entry to be present and to match.
 *
 * Fail closed: an unset/empty allow-list, or one with no entry for a
 * provider, matches nothing for that provider — a misconfigured deploy is
 * loudly broken (nobody can sign in), never silently open.
 */

export const AUTH_PROVIDERS = ['google', 'github'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export function isAuthProvider(value: unknown): value is AuthProvider {
  return typeof value === 'string' && (AUTH_PROVIDERS as readonly string[]).includes(value);
}

export interface AllowListEntry {
  provider: string;
  id: string;
}

/** Parses `provider:id,provider:id`. Malformed entries are skipped, never thrown on, and never widen the list. */
export function parseAllowList(rawAllowList: string): AllowListEntry[] {
  return rawAllowList
    .split(',')
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0)
    .map((pair) => {
      const separatorIndex = pair.indexOf(':');
      if (separatorIndex === -1) {
        return null;
      }
      const provider = pair.slice(0, separatorIndex).trim();
      const id = pair.slice(separatorIndex + 1).trim();
      return provider && id ? { provider, id } : null;
    })
    .filter((entry): entry is AllowListEntry => entry !== null);
}

/**
 * The pure comparison, with the raw allow-list passed in. Exported for the
 * fail-closed unit tests and for callers that already hold the value; app
 * code should call {@link isAllowListed}.
 */
export function matchesAllowList(
  provider: string,
  accountId: string,
  rawAllowList: string | undefined,
): boolean {
  if (!rawAllowList || !isAuthProvider(provider) || accountId.length === 0) {
    return false;
  }
  return parseAllowList(rawAllowList).some(
    (entry) => entry.provider === provider && entry.id === accountId,
  );
}

/** `true` only if `provider:accountId` is in `AUTHOR_ALLOWLIST` (read through src/lib/env.ts). */
export function isAllowListed(provider: AuthProvider, accountId: string): boolean {
  return matchesAllowList(provider, accountId, env.AUTHOR_ALLOWLIST);
}
