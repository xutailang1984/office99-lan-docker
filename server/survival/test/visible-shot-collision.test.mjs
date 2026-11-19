import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SurvivalWorld} from '../world.mjs';

const config=JSON.parse(readFileSync(new URL('../../../client/survival/balance.json',import.meta.url),'utf8'));
const create=mode=>new SurvivalWorld(structuredClone(config),null,{onlineRoster:true,mode,missionStart:'free'});

test('a shot clears the visible practice plinth but still strikes its solid face',()=>{
  const w=create('mission'),p=w.allocate('合成射击测试员','account:synthetic-visible-shot');
  const stand=w.staticWorld().terminals.find(t=>t.definitionId==='lmg'&&t.type==='training');
  w.s.destructibles={};w.s.enemies={};
  const open={x:stand.x,y:stand.y+1.05,z:stand.z+2};
  const solid={...open,y:stand.y+.9},direction={x:0,y:0,z:-1};
  assert.equal(w.rayBlock(open,direction,3),null,'invisible space above the plinth blocked the muzzle');
  assert.equal(w.rayBlock(solid,direction,3)?.id,stand.id,'the visible plinth no longer blocks fire');
  Object.assign(p,{x:stand.x,y:stand.y,z:stand.z+2,yaw:0,pitch:0,equipUntil:0,joinProtectionUntil:0});
  const originalRng=w.rng.bind(w);w.rng=stream=>stream==='combat'?.5:originalRng(stream);
  w.fire(p,0,0);
  const shot=w.drainEvents().find(e=>e.eventType==='Shot')?.payload;
  assert(shot,'actual gunshot was not emitted');
  assert.notEqual(shot.targetId,stand.id,'the shot stopped on an invisible stand lid');
  assert(shot.to.z<stand.z-.5,'the shot did not pass the stand');
  w.assertInvariants();
});

test('a thin barricade blocks its board and feet, while the open side stays shootable',()=>{
  const w=create('adventure'),x=20,z=10,y=w.ground(x,z);
  w.s.destructibles={test_board:{id:'test_board',kind:'barricade',x,y,z,yaw:0,hp:80,maxHp:80,size:{x:2.4,y:1.25,z:.4},broken:false,revision:1}};
  const direction={x:1,y:0,z:0},from=(height,side)=>({x:x-1.5,y:y+height,z:z+side});
  assert.equal(w.rayBlock(from(.8,.17),direction,3),null,'empty depth beside the panel is an air wall');
  assert.equal(w.rayBlock(from(.8,0),direction,3)?.id,'test_board','visible board is not solid');
  assert.equal(w.rayBlock(from(.1,.17),direction,3)?.id,'test_board','visible foot is not solid');
  w.assertInvariants();
});

test('the round barrel no longer catches bullets at empty square corners',()=>{
  const w=create('adventure'),x=20,z=10,y=w.ground(x,z),size={x:1.05,y:1.5,z:1.05};
  w.s.destructibles={test_barrel:{id:'test_barrel',kind:'barrel',x,y,z,yaw:0,hp:60,maxHp:60,size,broken:false,revision:1}};
  const direction={x:0,y:-1,z:0};
  assert.equal(w.rayBlock({x:x+size.x*.48,y:y+size.y+.4,z:z+size.z*.48},direction,.7),null,'empty barrel corner catches bullets');
  assert.equal(w.rayBlock({x,y:y+size.y+.4,z},direction,.7)?.id,'test_barrel','barrel body is not solid');
  w.assertInvariants();
});
