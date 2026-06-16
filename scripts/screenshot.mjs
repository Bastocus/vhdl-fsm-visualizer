/**
 * Screenshot generator for VHDL FSM Diagram README.
 *
 * Reads the panel HTML template from src/panel.ts, stubs the VS Code API,
 * injects parsed FSM data, and uses Puppeteer to produce PNG screenshots.
 */

import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from '/home/user/vhdl-fsm-diagram/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Parse a VHDL fixture file using the TypeScript parser ───────────────────
function parseFsms(fixtureName) {
  const fixturePath = resolve(ROOT, 'test/fixtures', fixtureName);
  const out = execFileSync(
    resolve(ROOT, 'node_modules/.bin/tsx'),
    [resolve(ROOT, 'scripts/run_parser.ts'), fixturePath],
    { encoding: 'utf-8' }
  );
  return JSON.parse(out.trim());
}

// ── Build standalone HTML from the panel template ──────────────────────────
function buildHtml(fsms, title, theme = 'dark') {
  const raw = readFileSync(resolve(ROOT, 'src/panel.ts'), 'utf-8');

  // Extract the template literal between `return \`` and the closing `\`;`
  // The _getHtml method has exactly one template literal (the big HTML block).
  const start = raw.indexOf('    return `<!DOCTYPE html>');
  if (start === -1) throw new Error('Could not find template start in panel.ts');
  const templateStart = start + '    return `'.length;
  const templateEnd = raw.lastIndexOf('`;\n  }');
  if (templateEnd === -1) throw new Error('Could not find template end in panel.ts');
  let html = raw.slice(templateStart, templateEnd);

  // Replace the three TypeScript template expressions
  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  html = html.replace('${esc(title)}', escHtml(title));
  html = html.replace('${fsmData}', JSON.stringify(fsms));
  html = html.replace('"${themeSetting}"', `"${theme}"`);

  // Stub acquireVsCodeApi() so the page JS doesn't throw
  html = html.replace(
    'const vscodeApi = acquireVsCodeApi();',
    'function acquireVsCodeApi(){ return { postMessage: () => {} }; }\nconst vscodeApi = acquireVsCodeApi();'
  );

  return html;
}

// ── Take screenshots ─────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function screenshot(page, outPath, action) {
  if (action) await action(page);
  // Let the diagram render and fit
  await sleep(600);
  await page.screenshot({ path: outPath, fullPage: false });
  console.log('saved', outPath);
}

async function main() {
  const mediaDir = resolve(ROOT, 'media');
  mkdirSync(mediaDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {

    // ── Screenshot 1: Overview — simple 3-state FSM, dark theme ─────────────
    {
      const { fsms, title } = parseFsms('two_process.vhd');
      const html = buildHtml(fsms, title, 'dark');
      const tmpPath = '/tmp/fsm_s1.html';
      writeFileSync(tmpPath, html);

      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 700 });
      await page.goto(`file://${tmpPath}`, { waitUntil: 'networkidle0' });
      await screenshot(page, resolve(mediaDir, 'screenshot_overview.png'));
      await page.close();
    }

    // ── Screenshot 2: Overview — light theme ────────────────────────────────
    {
      const { fsms, title } = parseFsms('two_process.vhd');
      const html = buildHtml(fsms, title, 'light');
      const tmpPath = '/tmp/fsm_s2.html';
      writeFileSync(tmpPath, html);

      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 700 });
      await page.goto(`file://${tmpPath}`, { waitUntil: 'networkidle0' });
      await screenshot(page, resolve(mediaDir, 'screenshot_light_theme.png'));
      await page.close();
    }

    // ── Screenshot 3: State selected (glow + dim) ────────────────────────────
    {
      const { fsms, title } = parseFsms('if_elsif_else.vhd');
      const html = buildHtml(fsms, title, 'dark');
      const tmpPath = '/tmp/fsm_s3.html';
      writeFileSync(tmpPath, html);

      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 700 });
      await page.goto(`file://${tmpPath}`, { waitUntil: 'networkidle0' });
      await sleep(800);

      // Click the first state circle
      await page.evaluate(() => {
        const stateNode = document.querySelector('[data-state]');
        if (stateNode) stateNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      await screenshot(page, resolve(mediaDir, 'screenshot_state_selected.png'));
      await page.close();
    }

    // ── Screenshot 4: Transitions table expanded ─────────────────────────────
    {
      const { fsms, title } = parseFsms('two_process.vhd');
      const html = buildHtml(fsms, title, 'dark');
      const tmpPath = '/tmp/fsm_s4.html';
      writeFileSync(tmpPath, html);

      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 900 });
      await page.goto(`file://${tmpPath}`, { waitUntil: 'networkidle0' });
      await sleep(800);

      // Click the "Transitions" header to expand the table
      await page.evaluate(() => {
        const header = document.querySelector('.tp-header');
        if (header) header.click();
      });

      await screenshot(page, resolve(mediaDir, 'screenshot_transitions_table.png'));
      await page.close();
    }

    // ── Screenshot 5: Dense layout — 8 states ────────────────────────────────
    {
      const { fsms, title } = parseFsms('dense_layout.vhd');
      const html = buildHtml(fsms, title, 'dark');
      const tmpPath = '/tmp/fsm_s5.html';
      writeFileSync(tmpPath, html);

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      await page.goto(`file://${tmpPath}`, { waitUntil: 'networkidle0' });
      await screenshot(page, resolve(mediaDir, 'screenshot_dense_fsm.png'));
      await page.close();
    }

    // ── Screenshot 6: Two FSM tabs ────────────────────────────────────────────
    {
      const { fsms, title } = parseFsms('two_fsm_types.vhd');
      const html = buildHtml(fsms, title, 'dark');
      const tmpPath = '/tmp/fsm_s6.html';
      writeFileSync(tmpPath, html);

      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 700 });
      await page.goto(`file://${tmpPath}`, { waitUntil: 'networkidle0' });
      await screenshot(page, resolve(mediaDir, 'screenshot_multiple_fsms.png'));
      await page.close();
    }

    // ── Screenshot 7: Tooltip on "..." pill ──────────────────────────────────
    {
      const { fsms, title } = parseFsms('nested_if.vhd');
      const html = buildHtml(fsms, title, 'dark');
      const tmpPath = '/tmp/fsm_s7.html';
      writeFileSync(tmpPath, html);

      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 700 });
      await page.goto(`file://${tmpPath}`, { waitUntil: 'networkidle0' });
      await sleep(800);

      // Click the first "..." pill to show the tooltip
      await page.evaluate(() => {
        const pills = Array.from(document.querySelectorAll('text'));
        const pill = pills.find(el => el.textContent === '...');
        if (pill) pill.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 400, clientY: 300 }));
      });

      await screenshot(page, resolve(mediaDir, 'screenshot_condition_tooltip.png'));
      await page.close();
    }

  } finally {
    await browser.close();
  }
  console.log('\nAll screenshots saved to media/');
}

main().catch(err => { console.error(err); process.exit(1); });
