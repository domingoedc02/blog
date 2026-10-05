# Personal Blog

A personal blog built with Next.js 15, Postgres (Neon) and TipTap.

Planning and the full specification pack live in ORBIT project **BLOG** team
memory (`spec/*`, `decision/*`, `brief/requirements`), tracked by issue
**BLOG-1**.

See [`docs/HANDBOOK.md`](docs/HANDBOOK.md) for the onboarding summary:
overview, tech stack, file structure, getting started, environment
variables, middleware/API/security flows, operations, testing and
conventions — with pointers back to the full ORBIT `spec/*` pack for detail.

## Local development

Full prerequisites, every environment variable, the exact first-run command sequence, local
service ports, seed data and troubleshooting steps are specified once in team memory
**`spec/setup`** (ORBIT, owner: devops) — this README does not duplicate them so there is one
source of truth.

Quick start once you have Docker and pnpm installed:

```bash
cp .env.example .env.local   # fill in your dev OAuth app IDs/secrets (see spec/setup)
docker compose up -d
docker compose ps            # wait until postgres and minio report "healthy"
pnpm install
pnpm db:migrate               # once BLOG-22's migrations exist
pnpm db:seed
pnpm dev
```

Then open `http://localhost:3000`. See `spec/setup` for OAuth app registration, the full env var
table, and fixes for common first-run errors.
