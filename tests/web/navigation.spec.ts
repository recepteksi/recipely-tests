import { test, expect } from '@playwright/test';
import { Recipely } from '../../helpers/recipely';

/**
 * Navigation between the public auth screens (login ↔ register ↔ forgot
 * password). These are reachable without a session.
 */
test.describe('Web · auth navigation', () => {
  let app: Recipely;

  test.beforeEach(async ({ page }) => {
    app = new Recipely(page);
    await app.goto();
  });

  test('login → register shows the create-account screen', async ({ page }) => {
    await app.goToRegister();
    await expect(page.getByText(/Join Recipely to save and share/i)).toBeVisible();
    await expect(page.getByText(/Already have an account/i)).toBeVisible();
    await expect(page.getByPlaceholder(/Password \(min 8 chars\)/i)).toBeVisible();
  });

  test('login → forgot password shows the reset-request screen', async ({ page }) => {
    await app.goToForgotPassword();
    await expect(page.getByText(/we'll send a reset link/i)).toBeVisible();
    await expect(page.getByText(/Send reset link/i)).toBeVisible();
    await expect(page.getByText(/Back to sign in/i)).toBeVisible();
  });

  test('register → back to login via "Sign in" link', async ({ page }) => {
    await app.goToRegister();
    // The register screen's footer offers a "Sign in" link back to login.
    await page.getByText('Sign in', { exact: true }).last().click();
    await expect(app.subtitle).toBeVisible();
  });

  test('deep-linking /register renders the register screen directly', async ({ page }) => {
    await page.goto('/register', { waitUntil: 'load' });
    await expect(page.getByText(/Join Recipely to save and share/i)).toBeVisible({
      timeout: 20_000,
    });
  });
});
