import fs from 'fs';
import path from 'path';
import { test, expect, CAN_RUN_AUTHED, AUTH_SKIP_REASON, login } from '../../helpers/auth';
import { RecipelyApi } from '../../helpers/api';
import { TEST_EMAIL, TEST_PASSWORD } from '../../helpers/config';
import { dataOf, errorOf, postMultipart, quietly, runImport } from '../../helpers/live';

/**
 * The owner's lifecycle of a saved recipe, live: private by default, publish /
 * unpublish, the copyright gate on a web import, photos, the background sweeps
 * (nutrition and photo focus) and the devices table.
 *
 * Gated by `RECIPELY_LIFECYCLE_E2E=1`: publishing runs the moderator and the
 * sweeps call a model. `backend-direct` only.
 *
 * Not covered: "another user gets 403" — the suite has one account.
 * Cleanup: recipes and drafts are deleted through the owner API. Device rows
 * cannot be: there is no owner endpoint to delete one (the backend caps them
 * at 20 per user and evicts the oldest). The 429 test spends the account's
 * device-heartbeat budget for the hour.
 */
const LIVE = process.env.RECIPELY_LIFECYCLE_E2E === '1';
const SWEEP_BUDGET_MS = 15 * 60_000;
const PHOTO = path.join(__dirname, '..', 'fixtures', 'recipe.png');

const manualRecipe = (tag: string): Record<string, unknown> => ({
  name: { tr: `${tag} Mercimek Çorbası` },
  cuisine: 'TURKISH',
  category: 'SOUP',
  difficulty: 'EASY',
  ingredients: { tr: ['1 su bardağı kırmızı mercimek', '1 adet soğan', '1 adet havuç', '1 yemek kaşığı tereyağı', '6 su bardağı su'] },
  instructions: { tr: ['Soğanı ve havucu tereyağında kavur.', 'Mercimeği ve suyu ekleyip 25 dakika pişir.', 'Blenderdan geçirip servis et.'] },
  prepTimeMinutes: 10,
  cookTimeMinutes: 25,
  servings: 4,
  visibility: 'private',
  locale: 'tr',
});

