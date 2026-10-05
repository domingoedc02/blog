import '@/styles/globals.css';
import type { Metadata } from 'next';

/**
 * Root layout for the `admin` route group — dynamic, session-gated pages.
 * Like `(public)/layout.tsx`, this is its own root layout (no shared parent
 * `app/layout.tsx`), so it owns `<html>`/`<body>` for every admin route.
 *
 * This is a dynamic-segment-config stub only: the actual session check and
 * redirect-to-`/admin/login` behaviour belongs to BLOG-18 (auth hardening)
 * and BLOG-26 (sign-in), not to this scaffolding task.
 */
export const metadata: Metadata = {
  title: 'Admin — Personal Blog',
  robots: { index: false, follow: false },
};

// Every admin page is session-dependent; never statically rendered or cached.
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
