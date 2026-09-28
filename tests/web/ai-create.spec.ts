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
 *   → Save WITHOUT a photo → a private recipe (every recipe starts private and
 *     a cover is optional since private saves shipped) → its detail page says
 *     only the owner can see it → Publish → backend GET proves it is public
 *   → cleanup: the recipe is deleted via the owner API.
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
      // Guests now land on the feed, so the sign-in form is reached by its own route.
      await app.goto('/login');
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

      // ---- 3. Save: a private recipe, no photo needed ----------------------
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: PUBLISH_TIMEOUT_MS });
      await expect.poll(() => createdId, { timeout: 15_000 }).not.toBeNull();
      await expect(page.getByText('Only you can see this recipe')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(generatedName, { exact: false }).first()).toBeVisible();

      const api = new RecipelyApi(request);
      const session = await login(request);
      const saved = (await api.get(recipePath(createdId!), session.token)).decrypted as { data?: { isPublished?: boolean; aiWritten?: boolean } };
      expect(saved.data?.isPublished).toBe(false);
      expect(saved.data?.aiWritten).toBe(true);

      // ---- 4. Publish from the detail page ---------------------------------
      await expect(page.getByText('AI-written recipe')).toBeVisible();
      await page.getByRole('button', { name: /^Publish$/ }).first().click();
      // A confirm dialog: "Publish this recipe?" — its own Publish button is the last one.
      await expect(page.getByText('Publish this recipe?')).toBeVisible();
      await page.getByRole('button', { name: /^Publish$/ }).last().click();
      await expect
        .poll(async () => ((await api.get(recipePath(createdId!))).status), { timeout: 60_000 })
        .toBe(200);
    } finally {
      // ---- 5. Cleanup: delete the recipe as its owner ----------------------
      if (createdId !== null) {
        const api = new RecipelyApi(request);
        const session = await login(request);
        const del = await api.del(recipePath(createdId), session.token);
        testInfo.annotations.push({
          type: 'cleanup',
          description: `DELETE ${recipePath(createdId)} → ${del.status}`,
        });
      }
      // A save that failed leaves the generated draft behind; this prompt is ours alone.
      const api = new RecipelyApi(request);
      const session = await login(request);
      const drafts = ((await api.get('/recipes/drafts?pageSize=50', session.token)).decrypted as { data?: { items?: { id: string; prompt: string }[] } }).data?.items ?? [];
      for (const d of drafts.filter((x) => x.prompt === PROMPT_TEXT)) await api.del(`/recipes/drafts/${d.id}`, session.token);
    }
  });
});
