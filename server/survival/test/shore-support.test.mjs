import test from 'node:test';
import assert from 'node:assert/strict';
import {footprintBase} from '../terrain-layout.mjs';
import {fixture,base} from './director-helpers.mjs';
import {SurvivalWorld} from '../world.mjs';

test('flat ground preserves original obstacle bottom',()=>assert.equal(footprintBase(-2,5,0,1.2,1.2,()=>5),5));
test('whole footprint support covers rotated boxes beside channels across six seeds',()=>{
 for(const seed of [73421,1,42,2026,99,987654]){
  const config=structuredClone(base);config.cycle.seed_default=seed;const world=new SurvivalWorld(config);
  for(const prop of Object.values(world.s.destructibles)){
   const b=world.propBox(prop);assert.equal(b.y1,prop.y+prop.size.y);
   for(let i=0;i<=12;i++)for(let j=0;j<=12;j++){const x=b.x0+(b.x1-b.x0)*i/12,z=b.z0+(b.z1-b.z0)*j/12;assert(b.y0<=world.ground(x,z)+.08+1e-8);}
  }
 }
});
test('old sloping prop gets matching lower collision without moving its ID or changing loot',()=>{
 const {w,p}=fixture();const x=-55.42949,z=2.03636;const prop={id:'shore-test',kind:'crate',x,y:w.ground(x,z),z,yaw:0,size:{x:1.2,y:1.2,z:1.2},hp:45,maxHp:45,revision:1,broken:false,seed:1};w.s.destructibles[prop.id]=prop;
 const old=structuredClone(prop),box=w.propBox(prop);assert(box.y0<prop.y-.9);assert.deepEqual(prop,old);
 const restored=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});assert.deepEqual(restored.propBox(restored.s.destructibles[prop.id]),box);
 assert(restored.boxes().some(b=>b.id===prop.id&&b.y0===box.y0));restored.breakProp(restored.s.destructibles[prop.id],{actorId:p.id});assert(!restored.boxes().some(b=>b.id===prop.id));restored.assertInvariants();
});
