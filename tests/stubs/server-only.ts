// Test-only stub for the `server-only` package.
//
// `server-only`'s real module throws unless resolved under Next's bundler
// "react-server" condition, which plain Vite/Node (Vitest) never sets. The
// guard it provides (don't import src/lib/env.ts from client code) is a
// build-time concern for Next's bundler, not something a unit test needs
// to re-verify, so vitest.config.ts aliases the package to this no-op here.
export {};
