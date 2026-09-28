import { test as base, expect } from '@playwright/test';
import {
  test,
  CAN_RUN_AUTHED,
  AUTH_SKIP_REASON,
  createRecipe,
  deleteRecipe,
  sampleRecipeBody,
} from '../../helpers/auth';
import { RecipelyApi } from '../../helpers/api';
import {
  RECIPES_PATH,
  recipePath,
  recipeViewPath,
} from '../../helpers/config';

/**
 * Recipes service — the core CRUD surface (`/api/v1/recipes`). Covers auth
 * enforcement, the paginated list contract, single-recipe reads, input
 * validation, and a full create → read → update → delete lifecycle that cleans
 * up after itself so the live database is left untouched.
 */
test.describe('Backend · recipes service', () => {
  base.describe('auth enforcement', () => {
    base('GET /recipes without a token returns an encrypted 401', async ({ request }) => {
      const api = new RecipelyApi(request);
      const result = await api.get(RECIPES_PATH);
      expect(result.status).toBe(401);
      expect(result.envelope).toBeDefined();
    });

    base('POST /recipes without a token returns an encrypted 401', async ({ request }) => {
      const api = new RecipelyApi(request);
      const result = await api.post(RECIPES_PATH, sampleRecipeBody());
      expect(result.status).toBe(401);
      expect(result.envelope).toBeDefined();
    });
  });

  test.describe('authenticated', () => {
    test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);

    test('GET /recipes returns a paginated { items, total, page, pageSize }', async ({
      api,
      session,
    }) => {
      const result = await api.get(`${RECIPES_PATH}?page=1&pageSize=5`, session.token);
      expect(result.status).toBe(200);
      const data = (result.decrypted as {
        data?: { items?: unknown[]; total?: number; page?: number; pageSize?: number };
      })?.data;
      expect(Array.isArray(data?.items)).toBe(true);
      expect(typeof data?.total).toBe('number');
      expect(data?.page).toBe(1);
      expect(data?.pageSize).toBe(5);
      expect(data!.items!.length).toBeLessThanOrEqual(5);
    });

    test('search & sort query params are accepted', async ({ api, session }) => {
      const result = await api.get(
        `${RECIPES_PATH}?search=test&sort=newest&sortOrder=desc&limit=3`,
        session.token,
      );
      expect(result.status).toBe(200);
      const items = (result.decrypted as { data?: { items?: unknown[] } })?.data?.items;
      expect(Array.isArray(items)).toBe(true);
    });

    test('GET /recipes/:id with a malformed UUID returns 400 validation', async ({
      api,
      session,
    }) => {
      const result = await api.get(recipePath('not-a-uuid'), session.token);
      expect(result.status).toBe(400);
      const code = (result.decrypted as { error?: { code?: string } })?.error?.code;
      expect(code).toBe('validation');
    });

    test('GET /recipes/:id for an unknown UUID returns 404 not_found', async ({ api, session }) => {
      const result = await api.get(
        recipePath('00000000-0000-0000-0000-000000000000'),
        session.token,
      );
      expect(result.status).toBe(404);
      const code = (result.decrypted as { error?: { code?: string } })?.error?.code;
      expect(code).toBe('not_found');
    });

    test('POST /recipes with an invalid body returns 400 validation', async ({ api, session }) => {
      const result = await api.post(RECIPES_PATH, { name: 'not-a-localized-object' }, session.token);
      expect(result.status).toBe(400);
      const code = (result.decrypted as { error?: { code?: string } })?.error?.code;
      expect(code).toBe('validation');
    });

    test('full lifecycle: create → read → view → update → delete', async ({ api, session }) => {
      const token = session.token;
      let id: string | undefined;
      try {
        // CREATE
        const created = await api.post(RECIPES_PATH, sampleRecipeBody('lifecycle'), token);
        expect(created.status).toBe(201);
        id = (created.decrypted as { data?: { id?: string } })?.data?.id;
        expect(id).toBeTruthy();
        const recipeId = id!;

        // READ back
        const read = await api.get(recipePath(recipeId), token);
        expect(read.status).toBe(200);
        const recipe = (read.decrypted as { data?: { id?: string; difficulty?: string } })?.data;
        expect(recipe?.id).toBe(recipeId);
        expect(recipe?.difficulty).toBe('EASY');

        // VIEW counter (fire-and-forget, 204 No Content)
        const viewed = await api.post(recipeViewPath(recipeId), {}, token);
        expect([200, 204]).toContain(viewed.status);

        // UPDATE (PATCH)
        const updated = await api.patch(recipePath(recipeId), { servings: 6 }, token);
        expect(updated.status).toBe(200);
        const after = (updated.decrypted as { data?: { servings?: number } })?.data;
        if (after?.servings !== undefined) expect(after.servings).toBe(6);

        // DELETE
        const removed = await api.del(recipePath(recipeId), token);
        expect([200, 204]).toContain(removed.status);
        id = undefined; // cleaned up

        // CONFIRM gone
        const gone = await api.get(recipePath(recipeId), token);
        expect(gone.status).toBe(404);
      } finally {
        if (id) await deleteRecipe(api, token, id);
      }
    });

    test("a freshly created recipe appears in the author's /me/recipes", async ({
      api,
      session,
    }) => {
      const token = session.token;
      const id = await createRecipe(api, token, 'me-list');
      try {
        const mine = await api.get('/me/recipes?pageSize=50', token);
        expect(mine.status).toBe(200);
        const items =
          (mine.decrypted as { data?: { items?: Array<{ id?: string }> } })?.data?.items ?? [];
        expect(items.some((r) => r.id === id)).toBe(true);
      } finally {
        await deleteRecipe(api, token, id);
      }
    });
  });
});
