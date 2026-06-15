import { defineConfig, devices } from '@playwright/test';
import { WEB_URL } from './helpers/config';

/**
 * Recipely end-to-end automation.
 *
 * Surfaces:
 *  - backend  : api.recipely.net — health, static legal pages, and the
 *               AES-256-GCM /api/v1 encrypted envelope flow (no browser).
 *  - web      : the Firebase-hosted React Native Web build (desktop browsers).
 *  - mobile   : the same web build under iPhone / Pixel / iPad device emulation
 *               (real touch, device pixel ratio, mobile user-agent, narrow
 *               viewport). Real NATIVE mobile E2E lives in maestro/ (Maestro).
 *
 * Locale is pinned to en-US so the app renders its English i18n strings, which
 * the selectors in helpers/recipely.ts assume.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60 * 1000,
  expect: { timeout: 10 * 1000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.WORKERS ? Number(process.env.WORKERS) : undefined,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['./reporters/claude-reporter.ts'],
  ],
  use: {
    baseURL: WEB_URL,
    locale: 'en-US',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15 * 1000,
  },

  projects: [
    // ---------- Backend (API, no browser) ----------
    {
      name: 'backend',
      testMatch: /tests\/backend\/.*\.spec\.ts$/,
      use: {},
    },

    // ---------- Web / desktop ----------
    {
      name: 'desktop-chromium',
      testMatch: /tests\/web\/.*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } },
    },
    {
      name: 'desktop-firefox',
      testMatch: /tests\/web\/.*\.spec\.ts$/,
      use: { ...devices['Desktop Firefox'], viewport: { width: 1366, height: 768 } },
    },
    {
      name: 'desktop-webkit',
      testMatch: /tests\/web\/.*\.spec\.ts$/,
      use: { ...devices['Desktop Safari'], viewport: { width: 1366, height: 768 } },
    },

    // ---------- Mobile (device emulation of the web build) ----------
    {
      // iPhone — WebKit engine, closest emulation to real iOS Safari.
      name: 'mobile-iphone',
      testMatch: /tests\/web\/.*\.spec\.ts$/,
      use: { ...devices['iPhone 13'] },
    },
    {
      // Android Pixel — Chromium engine.
      name: 'mobile-pixel',
      testMatch: /tests\/web\/.*\.spec\.ts$/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'tablet-ipad',
      testMatch: /tests\/web\/.*\.spec\.ts$/,
      use: { ...devices['iPad (gen 7)'] },
    },
  ],
});
