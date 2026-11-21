import { openTestLibrary } from './fixtures/browser.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const session=`search-dialog-${process.pid}`;
function browser(...args){const result=spawnSync('agent-browser',['--session',session,...args],{encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.error?.message||result.stderr||result.stdout);return result.stdout;}
const evaluate=expression=>JSON.parse(browser('eval',expression));
const base=process.env.READER_TEST_URL||'http://127.0.0.1:1420/';
test('global search preserves the current task, modal draft and trigger focus',()=>{
 try{
  const url=new URL(base);openTestLibrary(browser,url.href);browser('click','.app-navigation [aria-label="收藏"]');browser('find','role','button','click','--name','新建','--exact');browser('wait','.clips-modal-create');
  browser('press','Meta+k');browser('wait','.global-search[open]');
  assert.equal(evaluate("document.activeElement.getAttribute('aria-label')"),'搜索知识库');
  assert.equal(evaluate("document.querySelector('[aria-current=page]').getAttribute('aria-label')"),'收藏');
  browser('fill','.global-search input','非空搜索');browser('press','Escape');
  assert.equal(evaluate("!!document.querySelector('.global-search[open]')"),false);
  assert.equal(evaluate("!!document.querySelector('.clips-modal-create')"),true);
  assert.equal(evaluate('document.activeElement.tagName'),'INPUT');
  assert.equal(evaluate('getComputedStyle(document.activeElement).outlineStyle'),'none');
  assert.equal(evaluate('getComputedStyle(document.activeElement).boxShadow'),'none');
 }finally{browser('close');}
});
test('arrow selection from a focused result opens the selected document',()=>{
 try{
  openTestLibrary(browser,base);browser('press','Meta+k');browser('wait','.global-search[open]');browser('fill','.global-search input','的');
  browser('wait','--fn',"document.querySelectorAll('.knowledge-result').length >= 2");
  browser('focus','.knowledge-result-action');browser('press','ArrowDown');
  const selected=evaluate("document.querySelector('.knowledge-result[data-selected=true] h2').textContent");
  assert.equal(evaluate("document.activeElement.querySelector('h2')?.textContent"),selected);
  browser('press','Enter');browser('wait','.rd-document-title');
  assert.equal(evaluate("document.querySelector('.rd-document-title').value"),selected);
  assert.equal(evaluate("!!document.querySelector('.global-search[open]')"),false);
  assert.equal(evaluate("!!document.querySelector('.search-return-bar')"),false);
  assert.equal(browser('errors').trim(),'');
 }finally{browser('close');}
});

function setupSearch(){
 openTestLibrary(browser,base);
 browser('eval', `(async()=>{const {clipTasks}=await import('/src/services/clipTasks.ts');clipTasks.list=async()=>[{id:'qa-clip',title:'测试收藏',summary:'测试简介',content:'LEGACY_BODY',tags:['测试标签'],category:'工具',state:'已归档',url:'https://example.com',requirements:'',createdAt:1,updatedAt:1,revision:0,error:null},{id:'qa-other',title:'其他收藏',summary:'其他简介',tags:['其他标签'],category:'工具',state:'已归档',url:'https://example.org',requirements:'',createdAt:1,updatedAt:1,revision:0,error:null}];const {content}=await import('/src/services/content.ts');content.saveLibrary([{id:'qa-doc',title:'测试文档',content:'<p>测试正文</p>',tags:['测试标签'],kind:'doc',parentId:null,favorite:false,visitedAt:0,updatedAt:1}]);await content.flush();})()`);
 browser('press','Meta+k');browser('wait','.global-search[open]');browser('fill','.global-search input','测试');browser('wait','.knowledge-result-action');
}
function assertFocus(){assert.deepEqual(evaluate(`(()=>{const s=getComputedStyle(document.activeElement);return [s.outlineStyle,s.boxShadow]})()`),['none','none']);}
test('search result presentation, document tags, clip details and clip tag filtering',()=>{
 try{
  setupSearch();
  assert.equal(evaluate("document.querySelectorAll('.knowledge-sources button').length"),2);
  assert.equal(evaluate("document.querySelector('.knowledge-result h2 svg')"),null);
  assert.equal(evaluate("getComputedStyle(document.querySelector('.knowledge-result')).borderRadius"),'0px');
  assertFocus();browser('press','Tab');assertFocus();
  browser('click','.knowledge-tag');browser('wait','.lb-tags-content');
  assert.equal(evaluate("!!document.querySelector('.global-search[open]')"),false);
  assert.match(evaluate("document.querySelector('.lb-tags-content').textContent"),/测试文档/);
  browser('press','Meta+k');browser('fill','.global-search input','测试');browser('wait','.knowledge-result-action');
  browser('click','.knowledge-sources button:last-child');browser('wait','.knowledge-result-action');
  assert.equal(evaluate("document.querySelector('.knowledge-result-action p').textContent"),'测试简介');
  browser('click','.knowledge-result-action');browser('wait','.clips-modal-view');assertFocus();
  assert.match(evaluate("document.querySelector('.clips-modal-view').textContent"),/测试简介/);
  assert.equal(evaluate("!!document.querySelector('.search-clip-preview')"),false);
  browser('press','Escape');browser('press','Meta+k');browser('fill','.global-search input','测试');browser('wait','.knowledge-result-action');browser('click','.knowledge-sources button:last-child');browser('click','.knowledge-tag');
  assert.equal(evaluate("document.querySelector('[aria-label=筛选收藏标签]').value"),'测试标签');
  assert.match(evaluate("document.querySelector('.clips-content').textContent"),/测试收藏/);
  assert.doesNotMatch(evaluate("document.querySelector('.clips-content').textContent"),/其他收藏/);
  browser('select','[aria-label=筛选收藏标签]','');
  assert.match(evaluate("document.querySelector('.clips-content').textContent"),/其他收藏/);
  assert.equal(browser('errors').trim(),'');
 }finally{browser('close');}
});
