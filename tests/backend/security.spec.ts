import { test, expect } from '@playwright/test';
import { RecipelyApi } from '../../helpers/api';
import {
  API_V1_URL,
  RECIPES_PATH,
  RECIPE_CATEGORIES_PATH,
  RECIPE_CUISINES_PATH,
  ME_PATH,
  ME_RECIPES_PATH,
  ME_FAVORITES_PATH,
  ME_NOTIFICATIONS_PATH,
  DRAFTS_PATH,
  recipePath,
  userPath,
} from '../../helpers/config';

/**
 * Cross-cutting security contract for /api/v1. This is the single place that
 * proves, in one sweep, that NO protected route is reachable without a valid
 * bearer token — and that every rejection is itself encrypted and consistent.
 *
 * Runs under both backend projects, so the guarantee holds for direct callers
 * AND for the mobile app's request signature.
 */
const UNKNOWN_UUID = '11111111-1111-1111-1111-111111111111';

const PROTECTED_GET_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['recipes list', RECIPES_PATH],
  ['categories', RECIPE_CATEGORIES_PATH],
  ['cuisines', RECIPE_CUISINES_PATH],
  ['recipe by id', recipePath(UNKNOWN_UUID)],
  ['my profile', ME_PATH],
  ['my recipes', ME_RECIPES_PATH],
  ['my favorites', ME_FAVORITES_PATH],
  ['my notifications', ME_NOTIFICATIONS_PATH],
  ['my drafts', DRAFTS_PATH],
  ['user profile', userPath(UNKNOWN_UUID)],
];

test.describe('Backend · security contract', () => {
  test.describe('every protected route rejects anonymous access', () => {
    for (const [name, path] of PROTECTED_GET_ROUTES) {
      test(`GET ${name} → encrypted 401`, async ({ request }) => {
        const api = new RecipelyApi(request);
        const result = await api.get(path);
        expect(result.status).toBe(401);
        // The 401 body is an AES envelope — error responses are encrypted too.
        expect(result.envelope, 'unauthorized body should be an AES envelope').toBeDefined();
      });
    }
  });

  test('a malformed bearer token is rejected with an encrypted 401', async ({ request }) => {
    const api = new RecipelyApi(request);
    const result = await api.get(ME_PATH, 'not-a-real-jwt');
    expect(result.status).toBe(401);
    expect(result.envelope).toBeDefined();
  });

  test('a structurally-valid but bogus JWT is rejected with 401', async ({ request }) => {
    const api = new RecipelyApi(request);
    // Three base64 segments — shaped like a JWT, but not signed by the backend.
    const fakeJwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
      'eyJzdWIiOiJhdHRhY2tlciIsImlhdCI6MTUxNjIzOTAyMn0.' +
      'invalid-signature-section';
    const result = await api.get(ME_PATH, fakeJwt);
    expect(result.status).toBe(401);
    expect(result.envelope).toBeDefined();
  });

  test('an unknown /api/v1 route returns an encrypted 404', async ({ request }) => {
    const api = new RecipelyApi(request);
    const result = await api.get('/this-route-does-not-exist-xyz');
    expect(result.status).toBe(404);
    // The v1 fallback wraps even 404s, unlike the plain app-root 404.
    expect(result.envelope).toBeDefined();
  });

  test('CORS + Helmet headers are present on the API surface', async ({ request }) => {
    const res = await request.get(`${API_V1_URL}${RECIPE_CATEGORIES_PATH}`);
    const headers = res.headers();
    expect(headers['access-control-allow-credentials']).toBe('true');
    expect(headers['x-content-type-options']).toBe('nosniff');
  });
});
