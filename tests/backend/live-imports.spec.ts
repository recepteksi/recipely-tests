import fs from 'fs';
import path from 'path';
import { test, expect, CAN_RUN_AUTHED, AUTH_SKIP_REASON } from '../../helpers/auth';
import { dataOf, errorOf, postMultipart, quietly, runImport, PROVIDER_OUTAGE_KEYS } from '../../helpers/live';

/**
 * Recipe creation from every import source, live, through the backend's queue.
 *
 * Double-gated like ai-create: `RECIPELY_IMPORT_E2E=1` (each video import is a
 * worker run plus model calls) and a real key + test account. Runs on
 * `backend-direct` only so the mobile axis does not repeat the paid work.
 *
 * Every URL is a REAL public post, confirmed with yt-dlp / curl when this was
 * written (2026-09-28). Never replace one with an invented id: a made-up TikTok
 * id once read exactly like an IP block and cost a day. If a post disappears,
 * pick another real one and confirm it resolves first.
 *
 * Cleanup: every draft an import makes is deleted through the owner API.
 */
const LIVE = process.env.RECIPELY_IMPORT_E2E === '1';

const SOURCES = [
  { name: 'Instagram reel', url: 'https://www.instagram.com/reel/DcBqwv5Nsx7/', platform: 'INSTAGRAM', handle: 'guneycooks', notif: 'Instagram' },
  { name: 'TikTok video', url: 'https://www.tiktok.com/@tasty/video/7689234358238022943', platform: 'TIKTOK', handle: 'tasty', notif: 'TikTok' },
  // Given by the user. Its caption lives in yt-dlp's `title` (backend #355).
  { name: 'Facebook reel', url: 'https://www.facebook.com/share/r/192Dg7W54U/', platform: 'FACEBOOK', handle: 'Farklıyemektarifleri', notif: 'Facebook' },
  { name: 'YouTube video under 3 min', url: 'https://www.youtube.com/watch?v=SKDki3BPLzU', platform: 'YOUTUBE', handle: 'Natashas Kitchen', notif: 'YouTube' },
  // A pin linking to nefisyemektarifleri.com; foodnetwork/allrecipes pins block the worker's datacenter IP.
  { name: 'Pinterest pin', url: 'https://www.pinterest.com/pin/274649277272230097/', platform: 'WEB', handle: 'nefisyemektarifleri.com', notif: 'nefisyemektarifleri.com' },
  { name: 'web page (yemek.com trileçe)', url: 'https://yemek.com/tarif/trilece/', platform: 'WEB', handle: 'yemek.com', notif: 'yemek.com' },
] as const;

/** 209 s — over the 180 s cap. */
const LONG_VIDEO = 'https://www.tiktok.com/@cookingwithlynja/video/7323254005742996782';

test.describe('Live · imports from every source', () => {
  test.skip(!LIVE, 'Set RECIPELY_IMPORT_E2E=1 to run real imports (worker + model calls).');
  test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);
  test.describe.configure({ mode: 'serial' });

  const drafts: string[] = [];
  test.beforeEach(({}, info) => test.skip(info.project.name !== 'backend-direct', 'Live imports run once, on backend-direct.'));
  test.afterAll(async ({ api, session }) => {
    for (const id of drafts) await quietly(() => api.del(`/recipes/drafts/${id}`, session.token));
  });

  for (const source of SOURCES) {
    test(`${source.name} becomes a draft with its platform, handle, link, ingredients and steps`, async ({ api, session }) => {
      test.setTimeout(480_000);

      let job = await runImport(api, session.token, source.url);
      if (job.status === 'failed' && PROVIDER_OUTAGE_KEYS.includes(job.errorKey ?? '')) job = await runImport(api, session.token, source.url);
      test.skip(job.status === 'failed' && PROVIDER_OUTAGE_KEYS.includes(job.errorKey ?? ''), `model providers down twice: ${job.errorKey}`);

      expect(job.status, `job ${job.id} errorKey=${job.errorKey}`).toBe('done');
      drafts.push(job.draftId!);
      const snapshot = dataOf(await api.get(`/recipes/drafts/${job.draftId}`, session.token)).snapshot;
      expect(snapshot.sourcePlatform).toBe(source.platform);
      expect(snapshot.sourceHandle).toBe(source.handle);
      expect(snapshot.sourceUrl).toBe(source.url);
      expect(snapshot.ingredients.filter((l: string) => !l.startsWith('# ')).length).toBeGreaterThan(1);
      expect(snapshot.instructions.length).toBeGreaterThan(0);

      if (source.url.includes('yemek.com')) {
        // yemek.com gives the cake, the caramel and the milk syrup as three lists; they must stay three.
        const groups = snapshot.ingredients.filter((l: string) => l.startsWith('# '));
        expect(groups).toHaveLength(3);
        expect(groups.join(' ')).toMatch(/keki/i);
        expect(groups.join(' ')).toMatch(/karamel/i);
        expect(groups.join(' ')).toMatch(/şerbet/i);
      }

      const inbox = dataOf(await api.get('/me/notifications', session.token)).items as {
        type: string;
        draftId: string | null;
        message: string | null;
        sourcePlatform?: string | null;
        sourceHandle?: string | null;
      }[];
      const row = inbox.find((n) => n.draftId === job.draftId);
      expect(row?.type).toBe('import_done');
      expect(row?.message).toBe(snapshot.name);
      // The inbox row names the same source the push did; without it the app drew Instagram on every import (backend #360).
      expect(row?.sourcePlatform).toBe(source.platform);
      expect(row?.sourceHandle).toBe(source.handle);
    });
  }

  test('a video over 3 minutes is refused with the duration error', async ({ api, session }) => {
    test.setTimeout(300_000);

    const job = await runImport(api, session.token, LONG_VIDEO);

    expect(job.status).toBe('failed');
    expect(job.errorKey).toBe('errors.import.duration_exceeded');
  });

  test('a photo and a PDF of a written recipe each become a model-written draft', async ({ api, session, request }) => {
    test.setTimeout(240_000);
    const fixtures = path.join(__dirname, '..', 'fixtures');

    for (const [file, mimeType] of [['recipe.png', 'image/png'], ['recipe.pdf', 'application/pdf']] as const) {
      const res = await postMultipart(request, '/recipes/import/file', 'files', [{ name: file, mimeType, buffer: fs.readFileSync(path.join(fixtures, file)) }], session.token);
      test.skip(res.status === 503, `model providers down: ${JSON.stringify(errorOf(res))}`);
      expect(res.status, JSON.stringify(errorOf(res))).toBe(201);
      const draftId = dataOf(res).draftId as string;
      drafts.push(draftId);
      const snapshot = dataOf(await api.get(`/recipes/drafts/${draftId}`, session.token)).snapshot;
      expect(snapshot.name).toMatch(/patates/i);
      expect(snapshot.ingredients.length).toBeGreaterThanOrEqual(5);
      expect(snapshot.instructions.length).toBeGreaterThanOrEqual(3);
      expect(snapshot.aiWritten).toBe(true);
    }
  });
});
