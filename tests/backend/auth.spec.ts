import { test, expect } from '@playwright/test';
import { RecipelyApi } from '../../helpers/api';
import {
  HAS_REAL_AES_KEY,
  HAS_TEST_ACCOUNT,
  TEST_EMAIL,
  TEST_PASSWORD,
  AUTH_LOGIN_PATH,
  AUTH_REGISTER_PATH,
  AUTH_REGISTER_VERIFY_PATH,
  AUTH_REGISTER_RESEND_PATH,
  AUTH_SOCIAL_PATH,
  AUTH_FORGOT_PASSWORD_PATH,
  AUTH_RESET_PASSWORD_PATH,
} from '../../helpers/config';

/**
 * Auth service (`/api/v1/auth/*`) — the only public, token-free surface inside
 * the encrypted API. Every case below is non-destructive: it either uses
 * deliberately invalid input, hits an idempotent/generic endpoint, or (for the
 * happy path) logs the dedicated E2E account in without changing any state.
 *
 * The deep assertions (decrypting the structured error body) only run with the
 * real AES key; without it we still verify status codes and the envelope.
 */
test.describe('Backend · auth service', () => {
  /** Pulls `error.code` out of a decrypted `{ error }` envelope, if available. */
  function errorCode(result: { decrypted?: unknown }): string | undefined {
    return (result.decrypted as { error?: { code?: string } } | undefined)?.error?.code;
  }

  test.describe('login', () => {
    test('rejects wrong credentials with 401 unauthorized', async ({ request }) => {
      const api = new RecipelyApi(request);
      const result = await api.post(AUTH_LOGIN_PATH, {
        email: 'definitely-not-a-user@recipely.net',
        password: 'wrong-password-123',
      });
      expect(result.envelope).toBeDefined();
      if (HAS_REAL_AES_KEY) {
        expect(result.status).toBe(401);
        expect(errorCode(result)).toBe('unauthorized');
      } else {
        expect(result.status).toBeGreaterThanOrEqual(400);
      }
    });

    test('rejects a malformed email with 400 validation', async ({ request }) => {
      const api = new RecipelyApi(request);
      const result = await api.post(AUTH_LOGIN_PATH, { email: 'not-an-email', password: 'x' });
      if (HAS_REAL_AES_KEY) {
        expect(result.status).toBe(400);
        expect(errorCode(result)).toBe('validation');
      } else {
        expect(result.status).toBeGreaterThanOrEqual(400);
      }
    });

    test('the real test account logs in and receives a token + user', async ({ request }) => {
      test.skip(!HAS_REAL_AES_KEY || !HAS_TEST_ACCOUNT, 'Needs real AES key + test account.');
      const api = new RecipelyApi(request);
      const result = await api.post(AUTH_LOGIN_PATH, {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      });
      expect(result.status).toBe(200);
      const data = (result.decrypted as { data?: { token?: string; user?: { email?: string } } })
        ?.data;
      expect(typeof data?.token).toBe('string');
      expect((data?.token ?? '').split('.')).toHaveLength(3); // looks like a JWT
      expect(data?.user?.email).toBe(TEST_EMAIL);
    });
  });

  test.describe('register', () => {
    test('rejects an invalid body with 400 validation', async ({ request }) => {
      const api = new RecipelyApi(request);
      const result = await api.post(AUTH_REGISTER_PATH, {
        email: 'notanemail',
        password: 'short',
        displayName: '',
      });
      if (HAS_REAL_AES_KEY) {
        expect(result.status).toBe(400);
        expect(errorCode(result)).toBe('validation');
      } else {
        expect(result.status).toBeGreaterThanOrEqual(400);
      }
    });

    test('registering an already-verified email returns 409 conflict', async ({ request }) => {
      test.skip(!HAS_REAL_AES_KEY || !HAS_TEST_ACCOUNT, 'Needs real AES key + test account.');
      const api = new RecipelyApi(request);
      // The E2E account is already verified, so re-registering it must conflict
      // rather than create a duplicate or leak that the email is taken via a
      // different status. Non-destructive: no new account is created.
      const result = await api.post(AUTH_REGISTER_PATH, {
        email: TEST_EMAIL,
        password: 'Abcd1234!New',
        displayName: 'Duplicate Attempt',
      });
      expect(result.status).toBe(409);
      expect(errorCode(result)).toBe('conflict');
    });

    test('verify rejects a non-6-digit code with 400 validation', async ({ request }) => {
      const api = new RecipelyApi(request);
      const result = await api.post(AUTH_REGISTER_VERIFY_PATH, {
        email: 'someone@recipely.net',
        code: 'abc',
      });
      if (HAS_REAL_AES_KEY) {
        expect(result.status).toBe(400);
        expect(errorCode(result)).toBe('validation');
      } else {
        expect(result.status).toBeGreaterThanOrEqual(400);
      }
    });

    test('resend returns a generic 200 (no account enumeration)', async ({ request }) => {
      test.skip(!HAS_REAL_AES_KEY, 'Needs real AES key to read the generic message.');
      const api = new RecipelyApi(request);
      // No pending registration exists for this random address, yet the contract
      // is a generic 200 so an attacker cannot tell which emails are pending.
      const result = await api.post(AUTH_REGISTER_RESEND_PATH, {
        email: `nobody-${Date.now()}@recipely.net`,
      });
      expect(result.status).toBe(200);
    });
  });

  test.describe('password reset', () => {
    test('forgot-password always returns a generic 200', async ({ request }) => {
      test.skip(!HAS_REAL_AES_KEY, 'Needs real AES key to decrypt the generic message.');
      const api = new RecipelyApi(request);
      // Generic success regardless of whether the email exists — prevents
      // enumeration. Uses a random non-existent address so no real mail is sent.
      const result = await api.post(AUTH_FORGOT_PASSWORD_PATH, {
        email: `nobody-${Date.now()}@recipely.net`,
      });
      expect(result.status).toBe(200);
      const message = (result.decrypted as { data?: { message?: string } })?.data?.message ?? '';
      expect(message.toLowerCase()).toContain('if an account exists');
    });

    test('reset-password with an invalid token returns 404', async ({ request }) => {
      test.skip(!HAS_REAL_AES_KEY, 'Needs real AES key to read the structured error.');
      const api = new RecipelyApi(request);
      const result = await api.post(AUTH_RESET_PASSWORD_PATH, {
        token: 'totally-invalid-token',
        newPassword: 'Abcd1234!New',
      });
      expect(result.status).toBe(404);
      expect(errorCode(result)).toBe('not_found');
    });

    test('reset-password rejects a too-short password with 400', async ({ request }) => {
      const api = new RecipelyApi(request);
      const result = await api.post(AUTH_RESET_PASSWORD_PATH, {
        token: 'whatever',
        newPassword: 'short',
      });
      if (HAS_REAL_AES_KEY) {
        expect(result.status).toBe(400);
        expect(errorCode(result)).toBe('validation');
      } else {
        expect(result.status).toBeGreaterThanOrEqual(400);
      }
    });
  });

  test.describe('social', () => {
    test('an invalid Firebase ID token is rejected with 401', async ({ request }) => {
      test.skip(!HAS_REAL_AES_KEY, 'Needs real AES key to read the structured error.');
      const api = new RecipelyApi(request);
      const result = await api.post(AUTH_SOCIAL_PATH, { idToken: 'invalid-token-value' });
      expect(result.status).toBe(401);
      expect(errorCode(result)).toBe('unauthorized');
    });

    test('an empty idToken is rejected with 400 validation', async ({ request }) => {
      const api = new RecipelyApi(request);
      const result = await api.post(AUTH_SOCIAL_PATH, { idToken: '' });
      if (HAS_REAL_AES_KEY) {
        expect(result.status).toBe(400);
        expect(errorCode(result)).toBe('validation');
      } else {
        expect(result.status).toBeGreaterThanOrEqual(400);
      }
    });
  });
});
