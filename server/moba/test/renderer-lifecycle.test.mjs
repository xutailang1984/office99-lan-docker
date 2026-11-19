import test from 'node:test';
import assert from 'node:assert/strict';
import {guardRendererApi} from '../../../client/moba-web/input-router.mjs';

test('retired renderers receive valid blocked input JSON and cannot affect the next game',()=>{
 let current=true,writes=0;
 const api=guardRendererApi({ready:()=>true,poll:()=>JSON.stringify([{type:'state'}]),inputState:()=>JSON.stringify({blocked:false,keys:['Space']}),send:()=>writes++,loaded:()=>writes++,beforePointer:()=>writes++,diagnostic:()=>writes++},()=>current);
 assert.equal(api.ready(),true);assert.equal(JSON.parse(api.inputState()).blocked,false);api.send('move');assert.equal(writes,1);
 current=false;assert.equal(api.ready(),false);assert.deepEqual(JSON.parse(api.poll()),[]);
 const state=JSON.parse(api.inputState());assert.equal(state.blocked,true);assert.deepEqual(state.keys,[]);assert.equal(state.pointer.inside,false);assert.equal(state.pointer.buttons,0);
 for(const key of ['send','loaded','beforePointer','diagnostic'])api[key]('stale');assert.equal(writes,1);
});
