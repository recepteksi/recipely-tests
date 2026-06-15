import { test, expect } from '@playwright/test';
import { PRIVACY_URL, TERMS_URL } from '../../helpers/config';

/**
 * Public legal pages served as static HTML at the server root (outside
 * /api/v1). These are the URLs submitted to Google Play, so they must stay
 * reachable and serve HTML.
 */
test.describe('Backend · static legal pages', () => {
  for (const [name, url] of [
    ['Privacy Policy', PRIVACY_URL],
    ['Terms of Use', TERMS_URL],
  ] as const) {
    test(`${name} is reachable and served as HTML`, async ({ request }) => {
      const res = await request.get(url);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type'] ?? '').toContain('text/html');
      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
      expect(body.toLowerCase()).toContain('<html');
    });
  }
});
