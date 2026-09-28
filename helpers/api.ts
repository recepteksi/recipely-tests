import type { APIRequestContext, APIResponse } from '@playwright/test';
import { API_V1_URL, API_AES_KEY_HEX } from './config';
import {
  decryptEnvelope,
  encryptEnvelope,
  isEnvelope,
  keyFromHex,
  type Envelope,
} from './envelope';

/**
 * Result of an encrypted /api/v1 round-trip.
 *  - `status`     : raw HTTP status code.
 *  - `envelope`   : the `{ payload, iv }` body when the server replied with one.
 *  - `decrypted`  : the opened plaintext (`{ data }` or `{ error }`) when the
 *                   configured AES key successfully opens the envelope.
 *  - `decryptError`: set when an envelope came back but the key could not open
 *                   it (e.g. running against prod with the dev-default key).
 *  - `raw`        : the unparsed text body for non-envelope responses.
 */
export interface ApiResult {
  status: number;
  ok: boolean;
  envelope?: Envelope;
  decrypted?: unknown;
  decryptError?: string;
  raw?: string;
}

const key = keyFromHex(API_AES_KEY_HEX);

async function interpret(res: APIResponse): Promise<ApiResult> {
  const status = res.status();
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { status, ok: res.ok(), raw: text };
  }

  if (isEnvelope(body)) {
    try {
      return { status, ok: res.ok(), envelope: body, decrypted: decryptEnvelope(body, key) };
    } catch (err) {
      return {
        status,
        ok: res.ok(),
        envelope: body,
        decryptError: err instanceof Error ? err.message : 'decrypt failed',
      };
    }
  }
  // Some error paths (e.g. 429 / middleware rejections) reply with plain JSON.
  return { status, ok: res.ok(), decrypted: body, raw: text };
}

/**
 * Thin encrypted client for the Recipely backend `/api/v1`. Encrypts JSON
 * request bodies into an envelope and decrypts response envelopes, mirroring
 * the app's `HttpClient`. Built around a Playwright `APIRequestContext` so
 * tests get tracing, retries, and base-URL handling for free.
 */
export class RecipelyApi {
  constructor(
    private readonly request: APIRequestContext,
    private readonly locale: string = 'en',
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Accept-Language': this.locale,
      ...extra,
    };
  }

  /** Encrypted POST to `${API_V1_URL}${path}`; `body` is sealed into an envelope. */
  /**
   * @param timeoutMs Overrides the default per-request timeout. Needed for the
   * endpoints that call a model: the assistant's typed turn takes tens of
   * seconds on a cold provider, and the default cut it off at fifteen — a
   * client-side timeout that reads exactly like a backend failure.
   */
  async post(
    path: string,
    body: unknown,
    token?: string,
    timeoutMs?: number,
  ): Promise<ApiResult> {
    // The backend's decrypt-body middleware expects the envelope plaintext to be
    // `{ data: <body> }` (mirroring the `{ data }` / `{ error }` response shape)
    // and rejects anything else with a `missing \`data\`` validation error.
    const envelope = encryptEnvelope({ data: body }, key);
    const res = await this.request.post(`${API_V1_URL}${path}`, {
      headers: this.headers(token ? { Authorization: `Bearer ${token}` } : undefined),
      data: envelope,
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    });
    return interpret(res);
  }

  /** Encrypted PUT — used by draft upsert (`PUT /recipes/drafts/:id`). */
  async put(path: string, body: unknown, token?: string): Promise<ApiResult> {
    const envelope = encryptEnvelope({ data: body }, key);
    const res = await this.request.put(`${API_V1_URL}${path}`, {
      headers: this.headers(token ? { Authorization: `Bearer ${token}` } : undefined),
      data: envelope,
    });
    return interpret(res);
  }

  /** Encrypted PATCH — used by profile/recipe partial updates. */
  async patch(path: string, body: unknown, token?: string): Promise<ApiResult> {
    const envelope = encryptEnvelope({ data: body }, key);
    const res = await this.request.patch(`${API_V1_URL}${path}`, {
      headers: this.headers(token ? { Authorization: `Bearer ${token}` } : undefined),
      data: envelope,
    });
    return interpret(res);
  }

  /**
   * DELETE `${API_V1_URL}${path}`. Mirrors the mobile client: DELETE carries no
   * encrypted body (the backend's decrypt-body middleware lets GET/DELETE pass
   * through unchanged), so none is sent.
   */
  async del(path: string, token?: string): Promise<ApiResult> {
    const res = await this.request.delete(`${API_V1_URL}${path}`, {
      headers: this.headers(token ? { Authorization: `Bearer ${token}` } : undefined),
    });
    return interpret(res);
  }

  /** GET `${API_V1_URL}${path}`; decrypts the response envelope when present. */
  async get(path: string, token?: string): Promise<ApiResult> {
    const res = await this.request.get(`${API_V1_URL}${path}`, {
      headers: this.headers(token ? { Authorization: `Bearer ${token}` } : undefined),
    });
    return interpret(res);
  }
}
