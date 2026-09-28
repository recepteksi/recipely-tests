import { test, expect } from '@playwright/test';
import { HEALTH_URL, READY_URL } from '../../helpers/config';

/**
 * Backend liveness & readiness.
 *
 * `/health` and `/health/ready` are UNVERSIONED (mounted on the Express app
 * root, outside /api/v1): plain JSON, no AES envelope, no auth. They are the
 * cheapest signal that the process is up and its dependencies (DB) are wired.
 */
test.describe('Backend · health', () => {
  test('GET /health returns 200 with status ok', async ({ request }) => {
    const res = await request.get(HEALTH_URL);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok' });
  });

  test('GET /health/ready reports readiness', async ({ request }) => {
    const res = await request.get(READY_URL);
    // Ready when dependencies are reachable; 503 if the DB is down. Either is a
    // valid, well-formed answer — what we assert is the contract, not the mood.
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty('status');
  });

  test('health is plain JSON (no AES envelope, no auth required)', async ({ request }) => {
    const res = await request.get(HEALTH_URL);
    expect(res.headers()['content-type'] ?? '').toContain('application/json');
    const body = await res.json();
    // A raw `{ payload, iv }` envelope would mean health got wrapped — it must not.
    expect(body).not.toHaveProperty('payload');
    expect(body).not.toHaveProperty('iv');
  });

  test('responds quickly (under 5s)', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(HEALTH_URL);
    expect(res.ok()).toBeTruthy();
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  test('HEAD /health is accepted (uptime monitors often probe with HEAD)', async ({ request }) => {
    const res = await request.head(HEALTH_URL);
    // Express answers GET routes for HEAD too; a monitor must not get a 404/405.
    expect(res.status()).toBeLessThan(400);
  });
});
