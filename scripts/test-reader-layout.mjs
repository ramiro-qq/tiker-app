import { openTestDocument } from './fixtures/browser.mjs';
// Requires agent-browser and the dev server (npm run dev) at READER_TEST_URL.
// Measures rendered geometry so later CSS overrides cannot silently restore a width cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const session = `reader-layout-${process.pid}`;
function browser(...args) {
  const result = spawnSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return result.stdout;
}
const geometry = `(() => {
  const grid = document.querySelector('.rd-reading-grid');
  const article = document.querySelector('.rd-article');
  const toc = document.querySelector('.rd-toc');
  const style = getComputedStyle(grid);
  const bounds = grid.getBoundingClientRect();
  const text = article.getBoundingClientRect();
  const tocVisible = getComputedStyle(toc).display !== 'none';
  const end = tocVisible ? toc.getBoundingClientRect().right : text.right;
  return {
    unused: bounds.right - parseFloat(style.paddingRight) - end,
    overflow: grid.scrollWidth - grid.clientWidth,
    article: text.width,
    available: bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      - (tocVisible ? toc.getBoundingClientRect().width + parseFloat(style.columnGap) : 0)
  };
})()`;

test('reader fills available width with the fixed collapsed menu at desktop and mobile sizes', () => {
  try {
    const url = new URL(process.env.READER_TEST_URL || 'http://127.0.0.1:1420/');
    openTestDocument(browser, url.href);
    browser('wait', '.rd-reading-grid');
    for (const width of [2526, 1920, 1440, 1180, 760, 390]) {
      browser('set', 'viewport', String(width), '1000');
      {
        assert.equal(JSON.parse(browser('eval', `(() => {
          const nav = document.querySelector('.app-navigation');
          return nav.classList.contains('is-collapsed') && nav.offsetWidth === 72
            && !nav.querySelector('[aria-expanded]');
        })()`)), true, 'main menu stays collapsed without a toggle');
        const result = JSON.parse(browser('eval', geometry));
        const context = `${width}px, fixed collapsed menu: ${JSON.stringify(result)}`;
        assert.ok(Math.abs(result.unused) < 2, context);
        assert.ok(Math.abs(result.article - result.available) < 2, context);
        assert.ok(result.overflow < 2, context);

      }
    }
  } finally {
    browser('close');
  }
});
