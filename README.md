# Recipely — End-to-End Automation Tests

Full-stack automation for **Recipely**, covering all three surfaces:

- **Backend** — `api.recipely.net`: health, static legal pages, and the
  AES-256-GCM `/api/v1` encrypted-envelope contract (login + taxonomy catalog).
- **Frontend (web)** — the Firebase-hosted React Native Web build
  (`recipely.net`), driven in real desktop browsers.
- **Mobile** — two layers:
  - **Device emulation** of the web build (iPhone / Pixel / iPad) via Playwright.
  - **Native E2E** of the installed app via **Maestro** (real Simulator/Emulator).

Written with **Playwright** (+ a tiny Node AES helper) and **Maestro**. Mirrors
the structure of the `wordpulse-tests` suite.

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
npm run test:backend      # API only — health, static pages, envelope, catalog
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
| `backend`          | none      | API (HTTP + envelope)    | api.recipely.net         |
| `desktop-chromium` | Chromium  | Web / desktop            | Chrome / Edge            |
| `desktop-firefox`  | Firefox   | Web / desktop            | Firefox                  |
| `desktop-webkit`   | WebKit    | Web / desktop            | Safari (macOS)           |
| `mobile-iphone`    | WebKit    | Mobile emulation         | iPhone 13 / iOS Safari   |
| `mobile-pixel`     | Chromium  | Mobile emulation         | Pixel 7 / Android Chrome |
| `tablet-ipad`      | WebKit    | Tablet emulation         | iPad                     |

## Test files

| File | Surface | Covers |
|------|---------|--------|
| `tests/backend/health.spec.ts`       | backend | `/health` 200 `{status:"ok"}`, latency. |
| `tests/backend/static-pages.spec.ts` | backend | `/privacy`, `/terms` reachable, served as HTML. |
| `tests/backend/envelope.spec.ts`     | backend | AES-GCM local round-trip, fresh IV per call, login speaks the envelope protocol. |
| `tests/backend/catalog.spec.ts`      | backend | Cuisines/categories return an encrypted envelope (auth-gated). |
| `tests/web/landing.spec.ts`          | web     | Login surface renders (brand, fields, CTA, social, sign-up). |
| `tests/web/auth.spec.ts`             | web     | Empty-field gate, invalid-credentials error, valid login (gated). |
| `tests/web/navigation.spec.ts`       | web     | login ↔ register ↔ forgot-password, deep links. |
| `tests/web/responsive.spec.ts`       | web     | No horizontal overflow, form usable, CTA in-viewport on every device. |
| `maestro/flows/*.yaml`               | native  | Login smoke, auth navigation, invalid login, authed browse. |

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

## Failure reporter → ready-to-paste `claude` commands

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
