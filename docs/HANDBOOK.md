# Developer Handbook — Personal Blog

> Source of truth: ORBIT project **BLOG**, issue **BLOG-1** (parts 1-4: BLOG-1,
> BLOG-1-1, BLOG-1-2, BLOG-1-3) and the `spec/*` team memory pack. This file is
> a working summary for anyone cloning the repo; when it and ORBIT disagree,
> ORBIT's `spec/*` memories and the issue pages are authoritative — update
> this file to match, not the other way round.

## Overview

Personal Blog (BLOG) is a single-author personal blog and portfolio site: one
Next.js 15 (App Router, TypeScript) application with two zones in one
deployable —

- a **public, SEO-optimized reading site**: home (reverse-chronological
  posts), single post, tag archive, About, Privacy, RSS feed, sitemap,
  on-site search; and
- a **private `/admin` workspace** where the one author drafts, autosaves,
  previews, publishes, edits, unpublishes, deletes (to Trash) and restores
  posts.

It runs end-to-end on managed free tiers: Vercel (Hobby) hosting, Neon
Postgres, Cloudflare R2 for images, Auth.js (Google + GitHub OAuth) for the
single admin account, Umami for cookie-free analytics, and Resend +
Cloudflare Turnstile + Upstash for the contact form. Rich text is authored in
a WYSIWYG editor (TipTap) with code blocks highlighted by Shiki.

The product's job: a durable, **ownership-first** alternative to
Medium/Substack/Ghost/WordPress.com/Hashnode/dev.to — the author's own data
(standard Postgres + S3-compatible storage), no algorithmic feed, no
paywall, fully custom design. Monetization is explicitly out of v1 scope but
the architecture must not rule it out later.

Full detail: `spec/overview` (ORBIT team memory).

## Target audience

Four personas, all anonymous/stateless except the Author:

1. **Author / Admin** (single user, one role) — solo tech/software writer,
   signs in via Google or GitHub OAuth (allow-listed), writes in a WYSIWYG
   editor, self-maintains the site after launch with no support retainer.
2. **Niche tech peers** (primary reader segment) — engineers/dev-tool users,
   want correctly highlighted code, browse by free-form tag, follow via RSS.
3. **Recruiters / potential clients** — first-time visitors from one shared
   link, often mobile, judge credibility fast; reach out via the contact
   form, not a scraped email address.
4. **General search/social visitors** — resolve one technical question;
   high bounce risk if slow or inaccessible — this is why the
   <2s/Lighthouse-90+/WCAG AA targets exist.

Full detail: `spec/overview`.

## Features

MoSCoW summary (full rationale: `spec/overview`):

- **Must** — rich-text posts with images and language-aware code blocks
  (TipTap + Shiki); draft → preview → publish with edit/unpublish
  afterward; server autosave (~30s debounced + on blur) with a
  Saved/Saving/Offline indicator; editable slugs with 301 redirects;
  soft delete to Trash (30-day restore, then purge, 410 after); free-form
  tags; About and Privacy pages; RSS feed; dark mode; contact form
  (Resend, never stored, Turnstile + rate limit); sitemap/meta/OG tags;
  OAuth sign-in (Google + GitHub, allow-listed); configurable `SITE_URL`.
- **Should** — on-site search (Postgres full-text + trigram) — first thing
  cut if the ~2026-12-04 target slips.
- **Could** — scheduled (future-dated) publishing.
- **Won't (v1)** — comments, newsletter, monetization/payments/ads, social
  auto-posting, a stored contact inbox.
- **Non-goals** — multi-author/editorial roles, reader accounts/PII/tracking
  cookies, formal compliance regimes (HIPAA/PCI/SOC2), a purchased domain or
  SLA at launch, i18n/l10n, a standalone media library.

Full detail: `spec/overview`, `brief/requirements`.

## Tech stack

