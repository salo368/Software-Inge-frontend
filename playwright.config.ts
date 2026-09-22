/**
 * Playwright config for the frontend E2E suite.
 *
 * The suite runs against a live deployed environment (dev CloudFront)
 * -- there's no dev server started here, because standing up all four
 * blocks + a mock backend + all the AWS deps would be worse than
 * paying the 30-90s ceremony cost against real infrastructure. The
 * `FRONTEND_BASE_URL` env var points at the CloudFront distribution;
 * missing env vars are diagnosed by the tests themselves so `pw test`
 * gives a friendly error instead of `Cannot POST undefined/...`.
 *
 * Runs
 * ----
 *
 *   local  npm run e2e            -- interactive, headed, 1 worker
 *   ci     CI=true npx playwright test  -- headless, no retries yet
 *                                          (see FIXME below)
 */
import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from repo root so devs don't have to remember to export
// FRONTEND_BASE_URL etc. before each run. CI passes them via the job
// env directly and dotenv silently no-ops when the file is missing.
dotenv.config({ path: path.join(__dirname, 'e2e', '.env') });

const CI = !!process.env['CI'];

export default defineConfig({
  testDir: './e2e/specs',
  timeout: 5 * 60_000,     // full ceremony can take 3 min on cold-starts
  expect: { timeout: 15_000 },
  fullyParallel: false,    // both specs mutate real backend state
  workers: 1,
  reporter: CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'e2e/report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  // We are hitting a real API; retrying blindly can double-charge tests
  // that mutate rows. Rerun manually if flakes appear.
  retries: 0,
  use: {
    baseURL: process.env['FRONTEND_BASE_URL'],
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
