# Recipely — End-to-End Automation Tests

Full-stack automation for **Recipely**, covering every surface:

- **Backend** — `api.recipely.net`: **every service** exercised over the
  AES-256-GCM `/api/v1` encrypted envelope (auth, recipes, taxonomy, me,
  favorites, likes, comments, drafts, users, notifications, AI, plus the
  cross-cutting security contract), and the plain health + static legal pages.
  Each backend spec runs **twice**:
  - **`backend-direct`** — a server-to-server caller (like curl/Node). Proves
    each service works for any authorized client.
  - **`backend-mobile`** — the **same** requests carrying the React Native
    app's headers (mobile User-Agent + client marker). Proves each service
    works exactly as the installed app calls it.
- **Frontend (web)** — the Firebase-hosted React Native Web build
  (`recipely.net`), driven in real desktop browsers.
- **Mobile** — two layers:
  - **Device emulation** of the web build (iPhone / Pixel / iPad) via Playwright.
  - **Native E2E** of the installed app via **Maestro** (real Simulator/Emulator).

So every service is verified **both from the mobile app's perspective and as a
direct backend call** — the two axes the report groups results by.

Written with **Playwright** (+ a tiny Node AES helper) and **Maestro**.

## Reports

Two reports are produced on every run, both in English:

- **`playwright-report/recipely-report.html`** — a custom, self-contained
  dashboard grouped by **surface** (Direct / Mobile / Web) and then by
  **service**, with a pass-rate donut, summary cards, per-test rows, inline
  error details, and quick All/Failed/Passed/Skipped filters. Open it directly
  in any browser.
- **`playwright-report/index.html`** — the stock Playwright report (traces,
  screenshots, videos for failures).

## App flow under test

```
(unauthenticated) ──► /login ──► Sign in ─┬─ invalid ─► inline error
                          │               └─ valid ───► /recipes feed
                          ├─► Create account ─► /register
                          └─► Forgot password ─► reset request

Backend:  /health (plain)  ·  /privacy /terms (HTML)  ·  /api/v1/** (AES-GCM envelope)
```

## Install

```bash
cd recipely-tests
npm install
npx playwright install        # chromium, firefox, webkit
```

Optional config — everything defaults to **production**; copy `.env.example` to
`.env` only to override targets or to enable deeper tests:

```bash
cp .env.example .env
# RECIPELY_API_AES_KEY  → set the real backend key to decrypt /api/v1 responses
# RECIPELY_TEST_EMAIL / RECIPELY_TEST_PASSWORD → enable the authed happy paths
```

## Run

```bash
npm test                  # everything (backend + web + mobile emulation)
npm run test:backend      # API — every service, both Direct + Mobile axes
npm run test:backend:direct   # API — server-to-server axis only
npm run test:backend:mobile   # API — mobile-app-headers axis only
npm run test:web          # desktop chromium + firefox + webkit
npm run test:mobile       # iPhone (WebKit) + Pixel (Chromium) + iPad
npm run test:iphone       # iPhone emulation only
npm run test:android      # Pixel/Chromium emulation only
npm run test:headed       # visible browser
npm run test:ui           # Playwright UI mode
npm run report            # last HTML report

# Real native mobile (Maestro — see maestro/README.md)
npm run maestro           # all native flows on the connected device
npm run maestro:ios
npm run maestro:android

# Real iOS Simulator visual smoke of the web build (Safari + screenshot)
npm run ios:sim
```

## Projects (Playwright)

| Project            | Engine    | Surface                  | Stands in for            |
|--------------------|-----------|--------------------------|--------------------------|
| `backend-direct`   | none      | API (HTTP + envelope)    | server-to-server caller  |
| `backend-mobile`   | none      | API (HTTP + envelope)    | the React Native app     |
| `desktop-chromium` | Chromium  | Web / desktop            | Chrome / Edge            |
| `desktop-firefox`  | Firefox   | Web / desktop            | Firefox                  |
| `desktop-webkit`   | WebKit    | Web / desktop            | Safari (macOS)           |
| `mobile-iphone`    | WebKit    | Mobile emulation         | iPhone 13 / iOS Safari   |
| `mobile-pixel`     | Chromium  | Mobile emulation         | Pixel 7 / Android Chrome |
| `tablet-ipad`      | WebKit    | Tablet emulation         | iPad                     |

> Every file under `tests/backend/` runs under **both** `backend-direct` and
> `backend-mobile`, so the same assertions cover the direct-call and the
> mobile-app axes.

## Test files