| Layer | Technology | Version/tier | ADR |
|---|---|---|---|
| Language | TypeScript, strict mode | 5.x | `decision/tech-stack` |
| Framework | Next.js, App Router | 15.x (React 19) | `decision/tech-stack` |
| Hosting | Vercel Hobby — Node serverless + Edge Middleware + Vercel Cron, region **`fra1`** (EU) | Node 22 LTS | `decision/hosting`, `decision/ops-defaults` |
| Database | Neon Postgres (serverless, branching, PITR), region **`eu-central-1`** | Postgres 16 | `decision/tech-stack`, `decision/backups`, `decision/ops-defaults` |
| ORM | Drizzle ORM + drizzle-kit | latest | `decision/tech-stack` |
| DB driver | `@neondatabase/serverless` | latest | `decision/tech-stack` |
| Object storage | Cloudflare R2 (S3-compatible), EU jurisdiction, via `@aws-sdk/client-s3` | — | `decision/media-storage`, `decision/ops-defaults` |
| Image processing | `sharp` (resize to WebP, strip EXIF) | latest | `decision/media-storage` |
| Rich-text editor | TipTap (ProseMirror), restricted extension set | v2 | `decision/content-format` |
| Code highlighting | Shiki, server-side only | latest | `decision/content-format` |
| Sanitisation | `sanitize-html` (allow-list) | latest | `decision/content-format` |
| Validation | `zod` | latest | `spec/architecture` |
| Auth | Auth.js (NextAuth) v5 — Google + GitHub OAuth, JWT sessions | v5 | `decision/auth` |
| Rate limiting | Upstash Redis REST + `@upstash/ratelimit`, EU region | free tier | `decision/contact-form`, `decision/ops-defaults` |
| Bot protection | Cloudflare Turnstile | — | `decision/contact-form` |
| Email | Resend SDK | free tier | `decision/contact-form` |
| Analytics | Umami Cloud (cookie-free) | Hobby | `decision/tech-stack` |
| Search | Postgres full-text (`tsvector`) + `pg_trgm` | core extension | `decision/search` |
| Styling | Tailwind CSS | v4.x | `spec/architecture` |
| Package manager | pnpm | 9.x via Corepack | `spec/setup` |

Data region note: every stateful service — Vercel functions, Neon, R2,
Upstash — is pinned to the EU for the strongest GDPR footing (see
Operations below and `spec/architecture`).

Full detail: `spec/architecture`.

## File structure

One Next.js 15 App Router repo, pnpm, TypeScript strict:

```
drizzle/                 # drizzle-kit migration output (never hand-edited)
public/                  # static assets (favicon, default OG image)
src/
  app/
    (public)/            # static/ISR, no auth: /, /about, /privacy, /tag/[tag],
                          # /post/[slug], /search, sitemap.ts, robots.ts, rss.xml/route.ts
    admin/                # dynamic SSR, session-gated: /admin, /admin/login,
                          # /admin/posts, /admin/posts/new, /admin/posts/[id]/edit, /admin/trash
    api/
      auth/[...nextauth]/route.ts
      admin/posts/route.ts, [id]/route.ts, [id]/publish/route.ts, [id]/restore/route.ts
      admin/upload/route.ts
      contact/route.ts
      search/route.ts
      cron/backup/route.ts, cron/purge-trash/route.ts
  components/{public,admin,ui}/
  lib/
    auth/ (config.ts, allow-list.ts)
    db/ (client.ts, schema.ts, queries/{posts,tags,redirects,search}.ts)
    content/ (schema.ts, render.ts, sanitize.ts)       # shared editor+renderer contract
    storage/ (r2-client.ts, upload.ts)
    email/ (resend-client.ts)
    security/ (turnstile.ts, rate-limit.ts, origin-check.ts)
    seo/ (site-url.ts, sitemap.ts, rss.ts)
    validation/ (post.ts, contact.ts, search.ts)
    errors.ts
  middleware.ts           # request id, security headers, /admin/* session gate (Edge)
tests/{unit,integration,e2e}/
drizzle.config.ts · next.config.ts · .env.example · package.json · pnpm-lock.yaml · tsconfig.json
```

