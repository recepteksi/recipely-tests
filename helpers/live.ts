import type { APIRequestContext } from '@playwright/test';
import { RecipelyApi, type ApiResult } from './api';
import { API_V1_URL, API_AES_KEY_HEX } from './config';
import { decryptEnvelope, isEnvelope, keyFromHex } from './envelope';

/**
 * Helpers for the live (paid, gated) specs that drive real imports, sweeps and
 * owner lifecycles on an environment — dev, in practice.
 *
 * Every spec using these is double-gated: its own `RECIPELY_*_E2E=1` flag AND
 * a real AES key + test account (`CAN_RUN_AUTHED`). A plain `npm test` skips
 * them, so no model is ever called by accident.
 */

const key = keyFromHex(API_AES_KEY_HEX);

/** `data` of a decrypted `{ data }` body, typed loosely: these specs read shapes the backend owns. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dataOf = (r: ApiResult): any => (r.decrypted as { data?: unknown } | undefined)?.data;

/** `error` of a decrypted `{ error }` body. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const errorOf = (r: ApiResult): any => (r.decrypted as { error?: unknown } | undefined)?.error;

/**
 * Multipart POST. Uploads travel outside the envelope on the way in (multer
 * reads the raw form) but the answer is still sealed, so it is opened here.
 */
export async function postMultipart(
  request: APIRequestContext,
  path: string,
  field: string,
  files: { name: string; mimeType: string; buffer: Buffer }[],
  token: string,
  timeoutMs = 120_000,
): Promise<ApiResult> {
  const form = new FormData();
  for (const f of files) form.append(field, new Blob([new Uint8Array(f.buffer)], { type: f.mimeType }), f.name);
  const res = await request.post(`${API_V1_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'tr' },
    multipart: form,
    timeout: timeoutMs,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    return { status: res.status(), ok: res.ok(), raw: text };
  }
  return isEnvelope(body)
    ? { status: res.status(), ok: res.ok(), envelope: body, decrypted: decryptEnvelope(body, key) }
    : { status: res.status(), ok: res.ok(), decrypted: body };
}

export interface FinishedJob {
  readonly id: string;
  readonly status: 'done' | 'failed';
  readonly draftId: string | null;
  readonly errorKey: string | null;
}

/** Queues an import and waits for the worker to finish it (or the budget to run out). */
export async function runImport(api: RecipelyApi, token: string, url: string, budgetMs = 420_000): Promise<FinishedJob> {
  const queued = await api.post('/recipes/import/jobs', { url }, token);
  if (queued.status !== 202) throw new Error(`enqueue ${url} → ${queued.status} ${JSON.stringify(errorOf(queued))}`);
  const id = dataOf(queued).id as string;
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    const job = dataOf(await api.get(`/recipes/import/jobs/${id}`, token));
    if (job?.status === 'done' || job?.status === 'failed') return job as FinishedJob;
  }
  throw new Error(`import ${url} (${id}) did not finish in ${budgetMs} ms`);
}

/** Model-side outages that the brief counts as SKIP, not FAIL (Gemini 503 with Groq also down). */
export const PROVIDER_OUTAGE_KEYS: readonly string[] = [
  'errors.ai.upstream_failed',
  'errors.ai.provider_not_configured',
];

/** Best-effort cleanup; never fails a test. */
export async function quietly(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch {
    /* cleanup only */
  }
}
