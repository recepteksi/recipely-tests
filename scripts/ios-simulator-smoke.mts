#!/usr/bin/env node
/**
 * Visual smoke test on a REAL iOS Simulator (Xcode).
 *
 * Boots an iOS Simulator, opens the hosted Recipely web build in Safari, waits
 * for it to load, and saves a screenshot under artifacts/. This confirms the
 * deployed bundle renders on a genuine iOS WebKit runtime — complementary to
 * the Maestro native flows (which drive the installed native app) and the
 * Playwright device-emulation projects.
 *
 * Requirements: macOS + Xcode + iOS Simulator (xcrun simctl).
 * Run:  npm run ios:sim          (override device: SIM_DEVICE="iPhone 15" npm run ios:sim)
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const URL = (process.env.RECIPELY_WEB_URL ?? 'https://recipely.net').replace(/\/+$/, '');
const OUT_DIR = 'artifacts';
const DEVICE = process.env.SIM_DEVICE || 'iPhone 15';

const sh = (cmd: string): string => execSync(cmd, { encoding: 'utf8' }).trim();

interface SimDevice {
  name: string;
  udid: string;
  state: string;
}

function ensureBooted(): string {
  const json = JSON.parse(sh('xcrun simctl list devices available --json')) as {
    devices: Record<string, SimDevice[]>;
  };
  let target: string | null = null;
  let booted: SimDevice | null = null;
  for (const runtime of Object.values(json.devices)) {
    for (const dev of runtime) {
      if (dev.state === 'Booted') booted = dev;
      if (dev.name === DEVICE) target = dev.udid;
    }
  }
  if (booted) {
    console.log(`✓ Using already-booted simulator: ${booted.name} (${booted.udid})`);
    return booted.udid;
  }
  if (!target) {
    throw new Error(`Simulator "${DEVICE}" not found. List: xcrun simctl list devices`);
  }
  console.log(`→ Booting simulator: ${DEVICE}`);
  try {
    sh('open -a Simulator');
  } catch {
    /* Simulator.app may already be open */
  }
  sh(`xcrun simctl boot ${target}`);
  sh(`xcrun simctl bootstatus ${target} -b`);
  return target;
}

function run(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const udid = ensureBooted();

  console.log(`→ Opening in Safari: ${URL}`);
  sh(`xcrun simctl openurl ${udid} "${URL}"`);

  console.log('→ Waiting for the page to load (8s)...');
  execSync('sleep 8');

  const shot = `${OUT_DIR}/ios-simulator-${Date.now()}.png`;
  sh(`xcrun simctl io ${udid} screenshot "${shot}"`);
  console.log(`✓ Screenshot saved: ${shot}`);
}

try {
  run();
} catch (err) {
  console.error('✗ iOS Simulator smoke failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
