import { test as base, expect } from '@playwright/test';
import { test, CAN_RUN_AUTHED, AUTH_SKIP_REASON } from '../../helpers/auth';
import { RecipelyApi } from '../../helpers/api';
import {
  ME_PATH,
  ME_PROFILE_PATH,
  ME_RECIPES_PATH,
} from '../../helpers/config';

/**
 * "Me" service — the signed-in user's own profile and content
 * (`/me`, `/me/profile`, `/me/recipes`). Read paths assert the aggregated
 * profile shape; the write path performs an IDEMPOTENT update (re-setting the
 * display name to its current value) so it exercises PATCH without mutating any
 * real data.
 */
test.describe('Backend · me service', () => {
  base.describe('auth enforcement', () => {
    for (const [label, path] of [
      ['GET /me', ME_PATH],
      ['GET /me/recipes', ME_RECIPES_PATH],
    ] as const) {
      base(`${label} without a token returns an encrypted 401`, async ({ request }) => {
        const api = new RecipelyApi(request);
        const result = await api.get(path);
        expect(result.status).toBe(401);
        expect(result.envelope).toBeDefined();
      });
    }
  });

  test.describe('authenticated', () => {
    test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);

    test('GET /me returns the aggregated profile', async ({ api, session }) => {
      const result = await api.get(ME_PATH, session.token);
      expect(result.status).toBe(200);
      const me = (result.decrypted as {
        data?: { id?: string; displayName?: string; recipeCount?: number; followerCount?: number };
      })?.data;
      expect(me?.id).toBe(session.user.id);
      expect(typeof me?.displayName).toBe('string');
      // Aggregated counters the profile screen renders.
      expect(typeof me?.recipeCount).toBe('number');
      expect(typeof me?.followerCount).toBe('number');
    });

    test('GET /me/recipes returns a paginated list', async ({ api, session }) => {
      const result = await api.get(`${ME_RECIPES_PATH}?page=1&pageSize=10`, session.token);
      expect(result.status).toBe(200);
      const data = (result.decrypted as { data?: { items?: unknown[]; total?: number } })?.data;
      expect(Array.isArray(data?.items)).toBe(true);
      expect(typeof data?.total).toBe('number');
    });

    test('PATCH /me/profile (idempotent display-name write) returns 200', async ({
      api,
      session,
    }) => {
      // Read the current name, then write it straight back — proves the update
      // path works end-to-end without changing the account.
      const before = await api.get(ME_PATH, session.token);
      const currentName =
        (before.decrypted as { data?: { displayName?: string } })?.data?.displayName ?? 'E2E Test';
      const result = await api.patch(ME_PROFILE_PATH, { displayName: currentName }, session.token);
      expect(result.status).toBe(200);
    });

    test('PATCH /me/profile rejects an over-long bio with 400 validation', async ({
      api,
      session,
    }) => {
      const result = await api.patch(
        ME_PROFILE_PATH,
        { bio: 'x'.repeat(301) }, // max is 300
        session.token,
      );
      expect(result.status).toBe(400);
      const code = (result.decrypted as { error?: { code?: string } })?.error?.code;
      expect(code).toBe('validation');
    });
  });
});
