import { test as base, expect } from '@playwright/test';
import { test, CAN_RUN_AUTHED, AUTH_SKIP_REASON } from '../../helpers/auth';
import { RecipelyApi } from '../../helpers/api';

/**
 * The voice assistant's HTTP surface — `/assistant/session`, `/heartbeat`,
 * `/message`.
 *
 * @remarks
 * - **The contract half is free.** Auth and validation both short-circuit
 *   before any model is called, so everything outside `live decisions` costs
 *   nothing and runs on every pass.
 * - **The live half is gated**, the same way the AI-creation coverage is: it
 *   asks a real model real sentences and costs money and seconds. Run it with
 *   `RECIPELY_ASSISTANT_E2E=1` when the prompt or the action list changes,
 *   which is the only time its answer can move.
 * - **What the live half actually checks is the DECISION.** The app can only
 *   perform what the model asks it for, so "which action does it pick for this
 *   sentence" is the one thing no unit test on either side can answer. Every
 *   case below is a sentence a user really said.
 */

const ASSISTANT_SESSION_PATH = '/assistant/session';
const ASSISTANT_HEARTBEAT_PATH = '/assistant/heartbeat';
const ASSISTANT_MESSAGE_PATH = '/assistant/message';

/** Set to run the section that spends model time. */
const LIVE = process.env.RECIPELY_ASSISTANT_E2E === '1';
const LIVE_SKIP_REASON = 'set RECIPELY_ASSISTANT_E2E=1 to ask a real model';

/**
 * A typed turn is a model call, not a lookup.
 *
 * The default fifteen seconds cut these off mid-thought and reported it as a
 * request failure — the same mistake the app itself made before it gave the
 * assistant its own timeout.
 */
const MODEL_TIMEOUT_MS = 90_000;

/** What the backend answers a typed turn with. */
interface AssistantReply {
  reply?: string;
  action?: { name?: string; arg?: string };
}

const errorCode = (result: { decrypted?: unknown }): string | undefined =>
  (result.decrypted as { error?: { code?: string } })?.error?.code;

/**
 * The plaintext body is `{ data }` or `{ error }`, like every other endpoint
 * here — reading `decrypted` straight through made every action `undefined`,
 * so the only case that passed was the one asserting `undefined`. A suite that
 * can only report the answer it already assumed is measuring nothing.
 */
const answer = (result: { decrypted?: unknown }): AssistantReply =>
  ((result.decrypted as { data?: AssistantReply })?.data ?? {}) as AssistantReply;

/**
 * A feed line of the shape the app really sends: the rows the user can see,
 * numbered so "the second one" has a referent.
 *
 * Deliberately built from names of an ordinary length rather than short ones —
 * at 200 characters the validator refused every real feed, and nothing said so:
 * the request died before the model saw it and the app reported that it had not
 * arrived.
 */
const feedLine = (): string => {
  const names = [
    'Spaghetti Aglio e Olio',
    'Quick Chicken and Vegetable Stir-Fry with Rice',
    'Mercimek Çorbası',
    'Fırında Sebzeli Tavuk',
    'Creamy Mushroom Risotto',
    'Zeytinyağlı Enginar',
    'One-Pan Lemon Garlic Salmon',
    'Karnıyarık',
  ];
  return `screen=/recipes; recipes=${names.map((n, i) => `${i + 1}) ${n}`).join(' ')}`;
};

/** The line the create screen sends while a generated draft is open. */
const draftLine = (): string =>
  'screen=/create-recipe; draft=Fırında Sebzeli Tavuk; ' +
  'ingredients=1) 1 kg tavuk but 2) 2 adet patates 3) 1 adet kabak 4) 2 diş sarımsak; steps=6';

