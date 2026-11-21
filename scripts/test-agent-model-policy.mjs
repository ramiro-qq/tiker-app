import test from 'node:test';
import assert from 'node:assert/strict';
import { availableAgentModels, selectAgentModel } from '../src/shared/agent/modelPolicy.ts';

test('learning uses only configured available custom models in settings order', () => {
  const list=[
    {id:'builtin',provider:'openai',configured:true},
    {id:'missing-key',provider:'custom',configured:false},
    {id:'offline',provider:'custom',configured:true,status:'unavailable'},
    {id:'first',provider:'custom',configured:true,status:'untested'},
    {id:'second',provider:'custom',configured:true,status:'verified'},
  ];
  const available=availableAgentModels(list);
  assert.deepEqual(available.map(m=>m.id),['first','second']);
  assert.equal(selectAgentModel(available,null),'first');
  assert.equal(selectAgentModel(available,'second'),'second');
  assert.equal(selectAgentModel(available,'deleted'),'first');
  assert.equal(selectAgentModel([],null),null);
  assert.equal(list.length,5);
});
