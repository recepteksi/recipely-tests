import { test, expect } from '@playwright/test';
import { RecipelyApi } from '../../helpers/api';
import {
  HAS_REAL_AES_KEY,
  RECIPE_CUISINES_PATH,
  RECIPE_CATEGORIES_PATH,
} from '../../helpers/config';

/**
 * Backend-driven taxonomy catalog (cuisines & categories) under /api/v1.
 *
 * These routes require authentication and — like every /api/v1 response,
 * including errors — reply with an AES-256-GCM envelope. Without a bearer token
 * the backend returns an ENCRYPTED 401, which itself proves that response
 * encryption is enforced end-to-end. With a real key + token the payload
 * decrypts to an array of catalog items.
 */
test.describe('Backend · taxonomy catalog', () => {
  for (const [name, path] of [
    ['cuisines', RECIPE_CUISINES_PATH],
    ['categories', RECIPE_CATEGORIES_PATH],
  ] as const) {
    test(`GET ${name} returns an encrypted envelope`, async ({ request }) => {
      const api = new RecipelyApi(request);
      const result = await api.get(path);

      // The route exists and answered.
      expect(result.status).toBeGreaterThan(0);
      // Auth-gated: unauthenticated callers get 401/403; an authed call gets 200.
      expect([200, 401, 403]).toContain(result.status);

      // Every /api/v1 response body is an AES-GCM envelope — even the 401.
      expect(result.envelope, 'response should be an AES-GCM envelope').toBeDefined();

      if (HAS_REAL_AES_KEY && result.status === 200) {
        expect(result.decryptError).toBeUndefined();
        const decrypted = result.decrypted as { data?: unknown };
        expect(Array.isArray(decrypted?.data)).toBe(true);
      } else if (!HAS_REAL_AES_KEY) {
        // Dev-default key cannot open the backend-keyed envelope — that is
        // expected and still confirms the encryption contract.
        expect(result.decryptError).toBeDefined();
      }
    });
  }
});
