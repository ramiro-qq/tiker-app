// Requires agent-browser and the dev server at SETTINGS_TEST_URL (npm run dev).
// Check rendered edges, including future parent constraints or CSS overrides.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const session = `settings-layout-${process.pid}`;
function browser(...args) {
  const result = spawnSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return result.stdout;
}

test('settings panels fill the content area with the fixed collapsed menu as the window resizes', () => {
  try {
    const url = new URL(process.env.SETTINGS_TEST_URL || process.env.READER_TEST_URL || 'http://127.0.0.1:1420/');
    browser('open', url.href); browser('wait','.app-navigation'); browser('click','.app-navigation [aria-label="设置"]');
    browser('wait', '.st-overview-content');
    // Tauri declares a minimum window width of 980px.
    for (const width of [2554, 1920, 1440, 1180, 980]) {
      browser('set', 'viewport', String(width), '1000');
      {
        assert.equal(JSON.parse(browser('eval', `(() => {
          const nav = document.querySelector('.app-navigation');
          return nav.classList.contains('is-collapsed') && nav.offsetWidth === 72
            && !nav.querySelector('[aria-expanded]');
        })()`)), true, 'main menu stays collapsed without a toggle');
        const measurements = JSON.parse(browser('eval', `(() => {
          const scroll = document.querySelector('.st-scroll');
          const style = getComputedStyle(scroll);
          const available = scroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          return {
            available,
            content: document.querySelector('.st-overview-content').getBoundingClientRect().width,
            panels: Array.from(document.querySelectorAll('.st-panel'), panel => panel.getBoundingClientRect().width),
            overflow: scroll.scrollWidth - scroll.clientWidth
          };
        })()`));
        const context = `${width}px, fixed collapsed menu: ${JSON.stringify(measurements)}`;
        assert.ok(Math.abs(measurements.content - measurements.available) < 2, context);
        assert.ok(measurements.panels.every(panel => Math.abs(panel - measurements.available) < 2), context);
        assert.ok(measurements.overflow < 2, context);
      }
    }
  } finally {
    browser('close');
  }
});
