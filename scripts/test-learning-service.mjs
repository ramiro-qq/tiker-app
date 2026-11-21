import test from 'node:test';
import assert from 'node:assert/strict';
import { learning } from '../src/services/learning.ts';

test('request channels deliver live events and stop delivering after cancellation', async () => {
  globalThis.window = globalThis;
  globalThis.isTauri = true;
  const calls = [];
  let resolveTask;
  globalThis.__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    unregisterCallback: () => {},
    invoke: (command, args) => {
      calls.push({command,args});
      if (command === 'learning_cancel') return Promise.resolve();
      return new Promise(resolve => {resolveTask = resolve;});
    },
  };
  const controller = new AbortController();
  const events = [];
  const pending = learning.intent('学习主题','',[],controller.signal,{modelId:'custom'},event=>events.push(event));
  const request = calls[0];
  const event = {id:'model',label:'分析主题',detail:'开始',state:'running'};
  request.args.onProgress.onmessage(event);
  assert.deepEqual(events,[event]);
  const rejected = assert.rejects(pending,{name:'AbortError'});
  controller.abort();
  await rejected;
  assert.equal(calls[1].command,'learning_cancel');
  assert.equal(calls[1].args.requestId,request.args.requestId);
  request.args.onProgress.onmessage({...event,state:'done'});
  assert.equal(events.length,1);
  resolveTask({kind:'learning'});
});
test('archive does not allocate a progress channel and aborted calls do not start', async () => {
  let allocated=0,invoked=0;
  globalThis.__TAURI_INTERNALS__ = {transformCallback:()=>{allocated++;return 1;},invoke:async()=>{invoked++;return 'saved';}};
  assert.equal(await learning.archive('id','title',[],'# note'),'saved');
  assert.equal(allocated,0);
  const controller=new AbortController();controller.abort();
  await assert.rejects(async()=>learning.intent('topic','',[],controller.signal),{name:'AbortError'});
  assert.equal(invoked,1);
  assert.equal(allocated,0);
});
