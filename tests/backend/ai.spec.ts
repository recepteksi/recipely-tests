import { test as base, expect } from '@playwright/test';
import { test, CAN_RUN_AUTHED, AUTH_SKIP_REASON } from '../../helpers/auth';
import { RecipelyApi } from '../../helpers/api';
import {
  RECIPES_GENERATE_PATH,
  RECIPES_IMPORT_PATH,
  RECIPES_REFINE_PATH,
} from '../../helpers/config';

/**
 * AI service — `/recipes/generate`, `/recipes/import`, `/recipes/refine`.
 *
 * These call Gemini / Whisper / yt-dlp on the backend and cost real money and
 * minutes per request, so this suite deliberately tests the CONTRACT ONLY: auth
 * enforcement and input validation, both of which short-circuit BEFORE the
 * expensive pipeline runs. We never submit a valid prompt/URL that would
 * actually invoke a model.
 */
test.describe('Backend · AI service (contract only)', () => {
  base.describe('auth enforcement', () => {
    for (const [name, path] of [
      ['generate', RECIPES_GENERATE_PATH],
      ['import', RECIPES_IMPORT_PATH],
      ['refine', RECIPES_REFINE_PATH],
    ] as const) {
      base(`${name} without a token returns an encrypted 401`, async ({ request }) => {
        const api = new RecipelyApi(request);
        const result = await api.post(path, {});
        expect(result.status).toBe(401);
        expect(result.envelope).toBeDefined();
      });
    }
  });

  test.describe('input validation (no model invoked)', () => {
    test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);

    test('generate rejects an empty prompt with 400 validation', async ({ api, session }) => {
      const result = await api.post(RECIPES_GENERATE_PATH, { prompt: '   ' }, session.token);
      expect(result.status).toBe(400);
      const code = (result.decrypted as { error?: { code?: string } })?.error?.code;
      expect(code).toBe('validation');
    });

    test('import rejects an empty URL with 400 validation', async ({ api, session }) => {
      const result = await api.post(RECIPES_IMPORT_PATH, { url: '' }, session.token);
      expect(result.status).toBe(400);
      const code = (result.decrypted as { error?: { code?: string } })?.error?.code;
      expect(code).toBe('validation');
    });

    test('refine rejects a missing instruction with 400 validation', async ({ api, session }) => {
      const result = await api.post(
        RECIPES_REFINE_PATH,
        { currentRecipe: { name: 'Soup' }, instruction: '' },
        session.token,
      );
      expect(result.status).toBe(400);
      const code = (result.decrypted as { error?: { code?: string } })?.error?.code;
      expect(code).toBe('validation');
    });
  });
});
