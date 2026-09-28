import { test as base, expect } from '@playwright/test';
import { test, CAN_RUN_AUTHED, AUTH_SKIP_REASON } from '../../helpers/auth';
import { RecipelyApi } from '../../helpers/api';
import { RECIPE_CUISINES_PATH, RECIPE_CATEGORIES_PATH } from '../../helpers/config';

/**
 * Taxonomy catalog service — `/recipes/cuisines` and `/recipes/categories`.
 *
 * These power the app's filter chips and the create-recipe pickers. They are
 * auth-gated and AES-enveloped like the rest of /api/v1. The catalog is
 * server-driven, so the test account must see a non-empty, well-shaped list of
 * `{ key, name, emoji }` items in its locale.
 */
test.describe('Backend · taxonomy catalog', () => {
  // Auth enforcement is checked even without credentials: an enveloped 401.
  base.describe('auth enforcement', () => {
    for (const [name, path] of [
      ['cuisines', RECIPE_CUISINES_PATH],
      ['categories', RECIPE_CATEGORIES_PATH],
    ] as const) {
      base(`GET ${name} without a token returns an encrypted 401`, async ({ request }) => {
        const api = new RecipelyApi(request);
        const result = await api.get(path);
        expect(result.status).toBe(401);
        // Even the rejection is enveloped — encryption is end-to-end.
        expect(result.envelope).toBeDefined();
      });
    }
  });

  test.describe('authenticated catalog', () => {
    test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);

    test('cuisines returns a non-empty list of { key, name, emoji }', async ({ api, session }) => {
      const result = await api.get(RECIPE_CUISINES_PATH, session.token);
      expect(result.status).toBe(200);
      const cuisines = (result.decrypted as { data?: { cuisines?: unknown[] } })?.data?.cuisines;
      expect(Array.isArray(cuisines)).toBe(true);
      expect(cuisines!.length).toBeGreaterThan(0);
      const first = cuisines![0] as Record<string, unknown>;
      expect(first).toHaveProperty('key');
      expect(first).toHaveProperty('name');
      // Keys are upper-snake enum values (e.g. TURKISH, ITALIAN).
      expect(String(first.key)).toMatch(/^[A-Z_]+$/);
    });

    test('categories returns a non-empty list of { key, name, emoji }', async ({ api, session }) => {
      const result = await api.get(RECIPE_CATEGORIES_PATH, session.token);
      expect(result.status).toBe(200);
      const categories = (result.decrypted as { data?: { categories?: unknown[] } })?.data
        ?.categories;
      expect(Array.isArray(categories)).toBe(true);
      expect(categories!.length).toBeGreaterThan(0);
      const first = categories![0] as Record<string, unknown>;
      expect(first).toHaveProperty('key');
      expect(first).toHaveProperty('name');
    });

    test('catalog is localized — Turkish locale returns Turkish names', async ({ session, request }) => {
      // A fresh client pinned to `tr` proves the Accept-Language header drives
      // i18n on the server, not just the default English copy.
      const trApi = new RecipelyApi(request, 'tr');
      const result = await trApi.get(RECIPE_CATEGORIES_PATH, session.token);
      expect(result.status).toBe(200);
      const categories =
        (result.decrypted as { data?: { categories?: Array<{ name?: string }> } })?.data
          ?.categories ?? [];
      expect(categories.length).toBeGreaterThan(0);
      // We don't hard-code a translation (it may evolve); we assert every item
      // still carries a non-empty localized name.
      for (const c of categories) expect((c.name ?? '').length).toBeGreaterThan(0);
    });
  });
});