**Module boundaries**: `app/*` is routing/presentation only — all domain
logic lives in `lib/*` (framework-agnostic, testable without Next.js).
`components/*` never touches the DB. One `lib/<vendor>` module per external
integration — never a raw SDK call scattered in a route. `lib/db/schema.ts`
is the single source of truth for the data model; `lib/content/schema.ts` is
the single source of truth for allowed rich-text nodes, shared between
editor and renderer so they cannot drift. The `(public)` and `admin` route
groups are rendering-mode boundaries, not just folders.

**Where new code goes**: a new public page → `app/(public)/<path>/page.tsx`;
a new admin page → `app/admin/<path>/page.tsx` (already session-gated); a
new API endpoint → `app/api/<area>/<path>/route.ts`, validated with a
`lib/validation/*` schema and wrapped in the `lib/errors.ts` mapper; a new
table/column → edit `lib/db/schema.ts` only, then `drizzle-kit generate`.

Full detail: `spec/file-structure`.

## Getting started

Prerequisites: Node.js 22 LTS (via nvm/fnm/Volta — matches CI), pnpm 9.x via
Corepack, Docker Desktop (local Postgres 16 + MinIO as an R2 stand-in), a dev
Google OAuth client and a dev GitHub OAuth App (separate from production).

First run:

```bash
git clone https://github.com/domingoedc02/blog.git && cd blog
corepack enable && corepack use pnpm@9
cp .env.example .env.local        # fill in dev OAuth IDs/secrets, AUTH_SECRET, AUTHOR_ALLOWLIST,
                                   # MinIO + Turnstile test values — see Environment & secrets below
docker compose up -d && docker compose ps     # wait for postgres + minio "healthy"
pnpm install
pnpm db:migrate
pnpm db:seed                      # 5 tags, 2 published posts, 1 draft
pnpm dev                          # http://localhost:3000 ; /admin signs in with your allow-listed account
```

Common commands: `pnpm build` / `pnpm start` (production build/serve),
`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:generate` (new migration
from schema changes), `pnpm db:studio`, `docker compose down -v` (wipe local
data).

Full detail (local services table, seed-data contents, troubleshooting):
`spec/setup`.

## Environment & secrets

All variables live in `.env.local` (gitignored) locally and in Vercel's
encrypted env vars (Production + Preview) in deployment. `.env.example`
lists every key with a placeholder and must stay in sync.

