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

// ---------------------------------------------------------------------------
// Backend route paths — mirrored 1:1 from the mobile app's
// infrastructure/constants/api.ts and the backend's presentation/routes/*.
// Every path below is RELATIVE to API_V1_URL (the encrypted /api/v1 surface),
// unless noted otherwise. Keeping them here lets a single spec drive both the
// "direct" and "mobile" backend projects without duplicating string literals.
// ---------------------------------------------------------------------------

// Auth (public — no bearer token required)
export const AUTH_LOGIN_PATH = '/auth/login';
export const AUTH_REGISTER_PATH = '/auth/register';
export const AUTH_REGISTER_VERIFY_PATH = '/auth/register/verify';
export const AUTH_REGISTER_RESEND_PATH = '/auth/register/resend';
export const AUTH_SOCIAL_PATH = '/auth/social';
export const AUTH_FORGOT_PASSWORD_PATH = '/auth/forgot-password';
export const AUTH_RESET_PASSWORD_PATH = '/auth/reset-password';

// Taxonomy catalog (auth-gated)
export const RECIPE_CUISINES_PATH = '/recipes/cuisines';
export const RECIPE_CATEGORIES_PATH = '/recipes/categories';

// Recipes (auth-gated)
export const RECIPES_PATH = '/recipes';
export const recipePath = (id: string): string => `/recipes/${id}`;
export const recipeViewPath = (id: string): string => `/recipes/${id}/view`;
export const recipeFavoritePath = (id: string): string => `/recipes/${id}/favorite`;
export const recipeLikePath = (id: string): string => `/recipes/${id}/like`;
export const recipeNutritionPath = (id: string): string => `/recipes/${id}/nutrition`;
export const recipeCommentsPath = (id: string): string => `/recipes/${id}/comments`;
export const recipeCommentPath = (id: string, commentId: string): string =>
  `/recipes/${id}/comments/${commentId}`;
export const recipeCommentLikePath = (id: string, commentId: string): string =>
  `/recipes/${id}/comments/${commentId}/like`;

// AI / expensive endpoints (auth-gated, rate-limited) — contract-tested only,
// never actually invoked against the live Gemini/Whisper backend.
export const RECIPES_GENERATE_PATH = '/recipes/generate';
export const RECIPES_IMPORT_PATH = '/recipes/import';
export const RECIPES_REFINE_PATH = '/recipes/refine';

// Drafts (auth-gated)
export const DRAFTS_PATH = '/recipes/drafts';
export const DRAFTS_LATEST_PATH = '/recipes/drafts/latest';
export const draftPath = (id: string): string => `/recipes/drafts/${id}`;

// Me (auth-gated)
export const ME_PATH = '/me';
export const ME_PROFILE_PATH = '/me/profile';
export const ME_RECIPES_PATH = '/me/recipes';
export const ME_FAVORITES_PATH = '/me/favorites';
export const ME_NOTIFICATIONS_PATH = '/me/notifications';
export const ME_NOTIFICATIONS_READ_ALL_PATH = '/me/notifications/read-all';
export const ME_DEVICE_TOKEN_PATH = '/me/device-token';

// Users (auth-gated)
export const userPath = (id: string): string => `/users/${id}`;
export const userRecipesPath = (id: string): string => `/users/${id}/recipes`;
export const userFollowPath = (id: string): string => `/users/${id}/follow`;

/** Unversioned readiness probe (plain JSON, outside /api/v1). */
export const READY_URL: string = `${API_URL}/health/ready`;
