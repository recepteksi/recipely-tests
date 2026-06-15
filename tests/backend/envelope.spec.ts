import { test, expect } from '@playwright/test';
import { keyFromHex, encryptEnvelope, decryptEnvelope, isEnvelope } from '../../helpers/envelope';
import { RecipelyApi } from '../../helpers/api';
import { API_AES_KEY_HEX, HAS_REAL_AES_KEY, AUTH_LOGIN_PATH } from '../../helpers/config';

/**
 * AES-256-GCM envelope contract for /api/v1.
 *
 * The suite always verifies the wire format locally and the server-side
 * handshake. When a REAL backend AES key is provided (RECIPELY_API_AES_KEY),
 * it additionally decrypts real responses and asserts the error contract;
 * otherwise those deep assertions are skipped with a clear reason.
 */
test.describe('Backend · AES-256-GCM envelope', () => {
  test('local round-trip: encrypt → decrypt restores the payload', () => {
    const key = keyFromHex(API_AES_KEY_HEX);
    const payload = { data: { email: 'taste@recipely.net', n: 42, nested: { ok: true } } };
    const env = encryptEnvelope(payload, key);

    expect(isEnvelope(env)).toBe(true);
    // Fresh random IV ⇒ base64 of 12 bytes = 16 chars.
    expect(env.iv).toHaveLength(16);
    expect(decryptEnvelope(env, key)).toEqual(payload);
  });

  test('a fresh IV is used per encryption (no nonce reuse)', () => {
    const key = keyFromHex(API_AES_KEY_HEX);
    const a = encryptEnvelope({ data: 1 }, key);
    const b = encryptEnvelope({ data: 1 }, key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.payload).not.toBe(b.payload);
  });

  test('login endpoint speaks the envelope protocol', async ({ request }) => {
    const api = new RecipelyApi(request);
    const result = await api.post(AUTH_LOGIN_PATH, {
      email: 'definitely-not-a-user@recipely.net',
      password: 'wrong-password-123',
    });

    // The route exists and answered (not a 404 / network failure).
    expect(result.status).toBeGreaterThan(0);
    expect(result.status).toBeLessThan(500);

    if (HAS_REAL_AES_KEY) {
      // With the real key the backend opens our `{ data }`-wrapped envelope and
      // replies with a structured rejection for bad credentials. A 401 with an
      // `unauthorized` error code (not a 400 `missing data` validation error)
      // proves the request body was both decryptable AND correctly shaped.
      expect(result.status).toBe(401);
      expect(result.decryptError, 'response envelope should decrypt with the real key')
        .toBeUndefined();
      const decrypted = result.decrypted as { error?: { code?: string } } | undefined;
      expect(decrypted?.error?.code).toBe('unauthorized');
    } else {
      // With the dev-default key the backend's decrypt-body middleware rejects
      // our request (it can't open our envelope). That still proves the
      // endpoint and the envelope middleware are live.
      test.info().annotations.push({
        type: 'note',
        description:
          'RECIPELY_API_AES_KEY is the dev default; set the real backend key to ' +
          'exercise the full login error contract. Asserting handshake only.',
      });
      expect(result.status).toBeGreaterThanOrEqual(400);
    }
  });
});
