import { test as base, expect } from '@playwright/test';
import crypto from 'crypto';
import { test, CAN_RUN_AUTHED, AUTH_SKIP_REASON } from '../../helpers/auth';
import { RecipelyApi } from '../../helpers/api';
import {
  DRAFTS_PATH,
  DRAFTS_LATEST_PATH,
  draftPath,
} from '../../helpers/config';

/**
 * Drafts service — the AI recipe-builder's autosave store
 * (`/recipes/drafts/*`). Drafts are keyed by a client-generated UUID, so each
 * test is fully isolated by construction: it upserts its own draft, reads it
 * back via three routes (by id, in the list, and as "latest"), then deletes it.
 */
test.describe('Backend · drafts service', () => {
  base('listing drafts without a token returns an encrypted 401', async ({ request }) => {
    const api = new RecipelyApi(request);
    const result = await api.get(DRAFTS_PATH);
    expect(result.status).toBe(401);
    expect(result.envelope).toBeDefined();
  });

  test.describe('authenticated', () => {
    test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);

    test('upsert → get by id → list → latest → delete', async ({ api, session }) => {
      const token = session.token;
      const id = crypto.randomUUID();
      let created = false;
      try {
        // UPSERT (PUT). Body id must match the path id.
        const upsert = await api.put(
          draftPath(id),
          {
            id,
            prompt: 'A quick weeknight pasta',
            snapshot: { name: 'E2E Draft', servings: 2 },
            chatHistory: [{ role: 'user', content: 'make it vegetarian' }],
          },
          token,
        );
        expect([200, 201]).toContain(upsert.status);
        created = true;

        // GET by id
        const byId = await api.get(draftPath(id), token);
        expect(byId.status).toBe(200);
        const draft = (byId.decrypted as { data?: { id?: string; prompt?: string } })?.data;
        expect(draft?.id).toBe(id);
        expect(draft?.prompt).toBe('A quick weeknight pasta');

        // LIST includes it
        const list = await api.get(`${DRAFTS_PATH}?pageSize=50`, token);
        expect(list.status).toBe(200);
        const items =
          (list.decrypted as { data?: { items?: Array<{ id?: string }> } })?.data?.items ?? [];
        expect(items.some((d) => d.id === id)).toBe(true);

        // LATEST resolves to a draft (most-recently-updated)
        const latest = await api.get(DRAFTS_LATEST_PATH, token);
        expect(latest.status).toBe(200);

        // DELETE
        const removed = await api.del(draftPath(id), token);
        expect([200, 204]).toContain(removed.status);
        created = false;

        // CONFIRM gone
        const gone = await api.get(draftPath(id), token);
        expect(gone.status).toBe(404);
      } finally {
        if (created) await api.del(draftPath(id), token).catch(() => {});
      }
    });

    test('GET a draft with a malformed UUID returns 400 validation', async ({ api, session }) => {
      const result = await api.get(draftPath('not-a-uuid'), session.token);
      expect(result.status).toBe(400);
      const code = (result.decrypted as { error?: { code?: string } })?.error?.code;
      expect(code).toBe('validation');
    });
  });
});
