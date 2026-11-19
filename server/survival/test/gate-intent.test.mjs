import test from 'node:test';
import assert from 'node:assert/strict';
import {SurvivalWorld} from '../world.mjs';
import {loadConfig} from '../config.mjs';
const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));
function fixture(){
 const world=new SurvivalWorld(config,null,{onlineRoster:true});
 const players=[world.allocate('门内测试员','gate-synthetic-a'),world.allocate('门外测试员','gate-synthetic-b')];
 const gate=world.s.buildings.G01;gate.hp=gate.maxHp;gate.gateOpen=false;world.setPhase('NIGHT');
 for(const [i,p]of players.entries())Object.assign(p,{x:gate.x,z:gate.z+(i?1.6:-1.6),y:world.ground(gate.x,gate.z),vy:0});
 function command(p,payload){return world.command(p,{requestId:p.requestHighWater+1,command:'ToggleGate',targetId:gate.id,payload});}
 return {world,players,gate,command};
}
test('concurrent panel open and close intentions are idempotent at night and preserve saved resources',()=>{
 const {world,players:[a,b],gate,command}=fixture();const items=structuredClone(world.s.items),bank=structuredClone(world.s.bank),revision=gate.revision;
 assert(command(a,{open:true}).ok);assert(command(b,{open:true}).ok);assert.equal(gate.gateOpen,true);assert.equal(gate.revision,revision+1);
 assert(command(b,{open:false}).ok);assert(command(a,{open:false}).ok);assert.equal(gate.gateOpen,false);assert.equal(gate.revision,revision+2);
 assert(command(a,{open:true}).ok);const restored=new SurvivalWorld(config,JSON.parse(JSON.stringify(world.serialize())),{onlineRoster:true});
 assert.equal(restored.s.buildings.G01.gateOpen,true);assert.deepEqual(restored.s.items,items);assert.deepEqual(restored.s.bank,bank);world.assertInvariants();
});
test('explicit close safely clears a doorway occupant and keyboard E still toggles once per command',()=>{
 const {world,players:[a,b],gate,command}=fixture();assert(command(a,{open:true}).ok);
 Object.assign(b,{x:gate.x,z:gate.z});assert(command(a,{open:false}).ok);assert.equal(gate.gateOpen,false);
 assert.equal(world.blocked(b.x,b.y,b.z,config.player.capsule_radius,b.id),undefined);
 assert(Math.hypot(b.x-gate.x,b.z-gate.z)>.35);assert(command(a,{}).ok);assert.equal(gate.gateOpen,true);
 assert(command(a,{}).ok);assert.equal(gate.gateOpen,false);world.assertInvariants();
});
test('gate intention does not bypass range, destroyed-door or payload validation even for a no-op',()=>{
 const {players:[a],gate,command}=fixture();
 assert.equal(command(a,{open:'false'}).code,'INVALID_TARGET');assert.equal(gate.gateOpen,false);
 a.z=gate.z-3;assert.equal(command(a,{open:false}).code,'OUT_OF_RANGE');a.z=gate.z-1.6;
 gate.hp=0;assert.equal(command(a,{open:true}).code,'INVALID_TARGET');assert.equal(gate.gateOpen,false);
});
