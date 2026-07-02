import { test, expect, type Page } from '@playwright/test';
import { Recipely } from '../../helpers/recipely';
import { RecipelyApi } from '../../helpers/api';
import { login } from '../../helpers/auth';
import { decryptEnvelope, isEnvelope, keyFromHex } from '../../helpers/envelope';
import {
  API_V1_URL,
  API_AES_KEY_HEX,
  HAS_REAL_AES_KEY,
  HAS_TEST_ACCOUNT,
  TEST_EMAIL,
  TEST_PASSWORD,
  RECIPES_PATH,
  recipePath,
} from '../../helpers/config';

/**
 * Real AI recipe creation, end-to-end in the browser — the ONLY spec that
 * invokes the actual model pipeline (Gemini) and publishes a real recipe.
 *
 * Because each run costs real money and minutes, the spec is double-gated:
 *   - `RECIPELY_AI_E2E=1` must be set explicitly (a plain `npm test` skips it);
 *   - it runs on the `desktop-chromium` project only, so a full-matrix run
 *     never multiplies the model invocation across browsers/devices.
 *
 * Flow under test (the unified /create-recipe screen):
 *   prompt → generate (real model) → preview appears with content
 *   → publish WITHOUT a photo → blocked with the "add at least one photo" note
 *   → add a photo (expo-image-picker web file chooser) → publish
 *   → lands on /my-recipes with the recipe visible
 *   → backend GET proves the stored recipe carries a real image URL
 *   → cleanup: the published recipe is deleted via the owner API.
 */
const AI_E2E_ENABLED = process.env.RECIPELY_AI_E2E === '1';

/** Longest we're willing to wait for the model to draft the recipe. */
const GENERATE_TIMEOUT_MS = 240_000;
/** Upload + create round-trip (multipart with the photo) can be slow. */
const PUBLISH_TIMEOUT_MS = 120_000;

const PROMPT_TEXT =
  'A quick Turkish red lentil soup (mercimek corbasi) for 4 people, ready in 30 minutes';

test.describe('Web · AI recipe creation (real model)', () => {
  test.skip(!AI_E2E_ENABLED, 'Set RECIPELY_AI_E2E=1 to run the real AI generation flow (invokes the model, costs money).');
  test.skip(!HAS_TEST_ACCOUNT || !HAS_REAL_AES_KEY, 'Needs RECIPELY_TEST_EMAIL/PASSWORD + real RECIPELY_API_AES_KEY.');

  test('generate → publish blocked without photo → add photo → publish → verify + cleanup', async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', 'AI E2E runs once, on desktop-chromium only.');
    test.setTimeout(GENERATE_TIMEOUT_MS + PUBLISH_TIMEOUT_MS + 240_000);

    const key = keyFromHex(API_AES_KEY_HEX);

    // Capture the id of the recipe the app publishes so we can verify and
    // clean it up via the API even though the wire payload is encrypted.
    let createdId: string | null = null;
    page.on('response', (res) => {
      const req = res.request();
      // The app publishes via multipart POST /recipes/with-media (bare
      // /recipes also counts, defensively). NOT /recipes/generate — that one
      // returns a not-persisted preview id, not the published recipe.
      const url = res.url();
      const isCreate =
        url === `${API_V1_URL}${RECIPES_PATH}` ||
        url === `${API_V1_URL}${RECIPES_PATH}/with-media`;
      if (req.method() !== 'POST' || !isCreate) return;
      if (res.status() >= 300) return;
      void res
        .json()
        .then((body: unknown) => {
          if (!isEnvelope(body)) return;
          const dec = decryptEnvelope(body, key) as { data?: { id?: string } };
          if (typeof dec?.data?.id === 'string') createdId = dec.data.id;
        })
        .catch(() => undefined);
    });

    try {
      // ---- 1. Sign in and open the unified create flow -------------------
      const app = new Recipely(page);
      await app.goto();
      await app.signInUntilHome(TEST_EMAIL, TEST_PASSWORD);
      await page.goto('/create-recipe', { waitUntil: 'load' });

      const promptBox = page.getByPlaceholder(/creamy lemon-garlic pasta/i);
      await expect(promptBox).toBeVisible({ timeout: 20_000 });

      // ---- 2. Generate with the real model --------------------------------
      await promptBox.fill(PROMPT_TEXT);
      await page.getByText('Generate recipe', { exact: true }).click();
      await expect(page.getByText('Cooking up your recipe')).toBeVisible({ timeout: 15_000 });

      const nameInput = page.getByPlaceholder('e.g. Lemon Garlic Pasta');
      await expect(nameInput).toBeVisible({ timeout: GENERATE_TIMEOUT_MS });
      await expect(nameInput).not.toHaveValue('', { timeout: 10_000 });
      const generatedName = await nameInput.inputValue();

      // The model must have produced at least one real ingredient row.
      const firstIngredient = page.getByPlaceholder('e.g. 2 tbsp olive oil').first();
      await expect(firstIngredient).not.toHaveValue('');

      // ---- 3. Publishing WITHOUT a photo must be blocked -------------------
      const saveButton = page.getByRole('button', { name: 'Save', exact: true });
      await saveButton.click();
      await expect(page.getByText('Please add at least one photo.')).toBeVisible();
      await expect(page).toHaveURL(/create-recipe/);

      // ---- 4. Add a photo via the photos sheet (web file chooser) ----------
      // Any valid PNG works as the "gallery" pick; a viewport screenshot is a
      // convenient real image with no fixture file to maintain.
      const photoBuffer = await page.screenshot();
      await page.getByRole('button', { name: 'Add a cover photo' }).click();
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 15_000 });
      await page.getByRole('button', { name: 'Add photos' }).click();
      const chooser = await chooserPromise;
      await chooser.setFiles({
        name: 'ai-e2e-cover.png',
        mimeType: 'image/png',
        buffer: photoBuffer,
      });
      await expect(page.getByText('Cover', { exact: true })).toBeVisible({ timeout: 15_000 });
      await page.getByText('Done', { exact: true }).click();

      // ---- 5. Publish for real ---------------------------------------------
      await saveButton.click();
      await expect(page).toHaveURL(/my-recipes/, { timeout: PUBLISH_TIMEOUT_MS });
      await expect.poll(() => createdId, { timeout: 15_000 }).not.toBeNull();

      // The published recipe shows up in My Recipes (Created tab).
      const createdTab = page.getByText('Created', { exact: true }).first();
      if (await createdTab.count()) await createdTab.click();
      await expect(page.getByText(generatedName, { exact: false }).first()).toBeVisible({
        timeout: 20_000,
      });

      // ---- 6. Backend proof: stored recipe carries a real image URL --------
      const api = new RecipelyApi(request);
      const session = await login(request);
      const stored = await api.get(recipePath(createdId!), session.token);
      expect(stored.status).toBe(200);
      const recipe = (stored.decrypted as { data?: { image?: string; name?: string } }).data;
      expect(recipe?.image ?? '').toMatch(/^https?:\/\//);
    } finally {
      // ---- 7. Cleanup: delete the published recipe as its owner ------------
      if (createdId !== null) {
        const api = new RecipelyApi(request);
        const session = await login(request);
        const del = await api.del(recipePath(createdId), session.token);
        testInfo.annotations.push({
          type: 'cleanup',
          description: `DELETE ${recipePath(createdId)} → ${del.status}`,
        });
      }
    }
  });
});
