import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentQueue } from '../src/services/contentQueue.ts';
const initial = () => ({ libraryId:'lib', revision:0, library:[{id:'a',title:'A'}], learning:{sessions:[],activeId:null} });
test('serializes patches using each caller baseline and preserves pending newer edits', async () => {
  const calls=[]; const releases=[];
  const queue=new ContentQueue(initial(), {save:(...args)=>new Promise(resolve=>{calls.push(args);releases.push(resolve);}), journal:()=>{}});
  queue.write('library',[{id:'a',title:'B'}]);
  queue.write('library',[{id:'a',title:'C'}]);
  assert.equal(queue.getSnapshot().pending,2);
  assert.equal(calls.length,1);
  releases.shift()({...initial(),revision:1,library:[{id:'a',title:'B'}]});
  await new Promise(setImmediate);
  assert.equal(queue.getSnapshot().data.library[0].title,'C');
  assert.equal(calls.length,2);
  assert.equal(calls[1][1][0].title,'B');
  releases.shift()({...initial(),revision:2,library:[{id:'a',title:'C'}]});
  await queue.flush();
  assert.equal(queue.getSnapshot().pending,0);
  assert.equal(queue.getSnapshot().data.revision,2);
});
test('failed persistence preserves the draft and journal and retry acknowledges it', async () => {
  let fail=true; let journal=[];
  const queue=new ContentQueue(initial(),{save:async()=>{if(fail)throw new Error('disk full');return {...initial(),revision:1,library:[{id:'a',title:'draft'}]};},journal:ops=>{journal=structuredClone(ops);}});
  queue.write('library',[{id:'a',title:'draft'}]);
  await assert.rejects(queue.flush(),/disk full/);
  assert.equal(queue.getSnapshot().pending,1);
  assert.equal(queue.getSnapshot().data.library[0].title,'draft');
  assert.equal(journal.length,1);
  fail=false; await queue.retry();
  assert.equal(queue.getSnapshot().pending,0);
  assert.deepEqual(journal,[]);
});
test('journal failure refuses an optimistic edit and never sends it', () => {
  let called=false;
  const queue=new ContentQueue(initial(),{save:async()=>{called=true;return initial();},journal:()=>{throw new Error('quota');}});
  assert.throws(()=>queue.write('library',[]),/quota/);
  assert.equal(queue.getSnapshot().data.library.length,1);
  assert.equal(called,false);
});
test('remote refresh cannot replace in-flight drafts', async () => {
  let release;
  const queue=new ContentQueue(initial(),{save:()=>new Promise(r=>{release=r;}),journal:()=>{}});
  queue.write('library',[{id:'a',title:'draft'}]);
  assert.equal(queue.acceptRemote({...initial(),library:[]}),false);
  release({...initial(),revision:1,library:[{id:'a',title:'draft'}]});
  await queue.flush();
  assert.equal(queue.acceptRemote({...initial(),revision:2,library:[{id:'remote',title:'R'}]}),true);
  assert.equal(queue.getSnapshot().remoteGeneration,1);
});
test('recovery replays original baselines without assuming empty means deletion',async()=>{
 const op={collection:'library',base:initial().library,next:[{id:'a',title:'recovered'}]};
 let baseline;
 const queue=new ContentQueue(initial(),{save:async(_,base,next)=>{baseline=base;return {...initial(),library:next};},journal:()=>{}},[op]);
 await queue.retry();
 assert.deepEqual(baseline,initial().library);
 assert.equal(queue.getSnapshot().data.library[0].title,'recovered');
});
test('older remote responses cannot roll back the acknowledged revision',()=>{
 const queue=new ContentQueue({...initial(),revision:5},{save:async()=>initial(),journal:()=>{}});
 assert.equal(queue.acceptRemote({...initial(),revision:3,library:[]}),false);
 assert.equal(queue.getSnapshot().data.revision,5);
});