| Name | Example | Secret? |
|---|---|---|
| `DATABASE_URL` | `postgresql://blog:...@localhost:5432/blog` | Yes |
| `AUTH_SECRET` | `npx auth secret` output | Yes |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | OAuth client | ID no / secret yes |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | OAuth App | ID no / secret yes |
| `AUTHOR_ALLOWLIST` | `google:109...,github:8341223` | No (keep out of client bundle) |
| `SITE_URL` | `https://personal-blog.vercel.app` | No |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_PUBLIC_BASE_URL` | R2 bucket, scoped to this bucket only | keys yes |
| `RESEND_API_KEY` / `CONTACT_TO_EMAIL` / `CONTACT_FALLBACK_EMAIL` | contact delivery | key yes |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | bot protection (local uses Cloudflare's published always-pass test keys) | secret yes |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | rate limiting | token yes |
| `UMAMI_WEBSITE_ID` / `UMAMI_SCRIPT_URL` | analytics | No |
| `CRON_SECRET` | Vercel auto-injects `Authorization: Bearer <value>` on its own cron calls | Yes |

Rules (`spec/security` Secrets management): secrets are read only inside
Route Handlers/Server Actions/Server Components guarded by
`import "server-only"`; never logged (logger carries a redaction list);
never returned in any client payload; never prefixed `NEXT_PUBLIC_*` except
the Turnstile site key and the Umami website ID. Preview deployments use
their own non-production OAuth app and test keys, never production secrets.
Rotation: `AUTH_SECRET` regeneration invalidates every session at once (the
documented incident response for a suspected compromise); OAuth client
secrets rotate in the provider's own console; the R2 token is scoped to one
bucket so it can be rotated without touching other buckets.

Full detail: `spec/setup`, `spec/security`.

## Middleware

Two pipelines. Public content pages (`(public)/*`) carry **none** of this —
static/ISR HTML served from the CDN with no per-request server logic. The
chain below applies only to `/admin/*` pages and every `/api/*` route.
Execution order, each step either passing through or short-circuiting:

1. **Request ID** (`src/middleware.ts`) — `crypto.randomUUID()` if
   `x-request-id` isn't set; never refuses.
2. **Logging** — `withLogging` logs `{requestId, method, path, status, durationMs}`.
3. **Security headers / CSP** — `next.config.ts` + `middleware.ts`: CSP,
   `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
   `Referrer-Policy`, `Permissions-Policy`, HSTS.
4. **Body limit** — 1 MB (admin/content JSON), 200 KB (`/api/contact`),
   8 MB (`/api/admin/upload`) → **413** over.
5. **Rate limit** — Upstash sliding window by IP+route (`/api/contact`
   5/10min, `/api/search` 30/min, `/api/admin/upload` 20/hr-per-session) →
   **429** + `Retry-After`.
6. **Session / auth (Auth.js)** — verifies the signed JWT cookie, required
   for every `/admin/*` and `/api/admin/*` call → page redirects to
   `/admin/login`, API returns **401**.
7. **CSRF / origin check** — for state-changing requests, `Origin`
   (fallback `Referer`) must equal `SITE_URL`'s origin → **403** on
   mismatch.
8. **Authorization (allow-list)** — re-checks the session's
   provider+account-ID against the allow-list even though `signIn` already
   checked it at login (defence in depth) → **403**.
9. **Validation (zod)** — the route's schema parses body/query → **400**
   with `{error:{code:"validation_error",...}}`.
10. **Handler** — actual business logic.
11. **Error mapper** (`lib/errors.ts` `toErrorResponse`) — known error
    classes map to their status (`ValidationError`→400, `AuthError`→401,
    `ForbiddenError`→403, `NotFoundError`→404, `RateLimitError`→429);
    anything unexpected → **500**, real error/stack only in the log line
    keyed by `requestId`.

`/api/auth/[...nextauth]` only runs steps 1-3 plus Auth.js's own internal
handling.

Full detail: `spec/architecture` (Request pipeline & middleware).

## API structure

REST-ish JSON over Next.js Route Handlers, no gateway, no URL versioning.
Three zones: `/api/admin/*` (author-only, session-gated), `/api/auth/*`
(Auth.js v5's own catch-all), and public unauthenticated (`/api/contact`,
`/api/search`; feeds `/rss.xml`, `/sitemap.xml`, `/robots.txt` are public ISR
routes, not under `/api`).

| Method · Path | Auth | Notes |
|---|---|---|
| `GET/POST /api/admin/posts` | admin | list / create draft |
| `GET/PATCH/DELETE /api/admin/posts/:id` | admin | fetch / partial update / trash |
| `POST /api/admin/posts/:id/autosave` | admin | title/excerpt/contentJson only, last-write-wins |
| `POST /api/admin/posts/:id/publish` \| `/unpublish` | admin | idempotent, triggers `revalidateTag` fan-out |
| `GET /api/admin/trash` \| `POST .../trash` \| `POST .../restore` | admin | restore returns `410` if already purged |
| `PATCH /api/admin/posts/:id/slug` | admin | writes `post_slug_redirects`, `409` on collision |
| `GET /api/admin/tags` | admin | prefix-match autocomplete |
| `POST /api/admin/upload` | admin | multipart, `413`/`422` on bad file |
| `POST /api/contact` | none | `202`, `400`/`429`/`502` |
| `GET /api/search` | none | `200 {results}` capped at 20 |
| `GET /rss.xml` \| `/sitemap.xml` \| `/robots.txt` | none | public ISR, not under `/api` |

Error envelope on every non-2xx response:
`{"error":{"code":"SLUG_CONFLICT","message":"...","details":{}}}`.

Full detail (full HTTP-code table, pagination/idempotency rules): `spec/api`.

## API flows

Server-side request→DB/vendor→response sequences:

- **`GET /api/search`**: rate-limit → validate `q` (2-100 chars) →
  `ts_rank`+trigram ranked query (`status='published'` only, capped 20) →
  `200`.
- **`POST /api/contact`**: rate-limit (5/10min/IP) → honeypot + field
  validation → Turnstile `siteverify` → Resend send (author `to`, submitter
  `reply-to`) → `202`, or `502` on Resend failure (logged, no message
  content).
- **OAuth handshake**: consent screen → callback with auth code → Auth.js
  exchanges for profile → `signIn` callback compares provider account ID to
  the allow-list → match issues a signed JWT cookie, redirect to `/admin`;
  no match → `AccessDenied`, no session/record created.
- **`POST /api/admin/posts`**: generate kebab-case slug (numeric suffix on
  collision) → insert draft row → `201`.
- **`POST .../autosave`**: validate `contentJson` against shared TipTap
  schema → direct update, bump `updated_at` → `200 {savedAt}`.
- **`POST /api/admin/upload`**: session rate limit → magic-byte MIME sniff
  → size ≤8MB → `sharp` decode → dimension ≤4000px → resize ≤2000px/WebP/
  strip EXIF → R2 `PutObject` → insert `media` row → `201`.
- **`POST .../publish`**: validate non-empty title/content → set
  `status='published'`, `published_at` if null → synchronous
  `revalidateTag` fan-out → `200`.
- **Unpublish/Trash/Restore**: single-field state change → same
  `revalidateTag` fan-out → `200`, or `410` from restore if already purged.
- **`PATCH .../slug`**: format validate → collision check against live
  slugs and redirects → transactional slug update + redirect-row insert →
  dual revalidation → `200 {slug, redirectedFrom}`.

Full detail: `spec/flows/api`.

## User flows

Fifteen flows (full numbered detail: `spec/flows/user`):

1. Reader reads the home page (`GET /`, ISR-cached, reverse-chronological).
2. Reader reads a single post (`GET /[slug]`): live slug → serve; else
   check `post_slug_redirects` → `301`; else check `gone_slugs` → `410`;
   else `404`.
3. Reader browses by tag (`GET /tags/[tag]`).
4. Reader subscribes via RSS (`GET /rss.xml`).
5. Reader searches (`GET /api/search`, Should-have).
6. Reader submits the contact form, including the `502`→`mailto:` fallback.
7. Author signs in via OAuth, including the allow-list reject path.
8. Author creates/edits a post with autosave, including offline-retry,
   crash recovery (reloads last **server-saved** draft) and the unsaved-
   changes warning backstop.
9. Author uploads an image, including every validation failure.
10. Author publishes a post (blocked client- and server-side if title/
    content missing).
11. Author unpublishes a post (public route then `404`s, not `410`).
12. Author changes a slug after publish → `301` on the old URL.
13. Author deletes a post → Trash → 30-day window → purge cron → `410`
    forever via `gone_slugs`.
14. Author restores a post from Trash within 30 days, or `410 GONE` if
    already purged.
15. Author manages tags (autocomplete + normalise-and-upsert; no tag-delete
    UI in v1).

Background jobs (daily backup export, daily trash purge, event-driven ISR
revalidation) and the cross-cutting failure-path table:
`spec/flows/jobs-failures`.

## Security flow

Single role (`author`), OAuth-only (Google **and** GitHub) via Auth.js v5 —
no passwords anywhere.

**Sign-in**: unauthenticated `/admin` → redirect to `/admin/login` → author
picks a provider → consent screen → callback with an auth code → Auth.js
exchanges it for the profile → `signIn` callback compares the provider's
**account ID** (not email) against the allow-list → match issues a signed
JWT session (`httpOnly`, `Secure`, `SameSite=Lax`) and the attempt is audit-
logged; no match → `AccessDenied`, no session/record created.

**Session**: JWT (stateless) — `maxAge` 30 days, `updateAge` 24h. No roles
claim — exactly one role exists. Revocation has no per-session mechanism;
incident response for a stolen session is rotating `AUTH_SECRET`.

**Authorization matrix**: Anonymous may view published content and submit
contact form/search; everything under `/admin/*` and `/api/admin/*` is
Author-only; cron routes are callable by neither role — only Vercel Cron's
`CRON_SECRET` header. Every `/api/admin/*` handler re-checks the session
server-side on each call.

**Top STRIDE threats** (full detail: `spec/security/threat-model`):
stored XSS via rich text; OAuth allow-list bypass; CSRF on admin mutations;
upload abuse/SSRF/polyglot images; contact-form spam/header injection;
secrets leak; open redirect via slug table; draft/trash leakage via ISR;
session hijacking; repudiation; backup/cron abuse; dependency supply-chain
compromise.

Full detail: `spec/security`, `spec/security/threat-model`.

## Security setup

Checklist before first production deploy (`spec/security` Security setup
checklist):

- [ ] `AUTH_SECRET` freshly generated for Production.
- [ ] Google + GitHub OAuth apps created with exact production callback
      URLs; secrets in Vercel env.
- [ ] Admin allow-list set to the author's real provider account IDs; both
      an accept and a reject path verified.
- [ ] `DATABASE_URL` points at the Neon production branch with
      `sslmode=require`.
- [ ] R2 bucket's API token scoped to that bucket only.
- [ ] `RESEND_API_KEY` is a production key, end-to-end send verified;
      Turnstile keys are the production pair.
- [ ] `CRON_SECRET` set; both cron jobs confirmed to send it.
- [ ] `SITE_URL` set to the real production URL.
- [ ] CSP/HSTS/security headers verified on a live response; no CSP
      console violations.
- [ ] `robots.txt` disallows `/admin` and `/api`; `/admin` confirmed
      inaccessible without a session.
- [ ] A draft post confirmed `404` publicly; a trashed/purged post
      confirmed `410`.
- [ ] Dependency audit clean; Dependabot/Renovate enabled.
- [ ] A backup export restored once into a scratch Neon branch.
- [ ] Privacy page text matches the client's answers and names Resend/
      Turnstile/Umami as processors.

Full detail: `spec/security`.

## Operations

**Environments**: Local (Docker Postgres+MinIO) · Preview (every PR, a Neon
branch per PR, shared R2 bucket) · Production (`main` branch, Neon `main`,
R2 `blog-media`). **Data region**: every environment's stateful services are
pinned to the EU — Vercel `fra1`, Neon `eu-central-1` (Preview and
Production branches alike), R2 EU jurisdiction, Upstash EU — the strongest
GDPR footing, with the accepted trade-off of slightly higher latency for US
readers on uncached requests (mitigated by CDN/ISR caching).

**CI/CD**: GitHub Actions on every push/PR — lint → typecheck → test
(disposable Postgres 16 service container) → build → `drizzle-kit check`
(migration-drift dry-run) → `pnpm audit --prod` + `gitleaks`. Merge to
`main` is branch-protected on this passing. A separate Lighthouse CI run
asserts Performance/Accessibility/Best-Practices/SEO ≥90 on every preview
deploy. Vercel's own build runs `pnpm db:migrate && pnpm build` with the
environment-scoped `DATABASE_URL`. Renovate runs weekly.

**Deployment & rollback**: push to `main` → Vercel builds and atomically
swaps traffic. App-code rollback: promote a previous deployment or
`vercel rollback <url>` — seconds, no rebuild. Migrations are forward-only
and additive so a rollback still works against the current schema. A bad
migration: promote the previous deployment, then Neon PITR to a new branch,
verify, re-point `DATABASE_URL`, redeploy.

**Observability**: Vercel Runtime Logs (short retention, not the system of
record); UptimeRobot (5-min interval) polls `/api/health` and the homepage;
no dedicated APM/error-tracking vendor in v1 (Sentry free tier is the
documented first addition if needed).

**Backup & restore**: RPO ≤24h worst case; RTO target ≤2h. Daily cron at
03:00 UTC exports `posts`/`tags`/`post_tags` + a media manifest to
`backups/<date>.sql.gz` in R2, 30-day retention. Restore drill: Neon PITR to
a new branch, or `psql` the latest `.sql.gz`, verify, re-point
`DATABASE_URL`, redeploy.

**Cost**: target $0/month at ~10,000 visits/month and 2 posts/month — every
vendor sits on an always-free tier at this scale.

Full detail: `spec/operations`.

## Testing

Risk-based. Three disproportionate-risk areas get the deepest coverage:
**content loss** (autosave, draft/publish/trash lifecycle, slug redirects),
**injection via rich text** (TipTap JSON rendered to HTML on every view),
**public-surface abuse** (contact form, OAuth allow-list).

- **Unit** (Vitest) — pure functions; ≥85% line/branch on `lib/`/`server/`;
  **100%** on the sanitiser and the auth allow-list callback.
- **Integration** (Vitest + testcontainers Postgres 16) — anything touching
  Drizzle+Postgres; every query function gets ≥1 test; every lifecycle
  transition gets a positive and negative test.
- **E2E** (Playwright, OAuth mocked via a non-production test backdoor) —
  full author/reader/contact/auth journeys; minimum 12 e2e specs for
  Must-scope flows.
- **Accessibility** (`@axe-core/playwright`) — every page template, both
  themes, zero violations at `wcag2a`/`wcag2aa` (minimum 22 axe runs).
- **Performance** (Lighthouse CI, mobile-throttled 4G) — ≥90 across the
  board, LCP <2.5s, total load <2s; blocks merge for `app/(public)/**`,
  sanitisation, or rendering/image code changes.
- **Security tests** — ≥30-payload XSS corpus against the sanitiser; CSRF/
  Origin-check tests; rate-limit boundary tests; auth allow-list bypass
  matrix; upload-abuse matrix.

**AC style**: Given/When/Then, each mapped to a named test — never "works
correctly."

**Definition of Done**: every AC has a passing named test; coverage
thresholds hold; integration suite green; relevant e2e green against
Preview; zero axe violations; Lighthouse budgets pass; security tests
re-run for anything touching rich text/uploads/auth/contact; no real PII in
any fixture/log; a non-author reviewer approved; `issues.log_work`
recorded.

Full detail: `spec/testing`.

## Conventions

**Branching & commits** — trunk-based; `main` always deployable. Branch
naming `blog-<issue-number>-<slug>` (must contain the issue key), e.g.
`blog-14-tiptap-editor-schema`. One branch per issue, never shared.
Conventional Commits with a scope and a `Refs: BLOG-NN` footer. Squash merge
only; branch deleted after merge; `main` never force-pushed.

**Code review** — exactly one reviewer per PR, not its author; any issue
labelled `security` is reviewed by security-eng, no exception. 10-point
checklist: builds/typechecks/lints clean; matches the issue's AC; no
`any`/unchecked `as`/un-commented `@ts-ignore`; every external input
validated with zod at the boundary; no secret in the diff, new env vars
added to `.env.example` + `spec/setup`; DB changes ship a migration in the
same PR, reviewed for reversibility; rich-text/UGC never reaches the client
unsanitised; new UI meets WCAG 2.1 AA basics; tests exist and pass; no
`console.log`/dead code/unlinked TODO. Turnaround: respond within 1 business
day.

**Definition of Ready** — plan approved by every planner but the author; in
an active sprint; design approved for any UI-epic issue; AC in
Given/When/Then; estimate set; assignee and reviewer both set and
different; dependencies named and linked or resolved; no open blocking
question.

**Coding standards** — TypeScript strict (`noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), no `any`; ESLint + Prettier
(`semi:true, singleQuote:true, trailingComma:"all", printWidth:100,
tabWidth:2`) as pre-commit/CI gates; `kebab-case.ts` files, `PascalCase`
components, `camelCase` functions/variables, `snake_case` DB columns mapped
via Drizzle; default to Server Components, `"use client"` only at the
interactive leaf; Server Actions are the only way admin mutations happen
(API routes reserved for things that need a URL); every boundary crossing
validated with zod; Server Actions return a discriminated
`{ok,data}|{ok:false,error}` result; no empty `catch {}`.

Full detail: `spec/conventions`.

## Glossary

- **ISR** — Incremental Static Regeneration.
- **PITR** — Point-In-Time Restore (Neon's continuous backup feature).
- **STRIDE** — the threat-modelling taxonomy used in
  `spec/security/threat-model`.
- **Allow-list** — the env-configured set of OAuth provider+account-ID
  pairs permitted to hold the single `author` role; fails closed.
- **Turnstile** — Cloudflare's CAPTCHA alternative, verified server-side.
- **Trash / soft delete** — `posts.deleted_at` set; restorable for 30 days,
  then hard-deleted by the purge cron.
- **Tombstone (`gone_slugs`)** — a row kept after hard delete so its URL
  still returns 410 forever.
- **Redirect (`post_slug_redirects`)** — a row recording a post's retired
  slug, so the old URL 301s to the current one.
- **R2** — Cloudflare's S3-compatible object storage.
- **TipTap / ProseMirror** — the WYSIWYG editor framework and its
  underlying document-model library; posts stored as ProseMirror JSON.
- **Shiki** — server-side syntax highlighter; no client-side highlighter JS.
- **Allow-list sanitiser** — `sanitize-html` configured to permit only an
  explicit set of tags/attributes/URL schemes.

## Spec index

| Key | Owner | Covers |
|---|---|---|
| `brief/requirements` | project-manager | Signed-off goal, personas, MoSCoW scope, non-goals, constraints, NFRs, timeline, success metrics, risks |
| `spec/overview` | business-researcher | Product, target audience, personas, problem, MoSCoW features, non-goals, success metrics |
| `spec/architecture` | system-architect | Tech stack, system context, containers, components, request pipeline & middleware, integrations, quality attributes |
| `spec/file-structure` | system-architect | Repository layout, module boundaries, naming conventions, where new code goes |
| `spec/data-model` | system-architect | Entities (`posts`, `post_slug_redirects`, `tags`, `post_tags`, `media`, `gone_slugs`), relationships, keys & constraints, migrations, personal data, lifecycle & retention |
| `spec/api` | system-architect | Style & versioning, authentication, every endpoint's request/response/errors, pagination, idempotency & rate limits |
| `spec/flows` (+ `/user`, `/api`, `/jobs-failures`) | business-researcher | Every user flow, every API-level sequence, background jobs, the cross-cutting failure-path table |
| `spec/security` (+ `/threat-model`) | security-eng | STRIDE threat model, auth flow, session/token handling, authorization matrix, headers, secrets, input validation, rate limits, audit logging, setup checklist |
| `spec/setup` | devops | Prerequisites, env vars, first run, local services (Docker Postgres+MinIO), seed data, commands, troubleshooting |
| `spec/operations` | devops | Environments, CI/CD pipeline, deployment & rollback, observability, backup & restore, cost |
| `spec/testing` | tester | Strategy, test levels, test data, AC style, Definition of Done |
| `spec/conventions` | team-lead | Branching & commits, code review, Definition of Ready, coding standards |

Decision records (ADRs) referenced throughout: `decision/tech-stack`,
`decision/hosting`, `decision/auth`, `decision/content-format`,
`decision/media-storage`, `decision/rendering-caching`, `decision/search`,
`decision/contact-form`, `decision/backups`, `decision/ops-defaults`,
`decision/design-system`.
