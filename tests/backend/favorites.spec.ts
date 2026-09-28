import { test as base, expect } from '@playwright/test';
import {
  test,
  CAN_RUN_AUTHED,
  AUTH_SKIP_REASON,
  createRecipe,
  deleteRecipe,
} from '../../helpers/auth';
import { RecipelyApi } from '../../helpers/api';
import {
  recipeFavoritePath,
  ME_FAVORITES_PATH,
} from '../../helpers/config';

/**
 * Favorites service — `POST/DELETE /recipes/:id/favorite` and the
 * `/me/favorites` list. Each test creates its OWN throwaway recipe, so the two
 * backend projects (direct + mobile) never contend over shared state, and the
 * recipe is deleted afterwards.
 */
test.describe('Backend · favorites service', () => {
  base('favoriting without a token returns an encrypted 401', async ({ request }) => {
    const api = new RecipelyApi(request);
    const result = await api.post(
      recipeFavoritePath('00000000-0000-0000-0000-000000000000'),
      {},
    );
    expect(result.status).toBe(401);
    expect(result.envelope).toBeDefined();
  });

  test.describe('authenticated', () => {
    test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);

    test('favorite → appears in /me/favorites → unfavorite → gone', async ({ api, session }) => {
      const token = session.token;
      const id = await createRecipe(api, token, 'fav');
      try {
        // FAVORITE
        const fav = await api.post(recipeFavoritePath(id), {}, token);
        expect([200, 201, 204]).toContain(fav.status);

        // Appears in my favorites
        const listed = await api.get(`${ME_FAVORITES_PATH}?pageSize=50`, token);
        expect(listed.status).toBe(200);
        const items =
          (listed.decrypted as { data?: { items?: Array<{ id?: string }> } })?.data?.items ?? [];
        expect(items.some((r) => r.id === id)).toBe(true);

        // UNFAVORITE
        const unfav = await api.del(recipeFavoritePath(id), token);
        expect([200, 204]).toContain(unfav.status);

        // Gone from my favorites
        const after = await api.get(`${ME_FAVORITES_PATH}?pageSize=50`, token);
        const afterItems =
          (after.decrypted as { data?: { items?: Array<{ id?: string }> } })?.data?.items ?? [];
        expect(afterItems.some((r) => r.id === id)).toBe(false);
      } finally {
        await deleteRecipe(api, token, id);
      }
    });

    test('/me/favorites returns a paginated list', async ({ api, session }) => {
      const result = await api.get(`${ME_FAVORITES_PATH}?page=1&pageSize=10`, session.token);
      expect(result.status).toBe(200);
      const data = (result.decrypted as { data?: { items?: unknown[]; total?: number } })?.data;
      expect(Array.isArray(data?.items)).toBe(true);
      expect(typeof data?.total).toBe('number');
    });
  });
});
