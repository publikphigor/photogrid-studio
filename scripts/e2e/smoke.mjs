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

  await step('drag se handle expands cell colSpan/rowSpan', async () => {
    const before = await page.locator('.pane.left .layer').first().locator('.meta').textContent();
    const seHandle = page.locator('[data-handle-dir="se"]');
    const box = await seHandle.boundingBox();
    if (!box) throw new Error('se handle has no bounding box');
    // Drag ~150px diagonally — at zoom ~78% with 4-col grid, that's > 1 track in each axis.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    const after = await page.locator('.pane.left .layer').first().locator('.meta').textContent();
    if (before === after) throw new Error(`span did not change: before=${before} after=${after}`);
    log(`  span: ${before} → ${after}`);
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
