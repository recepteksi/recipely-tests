import fs from 'fs';
import path from 'path';

/**
 * Central configuration for the Recipely test suite. Reads overrides from the
 * process environment (and a local `.env` if present), falling back to the
 * production targets so the suite runs with zero configuration.
 *
 * No external dotenv dependency — a tiny KEY=VALUE parser keeps the project
 * install lean (only @playwright/test + typescript).
 */

function loadDotEnvOnce(): void {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    // process.env wins over .env so CI/inline overrides take precedence.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnvOnce();

const stripTrailingSlash = (u: string): string => u.replace(/\/+$/, '');

/** Canonical public web origin under test (Firebase Hosting). */
export const WEB_URL: string = stripTrailingSlash(
  process.env.RECIPELY_WEB_URL ?? 'https://recipely.net',
);

/** Backend server root (bare host:port, no version prefix). */
export const API_URL: string = stripTrailingSlash(
  process.env.RECIPELY_API_URL ?? 'https://api.recipely.net',
);

/** Unversioned health endpoint, mounted on the Express app root. */
export const HEALTH_URL: string = `${API_URL}/health`;

/** Versioned API root — every encrypted /api/v1 route lives under here. */
export const API_V1_URL: string = `${API_URL}/api/v1`;

/** Public legal pages served as static HTML at the server root. */
export const PRIVACY_URL: string = `${API_URL}/privacy`;
export const TERMS_URL: string = `${API_URL}/terms`;

/**
 * AES-256-GCM key for the /api/v1 envelope. The all-zeros default matches the
 * app's dev fallback; deep data-exchange tests need the real backend key here.
 */
export const API_AES_KEY_HEX: string = (
  process.env.RECIPELY_API_AES_KEY ??
  '0000000000000000000000000000000000000000000000000000000000000000'
).toLowerCase();

/** True when a real (non dev-default) AES key is configured. */
export const HAS_REAL_AES_KEY: boolean =
  API_AES_KEY_HEX !== '0'.repeat(64) && /^[0-9a-f]{64}$/.test(API_AES_KEY_HEX);

/** Optional real account credentials for authenticated flows. */
export const TEST_EMAIL: string = process.env.RECIPELY_TEST_EMAIL ?? '';
export const TEST_PASSWORD: string = process.env.RECIPELY_TEST_PASSWORD ?? '';

/** True when both credentials are present, gating logged-in flow tests. */
export const HAS_TEST_ACCOUNT: boolean =
  TEST_EMAIL.length > 0 && TEST_PASSWORD.length > 0;

// Backend route paths mirrored from infrastructure/constants/api.ts.
export const AUTH_LOGIN_PATH = '/auth/login';
export const AUTH_REGISTER_PATH = '/auth/register';
export const AUTH_FORGOT_PASSWORD_PATH = '/auth/forgot-password';
export const RECIPE_CUISINES_PATH = '/recipes/cuisines';
export const RECIPE_CATEGORIES_PATH = '/recipes/categories';
