import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationTrace, tracePhase } from '../src/features/learning/conversation.ts';
const messages = [{id:'q',role:'user',text:'问题'},{id:'plan',role:'assistant',text:'处理摘要'},{id:'answer',role:'assistant',text:'正式答复'},{id:'q2',role:'user',text:'追问'}];
const run = {id:'r',anchorId:'plan',state:'running',startedAt:0,steps:[]};
test('a plan belongs inside the process, and a response closes it even before work ends', () => {
  assert.deepEqual(conversationTrace(messages, [run], 'plan'), {run, summary:'处理摘要',hasResponse:true});
  assert.equal(tracePhase(run,true),'responded');
  assert.equal(tracePhase(run,false),'working');
});
test('a later turn cannot be mistaken for this run’s response', () => {
  assert.equal(conversationTrace([messages[0],messages[1],messages[3],{id:'a2',role:'assistant',text:'下一轮'}],[run],'plan').hasResponse,false);
  assert.equal(conversationTrace(messages,[{...run,anchorId:'q'}],'q').summary,'');
});
test('finished runs mount collapsed while errors and stopped work remain inspectable', () => {
  assert.equal(tracePhase({...run,state:'done'},false),'responded');
  assert.equal(tracePhase({...run,state:'error'},false),'interrupted');
  assert.equal(tracePhase({...run,state:'stopped'},false),'interrupted');
});

test('the initial plan is a process summary, never a formal response', () => {
  const stableRun = {...run, anchorId:'q', summaryMessageId:'plan'};
  const working = conversationTrace(messages.slice(0,2),[stableRun],'q');
  assert.equal(working.summary,'处理摘要');
  assert.equal(working.hasResponse,false);
  assert.equal(conversationTrace(messages,[stableRun],'q').hasResponse,true);
});

test('real generation events append files and one live reply without duplicates', async () => {
  const {applyGenerationEvent,settleDrafts} = await import('../src/features/learning/generation.ts');
  let session = {files:[],messages:[]};
  const file = {name:'01-指南.md',title:'指南',markdown:'# 指南\n部分内容'};
  session = applyGenerationEvent(session,{kind:'material',state:'running',material:file},'reply');
  assert.equal(session.files[0].status,'generating');
  session = applyGenerationEvent(session,{kind:'material',state:'done',material:{...file,markdown:'# 指南\n完整内容'}},'reply');
  assert.equal(session.files.length,1);
  assert.equal(session.files[0].status,'ready');
  session = applyGenerationEvent(session,{kind:'response',response:'正文'},'reply');
  session = applyGenerationEvent(session,{kind:'response',response:'正文继续'},'reply');
  assert.equal(session.messages.length,1);
  assert.equal(session.messages[0].text,'正文继续');
  assert.equal(settleDrafts({...session,files:[{...file,status:'generating'}]},'stopped').files[0].status,'stopped');
});
