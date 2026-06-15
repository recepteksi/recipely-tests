import { test, expect } from '@playwright/test';
import { HEALTH_URL } from '../../helpers/config';

/**
 * Backend liveness. `/health` is unversioned (mounted on the Express app root,
 * outside /api/v1) and returns plain JSON — no envelope, no auth.
 */
test.describe('Backend · health', () => {
  test('GET /health returns 200 with status ok', async ({ request }) => {
    const res = await request.get(HEALTH_URL);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok' });
  });

  test('responds quickly (under 5s)', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(HEALTH_URL);
    expect(res.ok()).toBeTruthy();
    expect(Date.now() - start).toBeLessThan(5_000);
  });
});
