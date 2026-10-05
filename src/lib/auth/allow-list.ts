/**
 * The env-driven author allow-list check (decision/auth, spec/security
 * threat #2: OAuth allow-list bypass). This is a REAL, complete
 * implementation, not a stub — the allow-list comparison itself (parse
 * `AUTHOR_ALLOWLIST`, compare `provider:id` pairs) has no dependency on
 * Auth.js being configured; only *wiring it into the `signIn` callback*
 * is BLOG-18's job (Auth hardening & audit logging), which hasn't landed
 * yet. BLOG-18 should import {@link isAllowListed} from here rather than
 * re-implementing the parse/compare logic — flagged in BLOG-5's PR for
 * backend-dev to coordinate on before either side merges, per team-lead's
 * note on this issue.
 *
 * `AUTHOR_ALLOWLIST` is the actual, spec/setup-confirmed env var name — a
 * comma-separated list of `provider:id` pairs (e.g.
 * `google:109283746502938475,github:8341223`), where `id` is the
 * provider's immutable account id (Google's `sub` claim, GitHub's numeric
 * account id — never a username or email, both of which can change).
 * `decision/auth` and `spec/architecture`'s own text still reference
 * older per-provider var names (`ADMIN_GOOGLE_SUB`/`ADMIN_GITHUB_ID`) that
 * were superseded by the single `AUTHOR_ALLOWLIST` var everywhere else
 * (spec/setup's env table, and every other issue reviewed against it,
 * e.g. BLOG-19/BLOG-14) — that's a stale ADR/spec cross-reference for
 * system-architect to clean up, not something this module should follow.
 *
 * Takes the raw allow-list string as a parameter rather than importing
 * `src/lib/env.ts` directly, so it stays a pure, trivially-testable
 * function and so BLOG-18's `signIn` callback (which already has `env` in
 * scope) isn't forced through this module's import graph.
 */

export interface AllowListEntry {
  provider: string;
  id: string;
}

/** Parses `AUTHOR_ALLOWLIST`'s `provider:id,provider:id` format. Malformed entries are skipped, not thrown on. */
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
 * `true` if `provider:accountId` is in the allow-list. Fails closed: an
 * empty/missing `rawAllowList` (misconfiguration) never matches anything,
 * per spec/security's "fails closed if unset/empty" rule.
 */
export function isAllowListed(
  provider: string,
  accountId: string,
  rawAllowList: string | undefined,
): boolean {
  if (!rawAllowList) {
    return false;
  }
  return parseAllowList(rawAllowList).some(
    (entry) => entry.provider === provider && entry.id === accountId,
  );
}
