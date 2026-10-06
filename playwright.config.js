import { defineConfig } from '@playwright/test'

// The end-to-end suite drives the real React app in the Chrome already installed on this
// machine (channel: 'chrome'), so no browser binary is downloaded.
//
// Both servers are started by Playwright. The backend runs on its own port against its own
// disposable database, and the Vite dev server is told to proxy /api at that instance.
const E2E_BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 5097)
const E2E_DB = 'archai_it_e2e'

export default defineConfig({
  testDir: './e2e',
  // Each spec gets a clean browser context, so a signed-in session cannot leak into the
  // next test the way it did in the integration suite.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 60000,
  expect: { timeout: 15000 },

  globalSetup: './e2e/global-setup.js',
  globalTeardown: './e2e/global-teardown.js',

  use: {
    baseURL: 'http://127.0.0.1:5174',
    channel: 'chrome',
    headless: true,
    // A fixed viewport keeps canvas and chart rendering deterministic across runs.
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15000,
    navigationTimeout: 30000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  webServer: [
    {
      // dotenv does not override variables already present in the environment, so naming the
      // database here is enough to keep the run off the development database. The remaining
      // values still come from backend/.env, which is where the credentials live.
      command: 'node src/server.js',
      cwd: './backend',
      url: `http://127.0.0.1:${E2E_BACKEND_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        NODE_ENV: 'test',
        PORT: String(E2E_BACKEND_PORT),
        DB_NAME: E2E_DB,
        // A throwaway signing key: tokens minted here must not be valid anywhere else.
        JWT_SECRET: 'e2e-only-signing-key',
        BCRYPT_ROUNDS: '4',
        LOG_REQUESTS: 'false',
        // No outbound advisor calls from an end-to-end run.
        GEMINI_API_KEY: '',
      },
    },
    {
      // Pinned to the IPv4 loopback explicitly. Left to itself Vite binds "localhost", which on
      // this machine resolves to ::1 only, so Playwright's readiness probe against
      // 127.0.0.1 never connected even though the log said "ready".
      command: 'node node_modules/vite/bin/vite.js --port 5174 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 120000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        API_PROXY_TARGET: `http://127.0.0.1:${E2E_BACKEND_PORT}`,
      },
    },
  ],
})