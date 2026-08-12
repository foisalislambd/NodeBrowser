/**
 * Playwright bake-off: NodeBrowser in a real browser (WASM).
 * WebContainers is proprietary — CI does not run @webcontainer/api.
 * Compare numbers locally with e2e/wc-placeholder.json if you have a WC token.
 */
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

test.describe('NodeBrowser bake-off', () => {
  test('WASM boot + echo in terminal', async ({ page }) => {
    const t0 = Date.now();
    await page.goto('/');
    await expect(page.locator('#status')).toContainText(/wasm/i, { timeout: 90_000 });
    const bootMs = Date.now() - t0;

    const isolated = await page.evaluate(() => !!globalThis.crossOriginIsolated);
    const status = await page.locator('#status').textContent();

    await page.locator('#term-input').fill('echo bakeoff-ok');
    await page.locator('#term-input').press('Enter');

    const t1 = Date.now();
    await expect(page.locator('#term')).toContainText('bakeoff-ok', { timeout: 30_000 });
    const echoMs = Date.now() - t1;

    const row = {
      product: 'nodebrowser',
      bootMs,
      echoMs,
      status: status?.trim() || '',
      crossOriginIsolated: isolated,
      sabHint: /worker/i.test(status || ''),
      at: new Date().toISOString(),
    };
    writeFileSync(join(here, 'last-run.json'), JSON.stringify(row, null, 2));
    console.log('bakeoff', JSON.stringify(row));
  });
});
