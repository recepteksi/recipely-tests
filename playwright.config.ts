import { defineConfig, devices } from '@playwright/test';
import { WEB_URL } from './helpers/config';

/**
 * Recipely end-to-end automation.
 *
 * Surfaces:
 *  - backend  : api.recipely.net — every service exercised over the AES-256-GCM
 *               /api/v1 encrypted envelope, PLUS plain health + static legal
 *               pages (no browser). Each backend spec runs under TWO projects:
 *                 · backend-direct — a server-to-server caller (like curl/Node).
 *                 · backend-mobile — the SAME requests carrying the React Native
 *                   app's headers (mobile User-Agent + client marker), so every
 *                   service is verified both "from the app" and "from the wire".
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
    ['./reporters/html-reporter.ts', { outputFile: 'playwright-report/recipely-report.html' }],
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
    // ---------- Backend · direct (server-to-server caller) ----------
    // The "wire" view: a plain API client with no app identity, like curl or a
    // server integration. Proves each service works for any authorized caller.
    {
      name: 'backend-direct',
      testMatch: /tests\/backend\/.*\.spec\.ts$/,
      use: {
        extraHTTPHeaders: {
          'User-Agent': 'recipely-tests/backend-direct (PlaywrightAPIRequest)',
          'X-Recipely-Client': 'backend-direct',
        },
      },
    },

    // ---------- Backend · mobile (the React Native app's requests) ----------
    // The SAME specs, but every request carries the mobile app's headers: an
    // Expo/RN user-agent and the okhttp-style client marker the app ships with.
    // This is the "called from mobile" axis — each service is verified exactly
    // as the installed app would call it.
    {
      name: 'backend-mobile',
      testMatch: /tests\/backend\/.*\.spec\.ts$/,
      use: {
        extraHTTPHeaders: {
          'User-Agent':
            'Recipely/1.0 (iPhone; iOS 17.5; Expo/RN) okhttp/4.12.0',
          'X-Recipely-Client': 'mobile-app',
          'X-Requested-With': 'net.recipely.app',
        },
      },
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
