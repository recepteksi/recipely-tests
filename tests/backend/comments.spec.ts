import { test as base, expect } from '@playwright/test';
import {
  test,
  CAN_RUN_AUTHED,
  AUTH_SKIP_REASON,
  createRecipe,
  deleteRecipe,
} from '../../helpers/auth';
import { RecipelyApi } from '../../helpers/api';
import {
  recipeCommentsPath,
  recipeCommentPath,
  recipeCommentLikePath,
} from '../../helpers/config';

/**
 * Comments service — listing, adding, liking, and deleting comments on a
 * recipe (`/recipes/:id/comments` and its `/like` sub-resource). Each test owns
 * a disposable recipe so comments never leak onto real content.
 */
test.describe('Backend · comments service', () => {
  base('listing comments without a token returns an encrypted 401', async ({ request }) => {
    const api = new RecipelyApi(request);
    const result = await api.get(recipeCommentsPath('00000000-0000-0000-0000-000000000000'));
    expect(result.status).toBe(401);
    expect(result.envelope).toBeDefined();
  });

  test.describe('authenticated', () => {
    test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);

    test('an empty comment body is rejected with 400 validation', async ({ api, session }) => {
      const token = session.token;
      const id = await createRecipe(api, token, 'comment-val');
      try {
        const result = await api.post(recipeCommentsPath(id), { body: '' }, token);
        expect(result.status).toBe(400);
        const code = (result.decrypted as { error?: { code?: string } })?.error?.code;
        expect(code).toBe('validation');
      } finally {
        await deleteRecipe(api, token, id);
      }
    });

    test('add → list → like → unlike → delete a comment', async ({ api, session }) => {
      const token = session.token;
      const id = await createRecipe(api, token, 'comment');
      try {
        // ADD
        const added = await api.post(
          recipeCommentsPath(id),
          { body: 'Great recipe — testing comments!', rating: 5 },
          token,
        );
        expect(added.status).toBe(201);
        const commentId = (added.decrypted as { data?: { id?: string } })?.data?.id;
        expect(commentId).toBeTruthy();

        // LIST should include it
        const listed = await api.get(recipeCommentsPath(id), token);
        expect(listed.status).toBe(200);
        const listData = listed.decrypted as {
          data?: { items?: Array<{ id?: string }> } | Array<{ id?: string }>;
        };
        const items = Array.isArray(listData?.data)
          ? listData!.data
          : (listData?.data as { items?: Array<{ id?: string }> })?.items ?? [];
        expect(items.some((c) => c.id === commentId)).toBe(true);

        // LIKE the comment
        const liked = await api.post(recipeCommentLikePath(id, commentId!), {}, token);
        expect([200, 201, 204]).toContain(liked.status);

        // UNLIKE
        const unliked = await api.del(recipeCommentLikePath(id, commentId!), token);
        expect([200, 204]).toContain(unliked.status);

        // DELETE the comment
        const removed = await api.del(recipeCommentPath(id, commentId!), token);
        expect([200, 204]).toContain(removed.status);
      } finally {
        await deleteRecipe(api, token, id);
      }
    });
  });
});
