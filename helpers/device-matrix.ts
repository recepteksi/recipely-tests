import { devices } from '@playwright/test';

/**
 * Every screen shape Recipely must look right on. Playwright ships iPhone,
 * Pixel, iPad and Galaxy Tab profiles; the foldables are defined from their
 * published CSS viewports (cover / inner screen, single / spanned).
 */
export interface MatrixDevice {
  readonly name: string;
  readonly viewport: { width: number; height: number };
  readonly deviceScaleFactor: number;
  readonly isMobile: boolean;
  readonly hasTouch: boolean;
  readonly userAgent?: string;
}

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-F946B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const DUO_UA =
  'Mozilla/5.0 (Linux; Android 11; Surface Duo) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

const fromPlaywright = (name: string, key: keyof typeof devices): MatrixDevice => {
  const d = devices[key];
  return { name, viewport: d.viewport, deviceScaleFactor: d.deviceScaleFactor, isMobile: d.isMobile, hasTouch: d.hasTouch, userAgent: d.userAgent };
};

export const MATRIX_DEVICES: readonly MatrixDevice[] = [
  fromPlaywright('iphone-se', 'iPhone SE'),
  fromPlaywright('iphone-15-pro-max', 'iPhone 15 Pro Max'),
  fromPlaywright('pixel-7', 'Pixel 7'),
  { name: 'z-fold-5-folded', viewport: { width: 344, height: 882 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: ANDROID_UA },
  { name: 'z-fold-5-unfolded', viewport: { width: 690, height: 829 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: ANDROID_UA },
  { name: 'surface-duo-single', viewport: { width: 540, height: 720 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true, userAgent: DUO_UA },
  { name: 'surface-duo-spanned', viewport: { width: 1114, height: 720 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true, userAgent: DUO_UA },
  fromPlaywright('ipad-mini', 'iPad Mini'),
  fromPlaywright('ipad-pro-11-landscape', 'iPad Pro 11 landscape'),
  fromPlaywright('galaxy-tab-s4', 'Galaxy Tab S4'),
  { name: 'desktop-1280', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'desktop-1440', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'desktop-1920', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
];

/** Guest-reachable routes; `/recipes/:id` and `/creators/:id` are resolved from the live list at run time. */
export const MATRIX_ROUTES: readonly string[] = [
  '/onboarding',
  '/login',
  '/register',
  '/forgot-password',
  '/recipes',
  '/creators',
  '/about',
  '/privacy',
];
