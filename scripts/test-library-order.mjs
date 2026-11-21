import test from 'node:test';
import { seedLibrary } from './fixtures/library.ts';
import assert from 'node:assert/strict';
import { reorderNode, orderedChildren } from '../src/features/library/model.ts';

test('reorder documents and folders, retaining order after serialization', () => {
 const nodes=seedLibrary();
 const next=reorderNode(nodes,'attachments','notes','before');
 assert.deepEqual(orderedChildren(JSON.parse(JSON.stringify(next)),null).map(n=>n.id),['attachments','notes','tech']);
 assert.deepEqual(orderedChildren(nodes,null).map(n=>n.id),['notes','tech','attachments']);
 const docs=reorderNode(next,'knowledge','design','before');
 assert.deepEqual(orderedChildren(docs,'notes').map(n=>n.id),['knowledge','design']);
});
test('move across folders, into folders and back to root without losing descendants', () => {
 let nodes=reorderNode(seedLibrary(),'design','tech','inside');
 assert.equal(nodes.find(n=>n.id==='design').parentId,'tech');
 nodes=reorderNode(nodes,'notes','tech','inside');
 assert.equal(nodes.find(n=>n.id==='knowledge').parentId,'notes');
 nodes=reorderNode(nodes,'knowledge',null,'inside');
 assert.equal(nodes.find(n=>n.id==='knowledge').parentId,null);
 nodes=reorderNode(nodes,'design','attachments','after');
 assert.deepEqual(orderedChildren(nodes,null).map(n=>n.id),['tech','attachments','design','knowledge']);
});
test('reject cycles, self drops and invalid destinations without changing data', () => {
 const nodes=seedLibrary();
 for(const args of [['notes','knowledge','before'],['notes','notes','inside'],['notes','design','inside'],['design','missing','after']]) assert.throws(()=>reorderNode(nodes,...args));
 assert.equal(nodes.find(n=>n.id==='notes').parentId,null);
});
