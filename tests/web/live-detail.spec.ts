import { test, expect, type Page } from '@playwright/test';
import { RecipelyApi } from '../../helpers/api';
import { login, CAN_RUN_AUTHED, AUTH_SKIP_REASON } from '../../helpers/auth';
import { TEST_EMAIL, TEST_PASSWORD } from '../../helpers/config';
import { dataOf, quietly } from '../../helpers/live';

/**
 * Web UI smoke of the recipe detail and the import screen, in Turkish, on a
 * desktop and a 390 px phone (`desktop-chromium`, `mobile-iphone`).
 *
 * Gated by `RECIPELY_UI_E2E=1` because it logs in as the test account and
 * writes a disposable private recipe. Point `RECIPELY_WEB_URL` at
 * `https://app-recipely-dev.web.app` for dev: `dev.recipely.net` sits behind
 * Cloudflare Access, which a test browser cannot pass.
 */
const LIVE = process.env.RECIPELY_UI_E2E === '1';
const PROJECTS = ['desktop-chromium', 'mobile-iphone'];

/** The mobile section header is upper-cased; `/i` cannot fold `İ`, so both spellings are named. */
const NUTRITION_HEADING = /^(Besin değerleri|BESİN DEĞERLERİ)$/;

async function signIn(page: Page): Promise<void> {
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.getByPlaceholder('E-posta').fill(TEST_EMAIL);
  await page.getByPlaceholder('Şifre').fill(TEST_PASSWORD);
  await page.getByText('Giriş yap', { exact: true }).click();
  await page.waitForURL(/\/recipes/, { timeout: 30_000 });
}

test.use({ locale: 'tr-TR' });

test.describe('Live · web recipe detail and import screen', () => {
  test.skip(!LIVE, 'Set RECIPELY_UI_E2E=1 to run the live web smoke.');
  test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);
  test.beforeEach(({}, info) => test.skip(!PROJECTS.includes(info.project.name), 'Runs on desktop-chromium and the 390 px phone only.'));

  test('a public recipe shows one nutrition heading, a working 100 g / serving switch, Turkish difficulty and its photos', async ({ page, request }) => {
    const api = new RecipelyApi(request, 'tr');
    let recipeId: string | undefined;
    for (let pageNo = 1; pageNo <= 6 && recipeId === undefined; pageNo++) {
      const list = dataOf(await api.get(`/recipes?page=${pageNo}&pageSize=50`)).items as { id: string; mediaCount: number }[];
      for (const row of list.filter((r) => r.mediaCount >= 2)) {
        if (dataOf(await api.get(`/recipes/${row.id}`)).nutrition?.servingWeightGrams) { recipeId = row.id; break; }
      }
    }
    test.skip(recipeId === undefined, 'no public recipe with two photos and a serving weight on this environment');

    await page.goto(`/recipes/${recipeId}`, { waitUntil: 'networkidle' });

    await expect(page.getByText(NUTRITION_HEADING)).toHaveCount(1);
    await expect(page.getByText(/^(Kolay|Orta|Zor)$/).first()).toBeVisible();
    await expect(page.getByText(/^(EASY|MEDIUM|HARD)$/)).toHaveCount(0);
    await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();
    expect(await page.getByRole('tab', { name: /fotoğraftan/ }).count()).toBeGreaterThanOrEqual(2);

    // The phone's floating bookmark once announced "Add to favorites" on a Turkish screen (app #483).
    await expect(page.getByRole('button', { name: /favorites/i })).toHaveCount(0);

    const nutrition = page.getByRole('radiogroup', { name: 'Besin değerlerini göster' });
    await expect(nutrition.getByRole('radio', { name: '100 g' })).toBeVisible();
    await expect(page.getByText('Kalori 100 g başına')).toBeVisible();
    const per100 = await page.getByText('kcal', { exact: true }).first().locator('xpath=preceding-sibling::*[1]').innerText();

    await nutrition.getByRole('radio', { name: /1 porsiyon/ }).click();

    await expect(page.getByText('Kalori porsiyon başına')).toBeVisible();
    const perServing = await page.getByText('kcal', { exact: true }).first().locator('xpath=preceding-sibling::*[1]').innerText();
    expect(perServing).not.toBe(per100);
  });

  test('an owned recipe with no photo offers to add the first one, and the import screen names its sources and the 3-minute limit', async ({ page, request }) => {
    const api = new RecipelyApi(request, 'tr');
    const session = await login(request);
    const created = await api.post(
      '/recipes',
      {
        name: { tr: `E2E Fotoğrafsız ${Date.now()}` }, cuisine: 'TURKISH', category: 'RICE', difficulty: 'HARD',
        ingredients: { tr: ['1 su bardağı pirinç', '2 su bardağı su'] }, instructions: { tr: ['Pirinci yıka.', 'Suyla 15 dakika pişir.'] },
        prepTimeMinutes: 5, cookTimeMinutes: 15, servings: 2, visibility: 'private',
      },
      session.token,
    );
    const recipeId = dataOf(created).id as string;

    try {
      await signIn(page);
      await page.goto(`/recipes/${recipeId}`, { waitUntil: 'networkidle' });
      await expect(page.getByText('İlk fotoğrafı ekle')).toBeVisible();
      await expect(page.getByText(/^Zor$/).first()).toBeVisible();

      await page.goto('/import-recipe', { waitUntil: 'networkidle' });
      await expect(page.getByText(/Instagram, TikTok, YouTube ya da Facebook/)).toBeVisible();
      await expect(page.getByText(/tarif sitesi/).first()).toBeVisible();
      await expect(page.getByText(/en fazla 3 dakika/)).toBeVisible();

      // x.com is refused before any request, with the unsupported-source copy.
      await page.getByPlaceholder(/bağlantısı yapıştır/).fill('https://x.com/nytfood');
      await page.getByText('Tarifi yükle', { exact: true }).click();
      await expect(page.getByText(/İçe aktarma Instagram, TikTok, YouTube ve Facebook videolarıyla/)).toBeVisible();
    } finally {
      await quietly(() => api.del(`/recipes/${recipeId}`, session.token));
    }
  });
});
