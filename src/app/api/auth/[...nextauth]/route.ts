import { handlers } from '@/lib/auth/config';

// Auth.js v5 catch-all: sign-in, OAuth callbacks, session, CSRF, sign-out.
// Behaviour is configured in src/lib/auth/config.ts.
export const { GET, POST } = handlers;
