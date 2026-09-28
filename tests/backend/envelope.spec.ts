import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import {
  keyFromHex,
  encryptEnvelope,
  decryptEnvelope,
  isEnvelope,
  EnvelopeDecryptError,
} from '../../helpers/envelope';
import { RecipelyApi } from '../../helpers/api';
import {
  API_AES_KEY_HEX,
  API_V1_URL,
  HAS_REAL_AES_KEY,
  AUTH_LOGIN_PATH,
} from '../../helpers/config';

/**
 * AES-256-GCM envelope contract for /api/v1 — the cryptographic foundation
 * every other backend test depends on.
 *
 * Local tests prove the wire format (IV freshness, tamper detection, wrong-key
 * rejection) without touching the network. Server tests prove the live backend
 * speaks the same protocol on both the request and response sides.
 */
test.describe('Backend · AES-256-GCM envelope', () => {
  const key = keyFromHex(API_AES_KEY_HEX);

  test('local round-trip: encrypt → decrypt restores the payload', () => {
    const payload = { data: { email: 'taste@recipely.net', n: 42, nested: { ok: true } } };
    const env = encryptEnvelope(payload, key);

    expect(isEnvelope(env)).toBe(true);
    // Fresh random IV ⇒ base64 of 12 bytes = 16 chars.
    expect(env.iv).toHaveLength(16);
    expect(decryptEnvelope(env, key)).toEqual(payload);
  });

  test('a fresh IV is used per encryption (no nonce reuse)', () => {
    const a = encryptEnvelope({ data: 1 }, key);
    const b = encryptEnvelope({ data: 1 }, key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.payload).not.toBe(b.payload);
  });

  test('a tampered ciphertext fails the GCM auth tag', () => {
    const env = encryptEnvelope({ data: { secret: true } }, key);
    const bytes = Buffer.from(env.payload, 'base64');
    bytes[0] ^= 0xff; // flip a bit in the ciphertext
    const tampered = { iv: env.iv, payload: bytes.toString('base64') };
    expect(() => decryptEnvelope(tampered, key)).toThrow(EnvelopeDecryptError);
  });

  test('a different key cannot open the envelope', () => {
    const env = encryptEnvelope({ data: 'sensitive' }, key);
    const otherKey = crypto.randomBytes(32);
    expect(() => decryptEnvelope(env, otherKey)).toThrow(EnvelopeDecryptError);
  });

  test('a malformed envelope is rejected before decryption', () => {
    expect(() => decryptEnvelope({ iv: 'x', payload: 'y' }, key)).toThrow(EnvelopeDecryptError);
    expect(isEnvelope({ foo: 'bar' })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
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
    // Every /api/v1 reply — including this rejection — is an envelope.
    expect(result.envelope, 'response should be an AES-GCM envelope').toBeDefined();

    if (HAS_REAL_AES_KEY) {
      // With the real key the backend opens our `{ data }`-wrapped envelope and
      // replies with a structured rejection. 401 + `unauthorized` (not a 400
      // `missing data`) proves the request body was decryptable AND well-shaped.
      expect(result.status).toBe(401);
      expect(result.decryptError, 'response envelope should decrypt with the real key')
        .toBeUndefined();
      const decrypted = result.decrypted as { error?: { code?: string } } | undefined;
      expect(decrypted?.error?.code).toBe('unauthorized');
    } else {
      test.info().annotations.push({
        type: 'note',
        description:
          'RECIPELY_API_AES_KEY is the dev default; set the real backend key to ' +
          'exercise the full login error contract. Asserting handshake only.',
      });
      expect(result.status).toBeGreaterThanOrEqual(400);
    }
  });

  test('a request body that is NOT an envelope is rejected', async ({ request }) => {
    // Bypass RecipelyApi and POST raw plaintext JSON to a body-bearing route.
    // The decrypt-body middleware must refuse it (400 validation), proving
    // encryption is enforced on the inbound side, not just the outbound side.
    const res = await request.post(`${API_V1_URL}${AUTH_LOGIN_PATH}`, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      data: { email: 'a@b.c', password: 'plaintext-not-enveloped' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    // The rejection itself is enveloped — consistent on the wire.
    expect(body).toHaveProperty('payload');
    expect(body).toHaveProperty('iv');
    if (HAS_REAL_AES_KEY) {
      const decoded = decryptEnvelope(body, key) as { error?: { code?: string } };
      expect(decoded.error?.code).toBe('validation');
    }
  });
});