test.describe('Live · recipe lifecycle', () => {
  test.skip(!LIVE, 'Set RECIPELY_LIFECYCLE_E2E=1 to run the live lifecycle (moderator + sweeps).');
  test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);
  test.describe.configure({ mode: 'serial' });

  const recipes: string[] = [];
  const drafts: string[] = [];
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'backend-direct', 'Live lifecycle runs once, on backend-direct.'));
  test.afterAll(async ({ api, session }) => {
    for (const id of recipes) await quietly(() => api.del(`/recipes/${id}`, session.token));
    for (const id of drafts) await quietly(() => api.del(`/recipes/drafts/${id}`, session.token));
  });

  test('a new recipe is private, publish makes it public, unpublish hides it again', async ({ api, session }) => {
    const tag = `E2E-${Date.now()}`;
    const created = await api.post('/recipes', manualRecipe(tag), session.token);
    expect(created.status).toBe(201);
    const id = dataOf(created).id as string;
    recipes.push(id);
    const inFeed = async (): Promise<boolean> =>
      (dataOf(await api.get(`/recipes?search=${encodeURIComponent(tag)}&pageSize=50`)).items as { id: string }[]).some((r) => r.id === id);

    expect(dataOf(created)).toMatchObject({ isPublished: false, moderationStatus: 'unreviewed' });
    expect((await api.get(`/recipes/${id}`)).status).toBe(404);
    expect(await inFeed()).toBe(false);

    const published = await api.post(`/recipes/${id}/publish`, {}, session.token);
    expect(published.status).toBe(200);
    expect(dataOf(published)).toMatchObject({ isPublished: true, moderationStatus: 'approved' });
    expect((await api.get(`/recipes/${id}`)).status).toBe(200);
    expect(await inFeed()).toBe(true);

    const unpublished = await api.post(`/recipes/${id}/unpublish`, {}, session.token);
    expect(unpublished.status).toBe(200);
    expect(dataOf(unpublished).isPublished).toBe(false);
    expect((await api.get(`/recipes/${id}`)).status).toBe(404);
    expect(await inFeed()).toBe(false);
  });

  test('a web import is refused publication until its photo and text are the owner’s own', async ({ api, session }) => {
    test.setTimeout(180_000);
    const url = 'https://yemek.com/tarif/trilece/';
    // One recipe per link per owner (`errors.conflict.recipe_exists`): clear a leftover from an aborted run.
    for (const row of dataOf(await api.get('/me/recipes?pageSize=50', session.token)).items as { id: string }[]) {
      if (dataOf(await api.get(`/recipes/${row.id}`, session.token)).sourceUrl === url) await api.del(`/recipes/${row.id}`, session.token);
    }
    const job = await runImport(api, session.token, url);
    expect(job.status, `errorKey=${job.errorKey}`).toBe('done');
    drafts.push(job.draftId!);
    const s = dataOf(await api.get(`/recipes/drafts/${job.draftId}`, session.token)).snapshot;
    const created = await api.post(
      '/recipes',
      {
        name: { tr: s.name }, cuisine: s.cuisine, category: s.category, difficulty: s.difficulty,
        ingredients: { tr: s.ingredients }, instructions: { tr: s.instructions },
        prepTimeMinutes: s.prepTimeMinutes, cookTimeMinutes: s.cookTimeMinutes, servings: s.servings,
        image: s.image, fromDraftId: job.draftId, visibility: 'private', locale: 'tr',
      },
      session.token,
    );
    expect(created.status, JSON.stringify(errorOf(created))).toBe(201);
    const id = dataOf(created).id as string;
    recipes.push(id);

    // Provenance reaches the wire (backend #356): the app's seal names the platform from it.
    const detail = dataOf(await api.get(`/recipes/${id}`, session.token));
    expect(detail).toMatchObject({ sourcePlatform: 'WEB', aiWritten: false, sourceHandle: 'yemek.com', sourceUrl: url });

    const blocked = await api.post(`/recipes/${id}/publish`, {}, session.token);
    expect(blocked.status).toBe(409);
    expect(errorOf(blocked).details.blockers).toEqual(['photo', 'ingredients', 'instructions']);

    expect((await api.del(`/recipes/${id}/cover`, session.token)).status).toBe(200);
    const stillBlocked = await api.post(`/recipes/${id}/publish`, {}, session.token);
    expect(errorOf(stillBlocked).details.blockers).toEqual(['ingredients', 'instructions']);

    const edited = await api.patch(
      `/recipes/${id}`,
      {
        ingredients: { tr: s.ingredients.map((l: string) => (l.startsWith('# ') ? l : `${l} (kendi notum)`)) },
        instructions: { tr: ['Keki çırpıp pişir, soğut.', 'Sütlü şerbeti dök, dinlendir.', 'Karameli sür, soğuk servis et.'] },
      },
      session.token,
    );
    expect(edited.status).toBe(200);
    expect(dataOf(await api.get(`/recipes/${id}`, session.token)).publishBlockers).toEqual([]);

    const published = await api.post(`/recipes/${id}/publish`, {}, session.token);
    expect(published.status).toBe(200);
    expect(dataOf(published).isPublished).toBe(true);
  });

  test('photos: add two, the list row counts them, remove one; nutrition and focus arrive from the sweeps', async ({ api, session, request }) => {
    test.setTimeout(SWEEP_BUDGET_MS + 120_000);
    const created = await api.post('/recipes', manualRecipe(`E2E-${Date.now()}`), session.token);
    const id = dataOf(created).id as string;
    recipes.push(id);
    const photo = { name: 'recipe.png', mimeType: 'image/png', buffer: fs.readFileSync(PHOTO) };

    // The photo moderator is a model call; both providers rate-limited is an outage, not a failure.
    for (let i = 0; i < 2; i++) {
      let added = await postMultipart(request, `/recipes/${id}/media`, 'photo', [photo], session.token);
      if (added.status === 503) {
        await new Promise((r) => setTimeout(r, 30_000));
        added = await postMultipart(request, `/recipes/${id}/media`, 'photo', [photo], session.token);
      }
      test.skip(added.status === 503, `photo moderator providers down twice: ${JSON.stringify(errorOf(added))}`);
      expect(added.status, JSON.stringify(errorOf(added))).toBe(201);
    }
    const withTwo = dataOf(await api.get(`/recipes/${id}`, session.token));
    expect(withTwo.mediaCount).toBe(2);
    const row = (dataOf(await api.get('/me/recipes?pageSize=50', session.token)).items as { id: string; mediaCount: number }[]).find((r) => r.id === id);
    expect(row?.mediaCount).toBe(2);

    expect((await api.del(`/recipes/${id}/media/${withTwo.media[1].id}`, session.token)).status).toBe(204);
    expect(dataOf(await api.get(`/recipes/${id}`, session.token)).mediaCount).toBe(1);

    // Both sweeps tick every 10 minutes on the API box. A poll that lands on a
    // deploy restart times out; that is not an answer, so it reads as "not yet".
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detailOrNull = async (): Promise<any> => {
      try {
        return dataOf(await api.get(`/recipes/${id}`, session.token)) ?? {};
      } catch {
        return {};
      }
    };
    await expect
      .poll(async () => (await detailOrNull()).nutrition?.servingWeightGrams ?? null, { timeout: SWEEP_BUDGET_MS, intervals: [30_000] })
      .not.toBeNull();
    await expect
      .poll(async () => (await detailOrNull()).media?.[0]?.focus ?? null, { timeout: SWEEP_BUDGET_MS, intervals: [30_000] })
      .toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  });

  test('devices: POST records one, login with a device records it, the 31st call in an hour is 429', async ({ api, session, request }) => {
    const deviceId = `e2e-${Date.now()}`;
    const recorded = await api.post('/me/devices', { deviceId, platform: 'web', appVersion: 'e2e' }, session.token);
    expect(recorded.status).toBe(204);
    const listed = dataOf(await api.get('/me/devices', session.token)) as { deviceId: string }[];
    expect(listed.map((d) => d.deviceId)).toContain(deviceId);

    const loginDevice = `e2e-login-${Date.now()}`;
    const loggedIn = await new RecipelyApi(request).post('/auth/login', {
      email: TEST_EMAIL, password: TEST_PASSWORD, device: { deviceId: loginDevice, platform: 'ios', appVersion: '9.9.9' },
    });
    expect(loggedIn.status).toBe(200);
    const afterLogin = dataOf(await api.get('/me/devices', session.token)) as { deviceId: string; platform: string }[];
    expect(afterLogin.find((d) => d.deviceId === loginDevice)?.platform).toBe('ios');

    const token = (await login(request)).token;
    let status = 0;
    for (let call = 2; call <= 31 && status !== 429; call++) {
      status = (await api.post('/me/devices', { deviceId, platform: 'web', appVersion: 'e2e' }, token)).status;
    }
    expect(status).toBe(429);
  });
});
