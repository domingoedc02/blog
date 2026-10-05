import { defineConfig, devices } from "@playwright/test";

// Base URL is parameterized from the triggering deployment: e2e.yml sets
// PLAYWRIGHT_BASE_URL to the Vercel preview's target_url on a PR run, or to
// the production URL on the main-push/nightly full-matrix run. Locally it
// falls back to the dev server.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// e2e.yml always passes --project explicitly (chromium only on PR preview
// runs, chromium+webkit+firefox on main/nightly), so every project below is
// defined but none is implicitly "default" -- the CI trigger decides which
// run.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
