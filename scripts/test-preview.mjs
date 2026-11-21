import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDelimited } from '../src/features/preview/csv.ts';
import { imageDimensions } from '../src/features/preview/imageDimensions.ts';
import { detectFormat, validateSize } from '../src/features/preview/format.ts';
test('CSV preserves quoted separators, escaped quotes and embedded newlines', () => {
  assert.deepEqual(parseDelimited('\uFEFF名称,说明\r\n"a,b","first\r\nsecond"\r\n"quote""value",=1+1\r\n'.replace(/^\uFEFF/, ''), ','), [['名称','说明'],['a,b','first\r\nsecond'],['quote"value','=1+1']]);
  assert.deepEqual(parseDelimited('a\tb\n1\t"two\tthree"\n', '\t'), [['a','b'],['1','two\tthree']]);
  assert.deepEqual(parseDelimited('a,b,', ','), [['a','b','']]);
});
test('invalid CSV cannot silently drop quoted content or exceed cell limits', () => {
  for (const input of ['"unclosed', '"closed"tail', 'bad"quote']) assert.throws(() => parseDelimited(input, ','));
  assert.throws(() => parseDelimited('1,2\n3,4', ',', 3), /100 万/);
});
test('image dimensions are read from headers before decoding large images', () => {
  const png = new Uint8Array(24); const view = new DataView(png.buffer); view.setUint32(0,0x89504e47); png.set(new TextEncoder().encode('IHDR'),12); view.setUint32(16,100000); view.setUint32(20,100000);
  assert.deepEqual(imageDimensions(png), {width:100000,height:100000}); assert.equal(imageDimensions(new Uint8Array([0,1])),null);
});
test('format boundaries keep SVG, Office and binary formats out of the initial scope', () => {
  assert.equal(detectFormat('notes.md'),'markdown'); assert.equal(detectFormat('data.tsv'),'csv');
  for (const name of ['drawing.svg','book.xlsx','document.docx','movie.mp4']) assert.equal(detectFormat(name),'unsupported');
  assert.throws(()=>validateSize('pdf',201*1024*1024)); assert.throws(()=>validateSize('text',11*1024*1024));
});

const { EngineSession } = await import('../src/features/preview/session.ts');
const file = { sessionId:'session',fileId:'file',name:'test.txt',size:3,mime:'text/plain',format:'text',revision:'1',url:'blob:test' };
const deferred = () => { let resolve; const promise=new Promise(r=>{resolve=r;});return {promise,resolve}; };
const host = { element:{},theme:'light',emit(){} };
test('closing while file authorization is pending revokes the late session without mounting', async () => {
  const open = deferred(); let closed=0;let mounted=0;
  const session = new EngineSession({ openFile:()=>open.promise,closeFile:async()=>{closed++;},createEngine:async()=>{mounted++;},validateSize(){} });
  const pending=session.start('file',host,()=>{}); const rejected=assert.rejects(pending,/已取消/); const disposing=session.dispose();open.resolve(file);await rejected;await disposing;
  assert.equal(closed,1);assert.equal(mounted,0);await session.dispose();assert.equal(closed,1);
});
test('cancellation interrupts a partially mounted engine and suppresses late events', async () => {
  let released=0;let events=0;const ready=deferred();let adapterHost;
  const engine={mount:ctx=>{adapterHost=ctx;ready.resolve();return new Promise((_,reject)=>ctx.signal.addEventListener('abort',()=>reject(new DOMException('已取消','AbortError')),{once:true}));},dispose:async()=>{released++;},execute:async()=>{},restore:async()=>{},resize(){},setTheme(){}};
  const session=new EngineSession({openFile:async()=>file,closeFile:async()=>{},createEngine:async()=>engine,validateSize(){}});
  const pending=session.start('file',{...host,emit(){events++;}},()=>{});const rejected=assert.rejects(pending,/已取消/);await ready.promise;await session.dispose();await rejected;adapterHost.emit({type:'warning',message:'late'});
  assert.equal(events,0);assert(released>=1);
});
