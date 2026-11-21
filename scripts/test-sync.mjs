import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncClient } from '../src/services/syncClient.ts';
test('never starts a remote mutation before pending content has persisted',async()=>{
 const order=[];
 const sync=createSyncClient({flush:async()=>{order.push('flush');},command:async(name,args)=>{order.push(name);return args;}});
 await sync.now(); await sync.enable('preview','existing');
 assert.deepEqual(order,['flush','sync_now','flush','sync_enable']);
});
test('persistence failure blocks remote mutation',async()=>{
 let requests=0;
 const sync=createSyncClient({flush:async()=>{throw new Error('disk full');},command:async()=>{requests++;}});
 await assert.rejects(sync.now(),/disk full/);
 assert.equal(requests,0);
});
test('resolving conflicts preserves the exact selected version and conflict identity',async()=>{
 let request;
 const sync=createSyncClient({flush:async()=>{},command:async(name,args)=>{request={name,args};}});
 await sync.resolve('stale-safe-id','both');
 assert.deepEqual(request,{name:'sync_resolve',args:{conflictId:'stale-safe-id',choice:'both'}});
});
