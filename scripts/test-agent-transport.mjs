import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTransport } from '../src/shared/agent/transport.ts';

function setup() {
  const calls = [];
  let receive;
  let settle;
  const transport = createAgentTransport({
    available: () => true,
    channel: handler => { receive = handler; return 'test-channel'; },
    invoke: (command, args) => {
      calls.push({command, args});
      if (command === 'learning_cancel') return Promise.resolve();
      return new Promise(resolve => { settle = resolve; });
    },
  });
  return { transport, calls, receive: event => receive(event), settle: value => settle(value) };
}
test('pre-cancelled calls do not dispatch work or create progress channels', async () => {
  const task = setup();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(task.transport('learning_intent', {}, {signal:controller.signal,cancelCommand:'learning_cancel',progress:()=>{}}), {name:'AbortError'});
  assert.equal(task.calls.length, 0);
});
test('cancellation uses the dispatched request ID and ignores late progress', async () => {
  const task = setup(); const controller = new AbortController(); const events = [];
  const result = task.transport('learning_research', {query:'RAG'}, {signal:controller.signal,cancelCommand:'learning_cancel',progress:e=>events.push(e)});
  task.receive({id:'read',state:'running'});
  controller.abort();
  await assert.rejects(result, {name:'AbortError'});
  assert.equal(task.calls[1].command,'learning_cancel');
  assert.equal(task.calls[1].args.requestId,task.calls[0].args.requestId);
  task.receive({id:'late',state:'done'}); task.settle({sources:[]});
  assert.equal(events.length,1);
});
test('successful calls settle once and detach cancellation and progress', async () => {
  const task = setup(); const controller = new AbortController(); const events=[];
  const result=task.transport('learning_generate', {}, {signal:controller.signal,cancelCommand:'learning_cancel',progress:e=>events.push(e)});
  task.settle({files:[]});
  assert.deepEqual(await result,{files:[]});
  controller.abort(); task.receive({id:'late',state:'done'});
  assert.equal(task.calls.length,1); assert.equal(events.length,0);
});
test('archive calls have no progress channel or cancellation request ID', async () => {
  const task=setup(); const result=task.transport('learning_archive',{id:'file'});
  assert.deepEqual(task.calls[0].args,{id:'file'});
  task.settle('/library/file.md'); assert.equal(await result,'/library/file.md');
});
