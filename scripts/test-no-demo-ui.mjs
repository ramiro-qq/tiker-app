import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const session = `no-demo-${process.pid}`;
const base = process.env.READER_TEST_URL || 'http://127.0.0.1:1420/';
function browser(...args) {
 const r=spawnSync('agent-browser',['--session',session,...args],{encoding:'utf8',timeout:30000});
 assert.equal(r.status,0,r.error?.message||r.stderr||r.stdout);return r.stdout;
}
const evaluate=js=>JSON.parse(browser('eval',js));
test('fresh and repeated initialization remain empty; old demo links load no samples; real legacy data survives',()=>{
 try {
  browser('open',base+'?board=mqqIj');browser('wait','.app-navigation');
  browser('eval','localStorage.clear()');browser('reload');browser('wait','.app-navigation');
  assert.deepEqual(evaluate(`(async()=>{const {content,initializeContent}=await import('/src/services/content.ts');window.downloads=0;HTMLAnchorElement.prototype.click=function(){if(this.download)window.downloads++;};await initializeContent();await initializeContent();return {library:content.library(),learning:content.learning(),downloads:window.downloads};})()`),{library:[],learning:{sessions:[],activeId:null},downloads:0});
  browser('click','.app-navigation [aria-label="文档"]');browser('wait','.lb-workspace');
  assert.equal(evaluate("document.querySelectorAll('[data-node-id]').length"),0);
  browser('click','[aria-label="添加文件夹"]');browser('wait','dialog[open]');
  const focus=()=>evaluate("({outline:getComputedStyle(document.activeElement).outlineStyle,shadow:getComputedStyle(document.activeElement).boxShadow})");
  assert.deepEqual(focus(),{outline:'none',shadow:'none'});
  browser('press','Shift+Tab');assert.deepEqual(focus(),{outline:'none',shadow:'none'});
  browser('click','[aria-label="关闭新建文件夹"]');assert.deepEqual(focus(),{outline:'none',shadow:'none'});
  browser('press','Meta+k');browser('wait','.global-search[open]');assert.deepEqual(focus(),{outline:'none',shadow:'none'});browser('press','Escape');
  const real=[{id:'user-note',parentId:null,kind:'doc',title:'用户笔记',content:'<p>保留我的内容</p>',tags:[],favorite:false,updatedAt:1,visitedAt:0}];
  assert.deepEqual(evaluate(`(async()=>{localStorage.setItem('tiker.library.v1',JSON.stringify(${JSON.stringify(real)}));const {content,initializeContent}=await import('/src/services/content.ts');await initializeContent();return content.library();})()`),real);
  assert.equal(browser('errors').trim(),'');
 } finally {browser('close');}
});
