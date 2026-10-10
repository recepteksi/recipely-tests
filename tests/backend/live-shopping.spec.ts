import { test, expect, CAN_RUN_AUTHED, AUTH_SKIP_REASON } from '../../helpers/auth';
import { dataOf, quietly } from '../../helpers/live';

/**
 * The shopping list and "log a meal from text", live.
 *
 * App 1.2.0 shipped both while production had neither endpoint (backend #385
 * was never promoted), so every request failed for every user. This spec
 * proves the routes exist and round-trip on the target backend.
 *
 * Gated by `RECIPELY_SHOPPING_E2E=1`: meal parse calls a model. `backend-direct`
 * only. Cleanup: the items it adds are deleted by id.
 */
const LIVE = process.env.RECIPELY_SHOPPING_E2E === '1';

test.describe('Live · shopping list and meal parse', () => {
  test.skip(!LIVE, 'Set RECIPELY_SHOPPING_E2E=1 to run the live shopping list (meal parse calls a model).');
  test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);
  test.describe.configure({ mode: 'serial' });

  const added: string[] = [];
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'backend-direct', 'Runs once, on backend-direct.'));
  test.afterAll(async ({ api, session }) => {
    for (const id of added) await quietly(() => api.del(`/me/shopping-list/items/${id}`, session.token));
  });

  test('an item is added, listed, ticked and removed', async ({ api, session }) => {
    const label = `E2E-${Date.now()} domates`;
    const created = await api.post('/me/shopping-list/items', { items: [{ label, quantity: 3, unit: 'adet' }] }, session.token);
    expect(created.status, JSON.stringify(created.decrypted)).toBe(201);

    const listed = await api.get('/me/shopping-list', session.token);
    expect(listed.status).toBe(200);
    const items = (dataOf(listed).items ?? dataOf(listed)) as { id: string; label: string; checked: boolean }[];
    const mine = items.find((i) => i.label === label);
    expect(mine, 'the new item is in the list').toBeTruthy();
    added.push(mine!.id);

    const ticked = await api.patch(`/me/shopping-list/items/${mine!.id}`, { checked: true }, session.token);
    expect(ticked.status).toBe(200);
    expect(dataOf(ticked).checked).toBe(true);

    const removed = await api.del(`/me/shopping-list/items/${mine!.id}`, session.token);
    expect([200, 204]).toContain(removed.status);
    added.splice(added.indexOf(mine!.id), 1);
  });

  test('a meal described in text comes back as candidate foods', async ({ api, session }) => {
    const parsed = await api.post('/diary/meal-parse', { text: 'bir tabak menemen ve iki dilim ekmek', locale: 'tr' }, session.token, 90_000);
    expect(parsed.status, JSON.stringify(parsed.decrypted)).toBe(200);
    expect(JSON.stringify(dataOf(parsed))).not.toBe('{}');
  });
});
