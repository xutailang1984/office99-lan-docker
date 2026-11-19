import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {footprintBase,terrainHeight} from '../../../server/survival/terrain-layout.mjs';
import {SurvivalWorld} from '../../../server/survival/world.mjs';
import {quantizeWire} from '../../../server/survival/state-wire.mjs';
const config=JSON.parse(await fs.readFile(new URL('../../../client/survival/balance.json',import.meta.url)));

test('support includes negative-coordinate boundary cells and internal grid vertex troughs',()=>{
 assert.equal(footprintBase(-.3,5,-.4,2.4,.4,(x,z)=>x===-2&&z===-2?-2:5),-2.025);
 assert.equal(footprintBase(0,5,0,5,5,(x,z)=>x===0&&z===0?-2:5),-2.025);
});
test('only >8cm support difference creates a foundation; flat ground remains unchanged',()=>{
 assert.equal(footprintBase(0,.08,0,1,1,()=>0),.08);
 assert.equal(footprintBase(0,.08001,0,1,1,()=>0),-.025);
 assert.equal(footprintBase(-57,1,12,1.2,1.2,()=>1),1);
});
test('known legacy shoreline footing covers every sampled bottom point',()=>{
 const x=-55.429489572141705,z=2.036355505588363,y=terrainHeight(x,z,config),floor=footprintBase(x,y,z,1.2,1.2,(x,z)=>terrainHeight(x,z,config));
 assert(floor<y-.9);
 for(let i=0;i<=30;i++)for(let j=0;j<=30;j++)assert(floor<=terrainHeight(x-.6+i/25,z-.6+j/25,config));
});
test('arbitrary rotated AABB uses matching top and cached support until transform/size changes',()=>{
 const w=new SurvivalWorld(config),p={id:'synthetic-support',kind:'barricade',x:-55.43,y:1.114,z:2.036,yaw:Math.PI/3,size:{x:2.4,y:1.25,z:.4},hp:80,maxHp:80,seed:1,broken:false};w.s.destructibles={[p.id]:p};
 const before=structuredClone(p),box=w.propBox(p);assert.equal(box.y1,p.y+p.size.y);assert(Math.abs(box.x1-box.x0-(2.4*.5+.4*Math.sqrt(3)/2))<1e-8);assert.deepEqual(p,before);
 let calls=0;const original=w.ground.bind(w);w.ground=(...args)=>{calls++;return original(...args)};w.boxes();calls=0;w.boxes();assert.equal(calls,0);p.x+=.3;w.boxes();assert(calls>0);calls=0;p.size.z+=.3;w.boxes();assert(calls>0);
});
test('destroying supported old prop removes collision and creates only one unchanged loot origin',()=>{
 const w=new SurvivalWorld(config),p={id:'synthetic-support',kind:'crate',x:-55.43,y:1.114,z:2.036,yaw:0,size:{x:1.2,y:1.2,z:1.2},hp:45,maxHp:45,revision:1,seed:1,broken:false};w.s.destructibles={[p.id]:p};assert(w.boxes().some(b=>b.id===p.id));
 const start=Object.keys(w.s.containers).length;w.breakProp(p,{actorId:'synthetic-attacker'});w.breakProp(p,{actorId:'synthetic-attacker'});assert.equal(Object.keys(w.s.containers).length,start+1);assert(!w.boxes().some(b=>b.id===p.id));const drop=w.s.containers[p.lootContainerId];assert.deepEqual([drop.x,drop.y,drop.z],[p.x,p.y,p.z]);
});
test('derived supportY survives wire/float32 boundaries without modifying saved prop data',()=>{
 const w=new SurvivalWorld(config);
 for(const [kind,z,size] of [['crate',2.6004,{x:1.2,y:1.2,z:1.2}],['barrel',2.5249,{x:1.05,y:1.5,z:1.05}]]){
  const p={id:'synthetic-wire-'+kind,kind,x:-61,y:1,z,yaw:0,size,hp:45,maxHp:45,revision:1,seed:1,broken:false};w.s.destructibles={[p.id]:p};const original=structuredClone(p),expected=w.propBox(p).y0;
  const wire=quantizeWire(w.publicState()).destructibles.find(x=>x.id===p.id);assert(Number.isFinite(wire.supportY));assert(Math.abs(Math.fround(wire.supportY)-expected)<.001);assert.deepEqual(p,original);assert(!Object.hasOwn(w.serialize().destructibles[p.id],'supportY'));
 }
});
