/* Tiny end-to-end smoke for PhotoGrid Studio.
 *
 * Run via Docker:
 *   docker run --rm --network host -v $PWD:/work -w /work \
 *     mcr.microsoft.com/playwright:v1.48.0 \
 *     node scripts/e2e/smoke.mjs http://localhost:8090
 */
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8090';

function log(...args) {
  console.log('[smoke]', ...args);
}

async function step(name, fn) {
  process.stdout.write(`[smoke] ${name}… `);
  const t = Date.now();
  try {
    await fn();
    console.log(`ok (${Date.now() - t}ms)`);
  } catch (e) {
    console.log('FAIL');
    console.error(e);
    throw e;
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') log('console error:', msg.text());
});

let exitCode = 0;
try {
  await step('load', async () => {
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.preset', { timeout: 10000 });
  });

  await step('templates section is visible', async () => {
    const txt = await page.locator('.pane.left').textContent();
    if (!txt?.includes('My Templates')) throw new Error('My Templates header missing');
  });

  await step('output tab shows filename + folder', async () => {
    await page.locator('button.tab', { hasText: 'Output' }).click();
    const txt = await page.locator('.pane.right').textContent();
    if (!txt?.includes('Name')) throw new Error('Filename row missing');
    if (!txt?.includes('Folder') && !txt?.includes('Save dialog')) {
      throw new Error('Folder/save-dialog hint missing');
    }
  });

  await step('container tab shows background image picker (no fluid)', async () => {
    await page.locator('button.tab', { hasText: 'Container' }).click();
    const txt = await page.locator('.pane.right').textContent();
    if (txt?.includes('Fluid layout')) throw new Error('Fluid toggle still present');
    if (!txt?.includes('Image')) throw new Error('Background image row missing');
  });

  await step('select first cell shows resize overlay', async () => {
    const cells = page.locator('[data-cell-id]');
    const first = cells.first();
    await first.click();
    // Wait for the overlay handles (data-handle-dir attribute).
    const handles = page.locator('[data-handle-dir]');
    const count = await handles.count();
    if (count !== 8) throw new Error(`expected 8 resize handles, got ${count}`);
  });

  await step('drag se corner handle redistributes all cells', async () => {
    const snap = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-cell-id]')].map((c) => {
          const r = c.getBoundingClientRect();
          return { id: c.getAttribute('data-cell-id'), w: Math.round(r.width), h: Math.round(r.height) };
        }),
      );
    const board = await page.evaluate(() => ({
      w: document.querySelector('.board')?.style.width,
      h: document.querySelector('.board')?.style.height,
    }));
    const before = await snap();
    const se = page.locator('[data-handle-dir="se"]');
    const box = await se.boundingBox();
    if (!box) throw new Error('se handle has no bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    const after = await snap();
    const boardAfter = await page.evaluate(() => ({
      w: document.querySelector('.board')?.style.width,
      h: document.querySelector('.board')?.style.height,
    }));
    const changed = after.filter((a, i) => a.w !== before[i].w || a.h !== before[i].h).length;
    if (changed < before.length) {
      throw new Error(`corner drag should change all ${before.length} cells; only ${changed} changed`);
    }
    if (board.w !== boardAfter.w || board.h !== boardAfter.h) {
      throw new Error('container size changed during resize (should stay fixed)');
    }
    log(`  ${changed}/${before.length} cells redistributed`);
  });

  await step('drag e edge handle resizes only the row pair', async () => {
    const snap = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-cell-id]')].map((c) => {
          const r = c.getBoundingClientRect();
          return { id: c.getAttribute('data-cell-id'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
        }),
      );
    const before = await snap();
    // Re-select the first cell so its edge handles render at the (possibly updated) coords.
    await page.locator('[data-cell-id]').first().click();
    await page.waitForTimeout(120);
    const eh = page.locator('[data-handle-dir="e"]');
    const box = await eh.boundingBox();
    if (!box) throw new Error('e handle has no bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    const after = await snap();
    // Top row (cells 1, 2) should change. Bottom row (3, 4) should not.
    const topChanged = (after[0].w !== before[0].w) || (after[1].w !== before[1].w);
    const bottomUnchanged = after[2].w === before[2].w && after[3].w === before[3].w;
    if (!topChanged) throw new Error('top-row cells did not change');
    if (!bottomUnchanged) throw new Error('bottom-row cells changed (edge resize should be row-local)');
    log(`  top Δw=${after[0].w - before[0].w}/${after[1].w - before[1].w}, bottom unchanged`);
  });

  await step('save template, then load it', async () => {
    page.on('dialog', (d) => d.accept('e2e-tpl'));
    await page.locator('.pane.left .pane-header', { hasText: 'My Templates' }).locator('.icon-btn').click();
    await page.waitForTimeout(200);
    const tpl = page.locator('.pane.left .layer', { hasText: 'e2e-tpl' });
    if ((await tpl.count()) === 0) throw new Error('template not saved');
    // Load it: shouldn't crash, layout should still show the same number of cells.
    const cellsBefore = await page.locator('[data-cell-id]').count();
    await tpl.first().click();
    await page.waitForTimeout(300);
    const cellsAfter = await page.locator('[data-cell-id]').count();
    if (cellsAfter !== cellsBefore) {
      throw new Error(`cell count changed after load: ${cellsBefore} → ${cellsAfter}`);
    }
  });

  log('all checks passed');
} catch (e) {
  exitCode = 1;
  log('first-failure shot saved to /tmp/photogrid-smoke-fail.png');
  await page.screenshot({ path: '/tmp/photogrid-smoke-fail.png', fullPage: true });
} finally {
  await browser.close();
  process.exit(exitCode);
}
