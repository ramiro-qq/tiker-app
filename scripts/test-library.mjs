import test from 'node:test';
import { seedLibrary } from './fixtures/library.ts';
import assert from 'node:assert/strict';
import { descendants, folderAncestors, moveNode, removeNode, uniqueTitle, duplicateNode } from '../src/features/library/model.ts';
test('document breadcrumbs include every ancestor and follow folder moves',()=>{
 const nodes=seedLibrary();
 const nested=moveNode(nodes,'notes','tech');
 assert.deepEqual(folderAncestors(nested,'design').map(n=>n.id),['tech','notes']);
 assert.deepEqual(folderAncestors(nodes,'design').map(n=>n.id),['notes']);
 assert.deepEqual(folderAncestors(nodes,'missing'),[]);
 const broken=nodes.map(n=>n.id==='notes'?{...n,parentId:'missing'}:n);
 assert.deepEqual(folderAncestors(broken,'design').map(n=>n.id),['notes']);
 const cycle=nodes.map(n=>n.id==='notes'?{...n,parentId:'notes'}:n);
 assert.deepEqual(folderAncestors(cycle,'design').map(n=>n.id),['notes']);
});
test('duplicated archived documents never share the managed source file',()=>{
 const original={...seedLibrary()[1],sourcePath:'/library/archive.md',sourceFingerprint:'original-hash',markdown:'old',sourceGrant:'attachment-grant'};
 const copy=duplicateNode([original],original.id);
 assert.notEqual(copy.id,original.id);
 assert.equal(copy.content,original.content);
 assert.equal(copy.sourcePath,undefined);
 assert.equal(copy.sourceFingerprint,undefined);
 assert.equal(copy.sourceGrant,'attachment-grant');
 assert.equal(original.sourcePath,'/library/archive.md');
});
test('moving a folder cannot create a cycle or target a file',()=>{const nodes=seedLibrary();assert.throws(()=>moveNode(nodes,'notes','notes'));assert.throws(()=>moveNode(nodes,'notes','design'));const nested=[...nodes,{...nodes[0],id:'nested',parentId:'notes'}];assert.throws(()=>moveNode(nested,'notes','nested'));});
test('moving preserves descendants and unrelated nodes',()=>{const nodes=seedLibrary();const moved=moveNode(nodes,'notes','tech');assert.equal(moved.find(n=>n.id==='design').parentId,'notes');assert.equal(moved.find(n=>n.id==='notes').parentId,'tech');assert.equal(moved.find(n=>n.id==='attachments').parentId,null);assert.equal(nodes.find(n=>n.id==='notes').parentId,null);});
test('deleting cascades only through the chosen subtree',()=>{const nodes=seedLibrary();const remaining=removeNode(nodes,'notes');assert(!remaining.some(n=>['notes','design','knowledge'].includes(n.id)));assert(remaining.some(n=>n.id==='attachments'));assert.equal(descendants(nodes,'notes').size,3);});
test('names are unique within a parent and allow same name elsewhere',()=>{const nodes=seedLibrary();assert.equal(uniqueTitle(nodes,'notes','知识管理'),'知识管理（2）');assert.equal(uniqueTitle(nodes,'tech','知识管理'),'知识管理');assert.equal(uniqueTitle(nodes,'notes','知识管理','knowledge'),'知识管理');});

test('folder names reject empty, invalid paths and same-level duplicates', async()=>{
 const { folderNameError }=await import('../src/features/library/model.ts');const nodes=seedLibrary();
 assert.match(folderNameError(nodes,null,'  '),/名称/);
 assert.match(folderNameError(nodes,null,'10-笔记'),/已存在/);
 assert.match(folderNameError(nodes,null,'a/b'),/字符/);
 assert.equal(folderNameError(nodes,'tech',' 10-笔记 '),'');
});
test('an edited spreadsheet copy cannot overwrite its original attachment',()=>{
 const original={...seedLibrary()[1],kind:'table',content:'xlsx:workbook',sourceGrant:'source-sheet'};
 const copy=duplicateNode([original],original.id);
 assert.equal(copy.content,original.content);
 assert.equal(copy.sourceGrant,undefined);
 assert.equal(original.sourceGrant,'source-sheet');
});
