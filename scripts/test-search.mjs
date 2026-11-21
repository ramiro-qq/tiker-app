import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchKnowledge } from '../src/features/search/model.ts';
const doc = (id,title,body) => ({id,title,content:body,kind:'doc',parentId:null,tags:[],favorite:false,updatedAt:0,visitedAt:0});
const clip = (id,title,body) => ({id,title,content:'',summary:body,state:'已归档',url:'https://example.com',tags:[],category:'阅读'});
test('searches visible title/body, ranks titles first and ignores markup',()=>{
 const found=searchKnowledge([doc('body','笔记','<p>设计实践</p>'),doc('title','设计','正文'),doc('attr','别的','<p title="设计">内容</p>')],[], '设计');
 assert.deepEqual(found.map(x=>x.id),['title','body']);
});
test('deduplicates independent content and includes only archived clips',()=>{
 const found=searchKnowledge([doc('doc','设计','<p>正文设计</p>')],[clip('copy','设计','正文设计'),clip('other','设计工具','别的'),{...clip('pending','设计草稿','草稿'),state:'待确认'}],'设计');
 assert.equal(found.length,2); assert.equal(found.filter(x=>x.source==='clips').length,1);
 assert.deepEqual(searchKnowledge([],[],'  '),[]);
});
test('keeps separate files with equal titles when searchable body is unavailable',()=>{
 assert.equal(searchKnowledge([doc('a','设计.pdf',''),doc('b','设计.pdf','')],[],'设计').length,2);
});

test('bookmark search uses description and ignores legacy article content and notes',()=>{
 const task={...clip('legacy','工具导航','简明设计工具介绍'),content:'LEGACY_BODY',notes:'PRIVATE_NOTES'};
 assert.equal(searchKnowledge([], [task], 'LEGACY_BODY').length,0);
 assert.equal(searchKnowledge([], [task], 'PRIVATE_NOTES').length,0);
 assert.equal(searchKnowledge([], [task], '设计')[0].body,'简明设计工具介绍');
});
