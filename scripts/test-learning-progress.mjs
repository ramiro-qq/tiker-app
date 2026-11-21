import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrace, updateTrace, finishTrace } from '../src/shared/agent/progress.ts';

test('step updates replace the same row and keep its start time', () => {
  let run = createTrace('run-a', 'question', 100);
  run = updateTrace(run, {id:'read-a',label:'读取文档',state:'running',detail:'https://example.com'}, 200);
  run = updateTrace(run, {id:'read-a',label:'读取文档',state:'done',detail:'已读取 1200 字'}, 800);
  assert.equal(run.steps.length, 1);
  assert.equal(run.steps[0].startedAt, 200);
  assert.equal(run.steps[0].updatedAt, 800);
  assert.equal(run.steps[0].state, 'done');
});
test('finishing or stopping seals the trace and settles pending work', () => {
  const run = updateTrace(createTrace('a','q',100), {id:'model',label:'整理',state:'running',detail:''},200);
  const stopped = finishTrace(run, 'stopped', 900);
  assert.equal(stopped.steps[0].state,'stopped');
  assert.equal(stopped.endedAt,900);
  assert.deepEqual(updateTrace(stopped,{id:'late',label:'迟到事件',state:'done',detail:''},1000),stopped);
  assert.equal(finishTrace(run,'error',900).steps[0].state,'error');
});
test('terminal step does not regress when a late running update arrives', () => {
  let run = updateTrace(createTrace('a','q',0), {id:'s',label:'读取',state:'done',detail:'完成'},20);
  run = updateTrace(run,{id:'s',label:'读取',state:'running',detail:'旧事件'},10);
  assert.equal(run.steps[0].state,'done');
});

test('material snapshots update the trace summary without retaining full document bodies', () => {
  const run = updateTrace(createTrace('a','q',0), {id:'file:a.md',label:'file-write a.md',detail:'已写入',state:'running',kind:'material',material:{name:'a.md',title:'A',markdown:'private draft body'}},20);
  assert.equal(run.steps[0].material,undefined);
  assert.equal(run.steps[0].detail,'已写入');
  assert.deepEqual(updateTrace(run,{id:'reply',label:'正式响应',detail:'',state:'running',kind:'response',response:'正式答复'},30),run);
});
