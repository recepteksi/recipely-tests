import { test as base, expect } from '@playwright/test';
import { test, CAN_RUN_AUTHED, AUTH_SKIP_REASON } from '../../helpers/auth';
import { RecipelyApi } from '../../helpers/api';
import {
  ME_NOTIFICATIONS_PATH,
  ME_NOTIFICATIONS_READ_ALL_PATH,
  ME_DEVICE_TOKEN_PATH,
} from '../../helpers/config';

/**
 * Notifications service — the in-app inbox plus push-token registration
 * (`/me/notifications*`, `/me/device-token`). All routes require auth; the
 * mutating ones (`read-all`, `device-token`) are idempotent, so the test
 * account is left in a consistent state.
 */
test.describe('Backend · notifications service', () => {
  base.describe('auth enforcement', () => {
    base('GET notifications without a token returns 401', async ({ request }) => {
      const api = new RecipelyApi(request);
      const result = await api.get(ME_NOTIFICATIONS_PATH);
      expect(result.status).toBe(401);
      expect(result.envelope).toBeDefined();
    });

    base('registering a device token without auth returns 401', async ({ request }) => {
      const api = new RecipelyApi(request);
      const result = await api.post(ME_DEVICE_TOKEN_PATH, { token: 'x', platform: 'ios' });
      expect(result.status).toBe(401);
      expect(result.envelope).toBeDefined();
    });
  });

  test.describe('authenticated', () => {
    test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);

    test('GET /me/notifications returns a list', async ({ api, session }) => {
      const result = await api.get(`${ME_NOTIFICATIONS_PATH}?limit=20&offset=0`, session.token);
      expect(result.status).toBe(200);
      const data = (result.decrypted as { data?: unknown })?.data;
      // The inbox is either a bare array or a `{ items }` wrapper depending on
      // the endpoint version — both are acceptable as long as it's structured.
      const ok = Array.isArray(data) || Array.isArray((data as { items?: unknown[] })?.items);
      expect(ok).toBe(true);
    });

    test('POST /me/notifications/read-all is idempotent (204)', async ({ api, session }) => {
      const result = await api.post(ME_NOTIFICATIONS_READ_ALL_PATH, {}, session.token);
      expect([200, 204]).toContain(result.status);
    });

    test('POST /me/device-token registers a token (204)', async ({ api, session }) => {
      const result = await api.post(
        ME_DEVICE_TOKEN_PATH,
        { token: `e2e-test-token-${Date.now()}`, platform: 'ios' },
        session.token,
      );
      expect([200, 204]).toContain(result.status);
    });

    test('POST /me/device-token rejects an invalid platform with 400', async ({ api, session }) => {
      const result = await api.post(
        ME_DEVICE_TOKEN_PATH,
        { token: 'abc', platform: 'windows-phone' },
        session.token,
      );
      expect(result.status).toBe(400);
      const code = (result.decrypted as { error?: { code?: string } })?.error?.code;
      expect(code).toBe('validation');
    });
  });
});
