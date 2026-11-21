import { openTestLibrary } from './fixtures/browser.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const session = `library-search-${process.pid}`;
function browser(...args) {
 const result = spawnSync('agent-browser', ['--session', session, ...args], {encoding:'utf8',timeout:30000});
 assert.equal(result.status,0,result.error?.message || result.stderr || result.stdout);
 return result.stdout;
}
test('search opens a document in an already mounted library',()=>{
 try {
  const url=new URL(process.env.READER_TEST_URL || 'http://127.0.0.1:1420/');
  openTestLibrary(browser,url.href);browser('click','.library-shortcuts button:nth-child(2)');browser('wait','.lb-tags-page');
  browser('press','Meta+k');browser('wait','.global-search[open]');
  browser('fill','.global-search input','组件');browser('wait','.knowledge-result');
  const expected=JSON.parse(browser('eval',"document.querySelector('.knowledge-result h2').textContent"));
  browser('click','.knowledge-result');
  browser('wait','.rd-document-title');
  assert.equal(JSON.parse(browser('eval',"document.querySelector('.rd-document-title').value")),expected);
  assert.equal(JSON.parse(browser('eval',"!!document.querySelector('.global-search[open]')")),false);
  // A local tree selection must remain possible after consuming the request.
  browser('click','[data-node-id="notes"] .lb-node');browser('click','[data-node-id="knowledge"] .lb-node');
  assert.equal(JSON.parse(browser('eval',"document.querySelector('.rd-document-title').value")),'知识管理');
  // Opening the same result again is a new request even though its id is unchanged.
  browser('press','Meta+k');browser('wait','.global-search[open]');
  browser('fill','.global-search input','组件');browser('wait','.knowledge-result');
  browser('click','.knowledge-result');
  browser('wait','--fn',`document.querySelector('.rd-document-title')?.value === ${JSON.stringify(expected)}`);
  assert.equal(JSON.parse(browser('eval',"document.querySelector('.rd-document-title').value")),expected);
  assert.equal(browser('errors').trim(),'');
 } finally {browser('close');}
});
