import crypto from 'crypto';

/**
 * AES-256-GCM request/response envelope — a faithful re-implementation of the
 * recipely app's `infrastructure/crypto/aes-envelope.ts` wire format, written
 * with Node's built-in `crypto` so the test suite needs no app dependencies.
 *
 * Wire format (shared with recipely-backend):
 *   - `iv`:      base64 of a fresh 12-byte random IV per encryption.
 *   - `payload`: base64 of (ciphertext || 16-byte GCM auth tag).
 *   - plaintext: JSON of `{ data: <T> }` on success or `{ error: ... }` on failure.
 */
export interface Envelope {
  payload: string;
  iv: string;
}

const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ALGO = 'aes-256-gcm';

/** Converts a 64-char hex string into a 32-byte key buffer. */
export function keyFromHex(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('AES key must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/** Thrown when GCM decryption fails (malformed ciphertext or wrong/tampered key). */
export class EnvelopeDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeDecryptError';
  }
}

/**
 * Serialises `plain` to JSON and seals it with AES-256-GCM under a fresh random
 * IV. Returns a base64 wire envelope identical to what the app produces.
 */
export function encryptEnvelope(plain: unknown, key: Buffer): Envelope {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(plain), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes, appended to match the app format.
  return {
    payload: Buffer.concat([ciphertext, tag]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

/**
 * Opens an envelope produced by {@link encryptEnvelope} (or the backend) and
 * returns the deserialised value. Throws {@link EnvelopeDecryptError} on a
 * malformed envelope or a failed auth-tag check (wrong key / tampering).
 */
export function decryptEnvelope(envelope: Envelope, key: Buffer): unknown {
  if (typeof envelope.payload !== 'string' || typeof envelope.iv !== 'string') {
    throw new EnvelopeDecryptError('Envelope missing payload or iv');
  }
  const iv = Buffer.from(envelope.iv, 'base64');
  if (iv.length !== IV_BYTES) {
    throw new EnvelopeDecryptError(`IV must decode to ${IV_BYTES} bytes`);
  }
  const sealed = Buffer.from(envelope.payload, 'base64');
  if (sealed.length < AUTH_TAG_BYTES + 1) {
    throw new EnvelopeDecryptError('Payload shorter than auth tag');
  }
  const ciphertext = sealed.subarray(0, sealed.length - AUTH_TAG_BYTES);
  const tag = sealed.subarray(sealed.length - AUTH_TAG_BYTES);
  try {
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch (err) {
    throw new EnvelopeDecryptError(
      `Failed to decrypt: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }
}

/** Type guard for an `{ payload, iv }` wire envelope. */
export function isEnvelope(body: unknown): body is Envelope {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as Envelope).payload === 'string' &&
    typeof (body as Envelope).iv === 'string'
  );
}
