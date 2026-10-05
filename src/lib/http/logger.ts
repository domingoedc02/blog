import 'server-only';

import pino from 'pino';

/**
 * One structured JSON logger for every Route Handler, per spec/security's
 * audit-logging note ("e.g. pino") and spec/architecture's request
 * pipeline step 2. `src/lib/http/with-route.ts` is the only caller — it
 * emits exactly one line per request: `{requestId, method, path, status,
 * durationMs}` on success, the same shape plus `err` on failure.
 *
 * Destination/retention beyond Vercel's own platform log capture is
 * devops's call (spec/operations) — this module only shapes the line, it
 * doesn't ship it anywhere itself.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
});