test.describe('Backend · voice assistant', () => {
  base.describe('auth enforcement', () => {
    for (const [name, path] of [
      ['session', ASSISTANT_SESSION_PATH],
      ['heartbeat', ASSISTANT_HEARTBEAT_PATH],
      ['message', ASSISTANT_MESSAGE_PATH],
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

    test('a typed turn needs something to say', async ({ api, session }) => {
      const result = await api.post(
        ASSISTANT_MESSAGE_PATH,
        { message: '   ', languageCode: 'tr' },
        session.token,
      );

      expect(result.status).toBe(400);
      expect(errorCode(result)).toBe('validation');
    });

    // The code reaches Google's speech config, so it is constrained rather than
    // passed through — it is user-adjacent text going into a request we sign.
    test('the language code has to be a language code', async ({ api, session }) => {
      const result = await api.post(
        ASSISTANT_MESSAGE_PATH,
        { message: 'merhaba', languageCode: 'turkish please' },
        session.token,
      );

      expect(result.status).toBe(400);
      expect(errorCode(result)).toBe('validation');
    });

    test('minting a session needs one too', async ({ api, session }) => {
      const result = await api.post(
        ASSISTANT_SESSION_PATH,
        { languageCode: 'not-a-code' },
        session.token,
      );

      expect(result.status).toBe(400);
      expect(errorCode(result)).toBe('validation');
    });

    // Bounded is still the point: the line names recipes, and recipe names are
    // written by users.
    test('a line no screen could produce is still refused', async ({ api, session }) => {
      const result = await api.post(
        ASSISTANT_MESSAGE_PATH,
        { message: 'merhaba', languageCode: 'tr', screenContext: 'x'.repeat(5_000) },
        session.token,
      );

      expect(result.status).toBe(400);
      expect(errorCode(result)).toBe('validation');
    });
  });

  /**
   * What the model decides, given what the user said and what is on screen.
   *
   * Each case is a sentence that produced the WRONG action in production. The
   * assertions are on the action name only: the spoken half is the model's to
   * word, and pinning it would fail on every harmless rephrasing.
   */
  test.describe('live decisions', () => {
    test.skip(!CAN_RUN_AUTHED, AUTH_SKIP_REASON);
    test.skip(!LIVE, LIVE_SKIP_REASON);
    test.describe.configure({ timeout: 120_000 });

    const ask = async (
      api: RecipelyApi,
      token: string,
      message: string,
      screenContext: string,
    ): Promise<AssistantReply> => {
      const result = await api.post(
        ASSISTANT_MESSAGE_PATH,
        { message, languageCode: 'tr', screenContext },
        token,
        MODEL_TIMEOUT_MS,
      );
      expect(result.status).toBe(200);
      return answer(result);
    };

    /**
     * The regression this suite was written for, and it costs a model call:
     * the point is that the request now REACHES the model. A line the
     * validator refuses never gets that far, which is exactly how this shipped
     * unnoticed — rejected before the model, nothing logged, and the app
     * telling the user the request had not arrived.
     *
     * The schema itself is pinned for free by a unit test in the backend; what
     * this adds is the deployed contract, end to end.
     */
    test('a real feed line reaches the model rather than the validator', async ({ api, session }) => {
      const line = feedLine();
      expect(line.length).toBeGreaterThan(200);

      const reply = await ask(api, session.token, 'bu sayfada ne var', line);

      expect(reply.action ?? reply.reply).toBeDefined();
    });

    test('a real draft line reaches it too', async ({ api, session }) => {
      const reply = await ask(api, session.token, 'bunu oku', draftLine());

      expect(reply.action ?? reply.reply).toBeDefined();
    });

    // "Taslağı oku" was answered "you are on the list screen, open the draft" —
    // with the draft open in front of the user — because nothing in the
    // vocabulary asked the app what was on the screen.
    test('reading the screen is readScreen', async ({ api, session }) => {
      const reply = await ask(api, session.token, 'bu sayfada ne var, oku', draftLine());

      expect(reply.action?.name).toBe('readScreen');
    });

    // "Kaydet" on the draft editor fell through to a favourites handler that is
    // not mounted there, and the model started guessing where the button was.
    test('saving an open draft is publishDraft', async ({ api, session }) => {
      const reply = await ask(api, session.token, 'tarifi kaydet', draftLine());

      expect(reply.action?.name).toBe('publishDraft');
    });

    // Setting the number alone left the ingredient quantities where they were:
    // a recipe that says one thing and lists another, reported as success.
    test('re-scaling a draft goes to the refine, not the field', async ({ api, session }) => {
      const reply = await ask(api, session.token, 'bunu 8 kişilik yap', draftLine());

      expect(reply.action?.name).toBe('refineDraft');
    });

    // It used to push a second create screen and leave the draft behind.
    test('a change to an open draft never starts a new recipe', async ({ api, session }) => {
      const reply = await ask(api, session.token, 'biraz daha baharatlı olsun', draftLine());

      expect(reply.action?.name).toBe('refineDraft');
    });

    // Asked to pass a failure on, it described where the feedback form was.
    test('reporting a problem is reportProblem', async ({ api, session }) => {
      const reply = await ask(
        api,
        session.token,
        'tarifi kaydedemedim, bunu geliştiriciye bildir',
        draftLine(),
      );

      expect(reply.action?.name).toBe('reportProblem');
    });

    /**
     * The assistant was built out of rules that each named an action, so every
     * sentence got mapped onto one. Asked whether a waffle would work in a
     * frying pan, it went and generated a waffle recipe — the user was thinking
     * out loud and was answered by having a recipe made for them.
     */
    test('a question about cooking is answered, not performed', async ({ api, session }) => {
      const reply = await ask(api, session.token, 'sence tavada waffle olur mu', feedLine());

      expect(reply.action?.name).toBeUndefined();
      expect(reply.reply ?? '').not.toHaveLength(0);
    });

    // The same trap one screen further in: with a draft open, every sentence
    // looked like an edit, so a question about the draft rewrote it.
    test('a question about an open draft leaves the draft alone', async ({ api, session }) => {
      const reply = await ask(api, session.token, "sence bunu air fryer'da yapsam olur mu", draftLine());

      expect(reply.action?.name).toBeUndefined();
      expect(reply.reply ?? '').not.toHaveLength(0);
    });

    // The other side of the same rule: an explicit instruction still acts.
    // A model taught to answer questions must not stop doing what it is told.
    test('an instruction still acts', async ({ api, session }) => {
      const reply = await ask(api, session.token, 'tavuklu bir tarif oluşturalım', feedLine());

      expect(reply.action?.name).toBeDefined();
    });

    // "Bana baklava tarifi lazım" was answered by INVENTING one, over a library
    // that already had several.
    test('asking for a recipe searches before it invents one', async ({ api, session }) => {
      const reply = await ask(api, session.token, 'bana baklava tarifi lazım', feedLine());

      expect(reply.action?.name).not.toBe('generateRecipe');
    });

    // "Take me to my recipes" was answered by SEARCHING for "my recipes".
    test('going to a screen is navigate, not search', async ({ api, session }) => {
      const reply = await ask(api, session.token, 'tariflerime git', feedLine());

      expect(reply.action?.name).toBe('navigate');
    });
  });
});
