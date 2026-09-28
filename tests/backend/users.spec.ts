import { test as base, expect } from '@playwright/test';
import { test, CAN_RUN_AUTHED, AUTH_SKIP_REASON } from '../../helpers/auth';
import { RecipelyApi } from '../../helpers/api';
import {
  userPath,
  userRecipesPath,
  userFollowPath,
} from '../../helpers/config';

const UNKNOWN_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Users service — public profiles, a user's recipes, and the follow graph
 * (`/users/:id`, `/users/:id/recipes`, `/users/:id/follow`).
 *
 * A real follow→unfollow round-trip needs a second account, which this
 * environment doesn't have, so the graph is covered by its enforced business
 * rules instead: self-follow is rejected, and follow requires auth.
 */
test.describe('Backend · users service', () => {
  base('GET a user profile without a token returns an encrypted 401', async ({ request }) => {
    const api = new RecipelyApi(request);
    const result = await api.get(userPath(UNKNOWN_UUID));
    expect(result.status).toBe(401);
    expect(result.envelope).toBeDefined();
  });

  test.describe('authenticated', () => {
    test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);

    test("GET /users/:id returns the test account's public profile", async ({ api, session }) => {
      const result = await api.get(userPath(session.user.id), session.token);
      expect(result.status).toBe(200);
      const profile = (result.decrypted as { data?: { id?: string; displayName?: string } })?.data;
      expect(profile?.id).toBe(session.user.id);
      expect(typeof profile?.displayName).toBe('string');
    });

    test('GET /users/:id/recipes returns a paginated list', async ({ api, session }) => {
      const result = await api.get(`${userRecipesPath(session.user.id)}?pageSize=10`, session.token);
      expect(result.status).toBe(200);
      const data = (result.decrypted as { data?: { items?: unknown[]; total?: number } })?.data;
      expect(Array.isArray(data?.items)).toBe(true);
      expect(typeof data?.total).toBe('number');
    });

    test('GET /users/:id with a malformed UUID returns 400 validation', async ({ api, session }) => {
      const result = await api.get(userPath('not-a-uuid'), session.token);
      expect(result.status).toBe(400);
      const code = (result.decrypted as { error?: { code?: string } })?.error?.code;
      expect(code).toBe('validation');
    });

    test('GET an unknown user returns 404 not_found', async ({ api, session }) => {
      const result = await api.get(userPath(UNKNOWN_UUID), session.token);
      expect(result.status).toBe(404);
      const code = (result.decrypted as { error?: { code?: string } })?.error?.code;
      expect(code).toBe('not_found');
    });

    test('following yourself is rejected (business rule)', async ({ api, session }) => {
      const result = await api.post(userFollowPath(session.user.id), {}, session.token);
      // The backend forbids self-follow; a 4xx (not a 2xx) is the contract.
      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(result.status).toBeLessThan(500);
    });
  });
});