| File | Surface | Covers |
|------|---------|--------|
| `tests/backend/health.spec.ts`        | backend | `/health` + `/health/ready`, plain-JSON (no envelope), HEAD, latency. |
| `tests/backend/static-pages.spec.ts`  | backend | `/privacy`, `/terms` HTML + content, Helmet security headers, root 404. |
| `tests/backend/envelope.spec.ts`      | backend | AES-GCM round-trip, fresh IV, tamper + wrong-key rejection, non-envelope body rejected. |
| `tests/backend/auth.spec.ts`          | backend | Login, register (+ conflict), verify, resend, forgot/reset password, social — happy + error paths. |
| `tests/backend/taxonomy.spec.ts`      | backend | Cuisines/categories shape, localization, auth enforcement. |
| `tests/backend/recipes.spec.ts`       | backend | List/pagination, validation, **create→read→view→update→delete** lifecycle. |
| `tests/backend/me.spec.ts`            | backend | `/me` profile, `/me/recipes`, idempotent profile PATCH, bio validation. |
| `tests/backend/favorites.spec.ts`     | backend | Favorite → appears in `/me/favorites` → unfavorite round-trip. |
| `tests/backend/likes.spec.ts`         | backend | Like → `likeCount` reflects it → unlike restores it. |
| `tests/backend/comments.spec.ts`      | backend | Add → list → like → unlike → delete a comment; empty-body validation. |
| `tests/backend/drafts.spec.ts`        | backend | Upsert → get by id → list → latest → delete; UUID validation. |
| `tests/backend/users.spec.ts`         | backend | Public profile, user recipes, self-follow rule, auth enforcement. |
| `tests/backend/notifications.spec.ts` | backend | Inbox list, read-all, device-token register, platform validation. |
| `tests/backend/ai.spec.ts`            | backend | generate/import/refine **contract only** (auth + validation, no model invoked). |
| `tests/backend/security.spec.ts`      | backend | Every protected route → encrypted 401; bogus JWT; encrypted 404; CORS/Helmet. |
| `tests/web/landing.spec.ts`           | web     | Login surface renders (brand, fields, CTA, social, sign-up). |
| `tests/web/auth.spec.ts`              | web     | Empty-field gate, invalid-credentials error, valid login (gated). |
| `tests/web/navigation.spec.ts`        | web     | login ↔ register ↔ forgot-password, deep links. |
| `tests/web/responsive.spec.ts`        | web     | No horizontal overflow, form usable, CTA in-viewport on every device. |
| `maestro/flows/*.yaml`                | native  | Login smoke, auth navigation, invalid login, authed browse. |

**Non-destructive by design.** Authenticated mutation tests create their own
disposable resource (a throwaway recipe or a random-UUID draft) and delete it in
a `finally` block, so the production database is left exactly as found. The
expensive AI endpoints are contract-tested only and never actually invoke a
model. Authenticated specs **skip with a clear reason** unless the real AES key
+ test account are configured.

`helpers/recipely.ts` is the web/mobile **Page Object**. `helpers/envelope.ts`
re-implements the app's AES-256-GCM wire format with Node `crypto`;
`helpers/api.ts` wraps a Playwright `APIRequestContext` to encrypt requests and
decrypt response envelopes. `helpers/config.ts` centralises targets + `.env`.

## The encrypted backend (`/api/v1`)

Every `/api/v1` request body and **every** response — including errors — is an
AES-256-GCM envelope (`{ payload, iv }`) keyed by a secret shared with the
backend. The suite always verifies the **wire format** and the server-side
**handshake**. To decrypt real data responses (e.g. assert the catalog array, or
the full login error body), set `RECIPELY_API_AES_KEY` to the real backend key;
otherwise those assertions fall back to verifying the envelope/error contract
and are clearly annotated.

## Reporters

`reporters/html-reporter.ts` writes the English dashboard described above
(`playwright-report/recipely-report.html`), grouped by surface → service.

`reporters/claude-reporter.ts` prints, at the end of every run, a list of failed
tests — each with a copy-paste `claude "…"` command that starts Claude fixing
that test/selector, plus one **bulk** command for all failures. Also written to
`test-results/failures.md` (Markdown table) and `test-results/failures.json`.

## Notes

- **No `testID`s** in the app: selectors use accessibility roles, visible i18n
  text, and input placeholders. Locale is pinned to **en-US**.
- **Real backend**: web/native invalid-login tests perform genuine (failing)
  auth round-trips. They're harmless but can trip rate limiting if hammered —
  lower `WORKERS` if you see 429s.
- **Mobile vs. emulation**: Playwright mobile projects run the *web* build under
  a device profile. True native coverage lives in `maestro/`.
