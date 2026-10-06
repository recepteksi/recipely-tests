import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { MATRIX_DEVICES, MATRIX_ROUTES, type MatrixDevice } from '../../helpers/device-matrix';

/**
 * Responsive / visual matrix: every guest screen on every device shape.
 *
 * For each (device, route) it asserts the layout invariants that a broken
 * responsive rule produces — page-level horizontal overflow, visible content
 * pushed past the viewport edge, touch targets under 24×24 CSS px (WCAG 2.2
 * AA 2.5.8), the error boundary — and saves a full-page screenshot to
 * test-results/matrix/<browser>/<device>/<route>.png for visual review.
 * Point it at a build with RECIPELY_WEB_URL (e.g. a local `dist` server).
 */

const MIN_TARGET = 24;
const TOLERANCE = 1;

interface LayoutReport {
  overflow: number;
  offscreen: string[];
  smallTargets: string[];
  errorBoundary: boolean;
}

async function inspect(page: Page, touch: boolean): Promise<LayoutReport> {
  return page.evaluate(
    ({ minTarget, tolerance, touchDevice }) => {
      const vw = document.documentElement.clientWidth;
      const scrollsX = (el: Element | null): boolean => {
        for (let n = el; n !== null && n !== document.body; n = n.parentElement) {
          const ox = getComputedStyle(n).overflowX;
          if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        }
        return false;
      };
      const label = (el: Element): string => {
        const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
        return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''} "${text}"`;
      };
      const visible = (el: Element): boolean => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
      };
      const offscreen: string[] = [];
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        if (!visible(el) || el.children.length > 0) continue;
        const r = el.getBoundingClientRect();
        if ((r.right > vw + tolerance || r.left < -tolerance) && !scrollsX(el.parentElement)) offscreen.push(label(el));
      }
      const smallTargets: string[] = [];
      if (touchDevice) {
        // WCAG 2.5.8 exempts a link inside a sentence: its size is set by the line of text.
        const inlineInText = (el: Element): boolean => {
          const parent = el.parentElement;
          return parent !== null && getComputedStyle(el).display === 'inline' && (parent.textContent ?? '').trim().length > (el.textContent ?? '').trim().length;
        };
        for (const el of Array.from(document.querySelectorAll('[role="button"],[role="link"],a,button,[role="checkbox"],[role="radio"]'))) {
          if (!visible(el) || inlineInText(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < minTarget || r.height < minTarget) smallTargets.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
        }
      }
      const doc = document.documentElement;
      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        offscreen: Array.from(new Set(offscreen)).slice(0, 10),
        smallTargets: Array.from(new Set(smallTargets)).slice(0, 10),
        errorBoundary: /something went wrong|bir şeyler ters gitti/i.test(document.body.innerText),
      };
    },
    { minTarget: MIN_TARGET, tolerance: TOLERANCE, touchDevice: touch },
  );
}

/** Splash fade plus first data paint. */
const SETTLE_MS = 2_500;

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * A local build (http://127.0.0.1) is not an origin the API's CORS allows, so
 * with RECIPELY_PROXY_API=1 the API calls are made from Node (route.fetch) and
 * answered with the page's origin allowed. Off for the deployed site.
 */
async function proxyApi(page: Page): Promise<void> {
  if (process.env.RECIPELY_PROXY_API !== '1') return;
  await page.route(/https:\/\/(dev-)?api\.recipely\.net\/.*/, async (route) => {
    const origin = route.request().headers()['origin'] ?? '*';
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': route.request().headers()['access-control-request-headers'] ?? '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  });
}

/** Opens the first card of a list (cards are pressables, not links) and returns the route it lands on. */
async function firstDetailRoute(page: Page, list: string, pattern: RegExp): Promise<string | null> {
  await page.goto(list);
  await settle(page);
  const cards = page.locator('img').locator('xpath=ancestor::*[@tabindex="0"][1]');
  const count = await cards.count();
  for (let i = 0; i < Math.min(count, 6); i += 1) {
    await cards.nth(i).click({ timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(500);
    const path = new URL(page.url()).pathname;
    if (pattern.test(path)) return path;
    if (new URL(page.url()).pathname !== list) await page.goto(list).then(() => settle(page));
  }
  return null;
}

for (const device of MATRIX_DEVICES) {
  test.describe(`matrix · ${device.name}`, () => {
    test.use({
      viewport: device.viewport,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
      ...(device.userAgent !== undefined ? { userAgent: device.userAgent } : {}),
    });

    test('every guest screen holds its layout', async ({ page, browserName }, testInfo) => {
      test.skip(browserName === 'firefox' && device.isMobile, 'Firefox has no mobile emulation');
      test.setTimeout(240_000);
      await proxyApi(page);
      const detail = await firstDetailRoute(page, '/recipes', /^\/recipes\/[^/?#]+$/);
      const creator = await firstDetailRoute(page, '/creators', /^\/creators\/[^/?#]+$/);
      const routes = [...MATRIX_ROUTES, ...(detail ? [detail] : []), ...(creator ? [creator] : [])];
      const problems: string[] = [];
      for (const route of routes) {
        await page.goto(route);
        await settle(page);
        const report = await inspect(page, device.hasTouch);
        const shot = path.join('test-results', 'matrix', browserName, device.name, `${route.replace(/\//g, '_') || '_root'}.png`);
        await page.screenshot({ path: shot, fullPage: true });
        if (report.overflow > TOLERANCE) problems.push(`${route}: page overflows horizontally by ${report.overflow}px`);
        if (report.offscreen.length > 0) problems.push(`${route}: off-screen content → ${report.offscreen.join(' | ')}`);
        if (report.smallTargets.length > 0) problems.push(`${route}: touch targets under ${MIN_TARGET}px → ${report.smallTargets.join(' | ')}`);
        if (report.errorBoundary) problems.push(`${route}: error screen shown`);
      }
      await testInfo.attach('problems', { body: problems.join('\n') || 'none', contentType: 'text/plain' });
      expect(problems, problems.join('\n')).toEqual([]);
    });
  });
}
