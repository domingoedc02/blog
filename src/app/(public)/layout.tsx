import '@/styles/globals.css';
import type { Metadata } from 'next';

/**
 * Root layout for the `(public)` route group — static/ISR pages, no auth,
 * no middleware beyond the global request-id + security headers. This
 * group has no shared parent `app/layout.tsx` (Next.js "multiple root
 * layouts"), so this file owns `<html>`/`<body>` for every public route.
 *
 * Minimal shell only: no header/footer/nav/Umami script yet — those land
 * with the public pages that need them (BLOG-8 and friends). Pure
 * scaffolding, per BLOG-19.
 */
export const metadata: Metadata = {
  title: 'Personal Blog',
  description: 'A personal blog.',
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
