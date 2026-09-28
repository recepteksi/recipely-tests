import { test as base, type APIRequestContext } from '@playwright/test';
import { RecipelyApi } from './api';
import {
  AUTH_LOGIN_PATH,
  RECIPES_PATH,
  recipePath,
  TEST_EMAIL,
  TEST_PASSWORD,
  HAS_TEST_ACCOUNT,
  HAS_REAL_AES_KEY,
} from './config';

/**
 * Authentication + disposable-fixture helpers for the authenticated backend
 * specs.
 *
 * Every `/api/v1` route except the public `/auth/*` endpoints requires a JWT
 * bearer token, and the token only decrypts/encrypts correctly when the REAL
 * backend AES key is configured. So all authenticated coverage is gated behind
 * {@link CAN_RUN_AUTHED}: with a real key + a real test account the suite drives
 * full create→read→mutate→delete lifecycles; otherwise those specs skip with a
 * clear reason instead of producing false failures.
 */

/** The session returned by a successful login. */
export interface Session {
  token: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    bio: string | null;
    photoUrl: string | null;
    role: string;
    createdAt: string;
  };
}

/** True only when authenticated flows can actually exercise the backend. */
export const CAN_RUN_AUTHED: boolean = HAS_REAL_AES_KEY && HAS_TEST_ACCOUNT;

/** Human-readable reason used in `test.skip(...)` when auth is unavailable. */
export const AUTH_SKIP_REASON =
  'Authenticated backend flow needs RECIPELY_API_AES_KEY (real key) + ' +
  'RECIPELY_TEST_EMAIL/PASSWORD. See .env.example.';

/**
 * Logs the configured test account in and returns its session. Throws on any
 * non-200 so a misconfigured account surfaces loudly rather than as a cascade
 * of downstream auth failures.
 */
export async function login(request: APIRequestContext): Promise<Session> {
  const api = new RecipelyApi(request);
  const result = await api.post(AUTH_LOGIN_PATH, {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });
  if (result.status !== 200) {
    throw new Error(
      `Login failed (${result.status}). Check RECIPELY_TEST_EMAIL/PASSWORD and ` +
        `RECIPELY_API_AES_KEY. decryptError=${result.decryptError ?? 'none'}`,
    );
  }
  // The decrypted body is `{ data: { token, user } }` — token and the user
  // object are siblings, not a flattened record.
  const data = (result.decrypted as { data?: { token?: string; user?: Session['user'] } })?.data;
  if (!data?.token || !data.user) {
    throw new Error('Login response had no token/user — unexpected payload shape.');
  }
  return { token: data.token, user: data.user };
}

/**
 * A minimal but fully valid recipe body. Enum values (`cuisine`, `category`,
 * `difficulty`) match the backend's domain value sets; localized fields use the
 * `{ <locale>: ... }` record shape the API expects. A random suffix keeps each
 * created recipe distinguishable in logs / the Admin panel.
 */
export function sampleRecipeBody(label = 'E2E'): Record<string, unknown> {
  const tag = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return {
    name: { en: `${tag} Test Recipe` },
    cuisine: 'TURKISH',
    category: 'DINNER',
    difficulty: 'EASY',
    ingredients: { en: ['1 cup water', '1 tsp salt'] },
    instructions: { en: ['Bring water to a boil.', 'Add salt and serve.'] },
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    servings: 2,
    caloriesPerServing: 120,
    image: 'https://recipely.net/assets/placeholder.jpg',
  };
}

/**
 * Creates a recipe owned by the test account and returns its id. The caller is
 * responsible for {@link deleteRecipe} cleanup (use `try/finally`) so the live
 * production database is left exactly as it was found.
 */
export async function createRecipe(
  api: RecipelyApi,
  token: string,
  label = 'E2E',
): Promise<string> {
  const result = await api.post(RECIPES_PATH, sampleRecipeBody(label), token);
  if (result.status !== 201) {
    throw new Error(
      `Could not create disposable recipe (status ${result.status}). ` +
        `decryptError=${result.decryptError ?? 'none'}`,
    );
  }
  const id = (result.decrypted as { data?: { id?: string } })?.data?.id;
  if (!id) throw new Error('Created recipe had no id in the response.');
  return id;
}

/** Best-effort cleanup — swallows errors so a failed assertion still tidies up. */
export async function deleteRecipe(
  api: RecipelyApi,
  token: string,
  id: string,
): Promise<void> {
  try {
    await api.del(recipePath(id), token);
  } catch {
    /* leave no orphan, but never fail the test on cleanup */
  }
}

/**
 * Playwright fixtures that surface an authed `api` + `session` to specs, while
 * automatically skipping the whole file when auth is unavailable. Specs import
 * `test`/`expect` from here instead of `@playwright/test`.
 */
export const test = base.extend<{ api: RecipelyApi; session: Session }>({
  // eslint-disable-next-line no-empty-pattern
  api: async ({ request }, use) => {
    await use(new RecipelyApi(request));
  },
  session: async ({ request }, use) => {
    // Cache the session for the lifetime of this worker process. Every spec in
    // a worker shares ONE login instead of re-authenticating per test, which
    // keeps the run fast and avoids pummeling the production auth endpoint.
    if (!cachedSession) cachedSession = await login(request);
    await use(cachedSession);
  },
});

/** Per-worker login cache (each Playwright worker is its own process). */
let cachedSession: Session | undefined;

export { expect } from '@playwright/test';
