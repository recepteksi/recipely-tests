import { test, expect } from '@playwright/test';
import { Recipely } from '../../helpers/recipely';

/**
 * Responsive layout sanity. Runs across every project (desktop + mobile + tablet
 * device emulation), so a single assertion set covers all viewports.
 */
test.describe('Web · responsive layout', () => {
  let app: Recipely;

  test.beforeEach(async ({ page }) => {
    app = new Recipely(page);
    await app.goto();
  });

  test('no horizontal overflow at the current viewport', async ({ page }) => {
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      // 1px tolerance for sub-pixel rounding.
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('login form is usable (can type into both fields)', async () => {
    await app.emailInput.fill('layout@recipely.net');
    await app.passwordInput.fill('hunter2-password');
    await expect(app.emailInput).toHaveValue('layout@recipely.net');
    await expect(app.passwordInput).toHaveValue('hunter2-password');
  });

  test('the sign-in CTA stays within the viewport width', async ({ page }) => {
    const box = await app.signInButton.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    if (box && viewport) {
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
  });
});
