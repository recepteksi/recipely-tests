import { test as base, expect } from '@playwright/test';
import {
  test,
  CAN_RUN_AUTHED,
  AUTH_SKIP_REASON,
  createRecipe,
  deleteRecipe,
} from '../../helpers/auth';
import { RecipelyApi } from '../../helpers/api';
import { recipeLikePath, recipePath } from '../../helpers/config';

/**
 * Likes service — `POST/DELETE /recipes/:id/like`. Verifies the like toggle and
 * that the recipe's `likeCount` / `isLikedByMe` reflect the change. Operates on
 * a disposable recipe and cleans up.
 */
test.describe('Backend · likes service', () => {
  base('liking without a token returns an encrypted 401', async ({ request }) => {
    const api = new RecipelyApi(request);
    const result = await api.post(recipeLikePath('00000000-0000-0000-0000-000000000000'), {});
    expect(result.status).toBe(401);
    expect(result.envelope).toBeDefined();
  });

  test.describe('authenticated', () => {
    test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);

    test('like → likeCount reflects it → unlike restores it', async ({ api, session }) => {
      const token = session.token;
      const id = await createRecipe(api, token, 'like');
      try {
        // Baseline like count from the recipe detail.
        const before = await api.get(recipePath(id), token);
        const baseCount =
          (before.decrypted as { data?: { likeCount?: number } })?.data?.likeCount ?? 0;

        // LIKE
        const liked = await api.post(recipeLikePath(id), {}, token);
        expect([200, 201, 204]).toContain(liked.status);

        const afterLike = await api.get(recipePath(id), token);
        const likeData = (afterLike.decrypted as {
          data?: { likeCount?: number; isLikedByMe?: boolean };
        })?.data;
        // likeCount is optional in the payload; when present it must have grown.
        if (typeof likeData?.likeCount === 'number') {
          expect(likeData.likeCount).toBe(baseCount + 1);
        }
        if (typeof likeData?.isLikedByMe === 'boolean') {
          expect(likeData.isLikedByMe).toBe(true);
        }

        // UNLIKE
        const unliked = await api.del(recipeLikePath(id), token);
        expect([200, 204]).toContain(unliked.status);

        const afterUnlike = await api.get(recipePath(id), token);
        const unlikeData = (afterUnlike.decrypted as { data?: { likeCount?: number } })?.data;
        if (typeof unlikeData?.likeCount === 'number') {
          expect(unlikeData.likeCount).toBe(baseCount);
        }
      } finally {
        await deleteRecipe(api, token, id);
      }
    });
  });
});
