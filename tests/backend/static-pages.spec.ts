import { test, expect } from '@playwright/test';
import { PRIVACY_URL, TERMS_URL, API_URL } from '../../helpers/config';

/**
 * Public legal pages served as static HTML at the server root (outside
 * /api/v1). These are the exact URLs submitted to Google Play / the App Store,
 * so they must stay publicly reachable, serve real HTML, and mention their
 * subject. We also assert the server's security headers (Helmet) and its 404
 * behaviour for unknown root paths.
 */
test.describe('Backend · static legal pages', () => {
  for (const [name, url, keyword] of [
    ['Privacy Policy', PRIVACY_URL, 'privacy'],
    ['Terms of Use', TERMS_URL, 'terms'],
  ] as const) {
    test(`${name} is reachable and served as HTML`, async ({ request }) => {
      const res = await request.get(url);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type'] ?? '').toContain('text/html');
      const body = await res.text();
      expect(body.length).toBeGreaterThan(0);
      expect(body.toLowerCase()).toContain('<html');
    });

    test(`${name} content mentions its subject`, async ({ request }) => {
      const res = await request.get(url);
      const body = (await res.text()).toLowerCase();
      expect(body).toContain(keyword);
    });
  }

  test('responses carry Helmet security headers', async ({ request }) => {
    const res = await request.get(PRIVACY_URL);
    const headers = res.headers();
    // Helmet defaults applied app-wide. These protect every surface, not just
    // the legal pages, so the cheapest place to assert them is here.
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']?.toLowerCase()).toBe('sameorigin');
  });

  test('unknown root path returns a plain 404 (not an envelope)', async ({ request }) => {
    const res = await request.get(`${API_URL}/this-path-does-not-exist-xyz`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    // Outside /api/v1 the 404 stays plain JSON — the envelope only wraps the
    // versioned API surface.
    expect(body).not.toHaveProperty('payload');
    expect(body).toHaveProperty('error');
  });
});
