// Renders the PNG app icons from apps/web/public/favicon.svg, so every icon is the same mark.
// Run after changing the SVG: `node scripts/icons.mjs`. Uses the repo's Playwright Chromium.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const dir = new URL('../apps/web/public/', import.meta.url);
const svg = readFileSync(new URL('favicon.svg', dir), 'utf8');
// Home-screen icons are masked to a circle or squircle by the OS, so they get a full-bleed square
// (no rounded corners of our own) with the mark inside the safe zone.
const square = svg.replace('rx="8"', 'rx="0"').replace('d="M4.5 16h5l3-7.5 5 15 3-7.5h7"', 'd="M7 16h4l2.5-6 4 12 2.5-6h5"');

const targets = [
  { file: 'favicon-32.png', size: 32, source: svg },
  { file: 'apple-touch-icon.png', size: 180, source: square },
  { file: 'icon-192.png', size: 192, source: square },
  { file: 'icon-512.png', size: 512, source: square },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${t.source.replace('<svg ', `<svg width="${t.size}" height="${t.size}" `)}</body></html>`);
  writeFileSync(new URL(t.file, dir), await page.screenshot({ omitBackground: true }));
  console.log(`wrote ${t.file}`);
}
await browser.close();
