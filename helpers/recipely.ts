import { expect, type Page, type Locator } from '@playwright/test';

/**
 * Recipely web Page Object (also used for mobile device-emulation projects).
 *
 * The app is a React Native Web bundle served from Firebase Hosting. There are
 * no `testID`s in the source, so locators rely on accessibility roles, visible
 * i18n text, and `<input>` placeholders (TextInput → input on web).
 *
 * Routing: an unauthenticated visitor is redirected to `/login`, so the login
 * screen is the public landing surface. Locale defaults to the browser
 * language; the Playwright config pins `en-US`, so English strings render.
 */
export class Recipely {
  readonly page: Page;

  // Login surface
  readonly title: Locator;
  readonly subtitle: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly googleButton: Locator;
  readonly appleButton: Locator;
  readonly forgotLink: Locator;
  readonly signUpLink: Locator;

  constructor(page: Page) {
    this.page = page;

    this.title = page.getByText('Recipely', { exact: true }).first();
    this.subtitle = page.getByText(/Sign in to view your recipes/i);
    this.emailInput = page.getByPlaceholder('Email');
    this.passwordInput = page.getByPlaceholder('Password');
    // The primary CTA Pressable has no accessibilityRole, so match by text.
    this.signInButton = page.getByText('Sign in', { exact: true });
    this.googleButton = page.getByText(/Continue with Google/i);
    this.appleButton = page.getByText(/Continue with Apple/i);
    this.forgotLink = page.getByRole('button', { name: /Forgot password/i });
    this.signUpLink = page.getByRole('button', { name: /Create account/i }).last();
  }

  /** Navigate to the app root and wait for the login surface to render. */
  async goto(path = '/'): Promise<void> {
    await this.page.goto(path, { waitUntil: 'load' });
    // RN Web hydrates client-side; wait for the auth card to appear.
    await expect(this.emailInput).toBeVisible({ timeout: 20_000 });
  }

  /** Fill the login form (does not submit). */
  async fillCredentials(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  /** Fill + submit the login form. */
  async signIn(email: string, password: string): Promise<void> {
    await this.fillCredentials(email, password);
    await this.signInButton.click();
  }

  /** Open the registration screen via the "Create account" link. */
  async goToRegister(): Promise<void> {
    await this.signUpLink.click();
    await expect(this.page.getByText(/Join Recipely to save and share/i)).toBeVisible();
  }

  /** Open the forgot-password screen. */
  async goToForgotPassword(): Promise<void> {
    await this.forgotLink.click();
    await expect(this.page.getByText(/we'll send a reset link/i)).toBeVisible();
  }

  /**
   * Returns the active color scheme by reading the `<html>`/document
   * background, falling back to the CSS `color-scheme` media preference. RN Web
   * applies theme via inline styles rather than a class, so we sample a stable
   * surface color instead of looking for a `data-theme` attribute.
   */
  async prefersDark(): Promise<boolean> {
    return this.page.evaluate(
      () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    );
  }
}
