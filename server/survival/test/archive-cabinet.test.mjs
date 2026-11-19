import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';

const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));

function fixture(players=1){
  const w=new SurvivalWorld(structuredClone(config),null,{onlineRoster:true});
  const ps=Array.from({length:players},(_,index)=>w.allocate(`Archive ${index+1}`,`archive-only-${index+1}`));
  w.setPhase('DAY');w.s.paused=false;w.s.enemies={};w.drainEvents();
  for(const p of ps)p.joinProtectionUntil=0;
  return {w,p:ps[0],ps};
}
function command(w,p,name,targetId,extra={}){return w.command(p,{type:'command',requestId:p.requestHighWater+1,command:name,targetId,...extra});}
function input(w,p,values={}){w.input(p,{seq:p.inputAck+1,dx:0,dz:0,yaw:p.yaw,pitch:p.pitch,...values});}
function advance(w,seconds,values={}){const dt=1/w.c.session.server_hz;for(let elapsed=0;elapsed<seconds-1e-8;elapsed+=dt){for(const p of w.scenePlayers())input(w,p,typeof values==='function'?values(p):values);w.step(Math.min(dt,seconds-elapsed));}}
function at(w,p,target,offset=.9){Object.assign(p,{x:target.x+offset,y:w.ground(target.x+offset,target.z),z:target.z,vy:0,swimming:false});}
function archive(w){return Object.values(w.s.destructibles).find(prop=>prop.kind==='archive_cabinet'&&!prop.broken);}
function quantities(w,container){return Object.fromEntries(container.itemIds.map(id=>w.s.items[id]).map(item=>[item.definitionId,item.quantity]));}

test('six archive cabinets share the unchanged 36 prop budget and cover all districts',()=>{
  const {w}=fixture(),props=Object.values(w.s.destructibles),cabinets=props.filter(prop=>prop.kind==='archive_cabinet');
  assert.equal(props.length,36);assert.deepEqual(Object.fromEntries(['crate','barrel','barricade','partition_panel','archive_cabinet','copier_shell','supply_locker','cable_reel','punch_clock','notice_board'].map(kind=>[kind,props.filter(prop=>prop.kind===kind).length])),{crate:6,barrel:6,barricade:2,partition_panel:6,archive_cabinet:6,copier_shell:2,supply_locker:2,cable_reel:2,punch_clock:2,notice_board:2});
  for(const zone of ['salvage','hunt','supply'])assert.equal(cabinets.filter(prop=>prop.zoneId===zone).length,2);
  assert(cabinets.every(prop=>prop.material==='metal'&&prop.hp===90&&!prop.opened&&prop.resolution===null));
  assert.equal(w.catalog().destructibles.total_count,36);w.assertInvariants();
});

test('held quiet search locks one player, alerts only eight metres and resolves one higher reward',()=>{
  const {w,p,ps}=fixture(2),cabinet=archive(w);at(w,p,cabinet);at(w,ps[1],cabinet,-.9);
  p.perks=['scavenger'];w.s.director.objective=w.director.newObjective(w.c.director.objectives.find(objective=>objective.verb==='search'));w.s.director.optionalObjective=null;
  const near=w.spawnEnemy('crab',p.x+7,p.z),far=w.spawnEnemy('crab',p.x+9,p.z);near.source=far.source='wild';
  assert.equal(command(w,p,'SearchArchive',cabinet.id).ok,true);assert.equal(command(w,ps[1],'SearchArchive',cabinet.id).code,'BUSY');
  assert.equal(near.alertState,'investigate');assert.notEqual(far.alertState,'investigate');
  advance(w,.35,{interact:false});assert.equal(p.work,null);assert.equal(cabinet.lockedBy,undefined);
  assert.equal(command(w,p,'SearchArchive',cabinet.id).ok,true);advance(w,2.05,{interact:true});
  assert.equal(p.work,null);assert.equal(cabinet.opened,true);assert.equal(cabinet.resolution,'searched');assert.equal(w.boxes().some(box=>box.id===cabinet.id),true);
  const container=w.s.containers[cabinet.lootContainerId];assert(container);const total=Object.values(w.s.items).filter(item=>item.containerId===p.backpackId&&['spring_parts','sealed_cell','coffee_coupon','bandage'].includes(item.definitionId)).reduce((sum,item)=>sum+item.quantity,0);assert(total>=1);
  assert.equal(w.count(p,'scrap'),2);assert.equal(w.s.director.objective.progress,1);
  const events=w.drainEvents();assert.equal(events.filter(event=>event.eventType==='ArchiveOpened'&&event.payload.targetId===cabinet.id).length,1);
  assert.equal(command(w,ps[1],'SearchArchive',cabinet.id).code,'NOT_FOUND');
  const before={items:Object.keys(w.s.items).length,containers:Object.keys(w.s.containers).length};w.breakProp(cabinet,{actorId:p.id,weaponId:'knife',shotId:'after-search'});w.breakProp(cabinet,{actorId:p.id,weaponId:'knife',shotId:'duplicate'});
  assert.deepEqual({items:Object.keys(w.s.items).length,containers:Object.keys(w.s.containers).length},before);assert.equal(cabinet.resolution,'searched');assert.equal(w.boxes().some(box=>box.id===cabinet.id),false);w.assertInvariants();
});

test('damage during search cancels it; grouped smash creates one low reward and metal events',()=>{
  const {w,p}=fixture(),cabinet=archive(w);at(w,p,cabinet);cabinet.seed=10;
  const near=w.spawnEnemy('crab',p.x+31,p.z),far=w.spawnEnemy('crab',p.x+33,p.z);near.source=far.source='wild';
  assert(command(w,p,'SearchArchive',cabinet.id).ok);advance(w,.4,{interact:true});assert(p.work);
  w.damageQueue.push({target:cabinet.id,damage:50,actorId:p.id,weaponId:'knife',shotId:'smash-one'},{target:cabinet.id,damage:50,actorId:p.id,weaponId:'knife',shotId:'smash-one'});w.resolveDamage();
  assert.equal(p.work,null);assert.equal(cabinet.broken,true);assert.equal(cabinet.opened,false);assert.equal(cabinet.resolution,'smashed');assert.equal(near.alertState,'investigate');assert.notEqual(far.alertState,'investigate');
  const box=w.s.containers[cabinet.lootContainerId];assert.deepEqual(quantities(w,box),{spring_parts:1});
  const events=w.drainEvents(),destroyed=events.filter(event=>event.eventType==='Destroyed'&&event.payload.targetId===cabinet.id);assert.equal(destroyed.length,1);assert.equal(destroyed[0].payload.material,'metal');assert.equal(destroyed[0].payload.resolution,'smashed');assert.equal(events.filter(event=>event.eventType==='ArchiveOpened').length,0);
  w.breakProp(cabinet,{actorId:p.id,weaponId:'knife'});assert.equal(Object.values(w.s.containers).filter(container=>container.source==='archive').length,1);w.assertInvariants();
});

test('searched and smashed states survive save reload while old current-day scenery stays untouched',()=>{
  const {w,p}=fixture(),searched=archive(w),smashed=Object.values(w.s.destructibles).find(prop=>prop.kind==='archive_cabinet'&&prop.id!==searched.id);at(w,p,searched);assert(command(w,p,'SearchArchive',searched.id).ok);advance(w,2.05,{interact:true});w.breakProp(smashed,{actorId:p.id,weaponId:'rifle',shotId:'persist'});
  const restored=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});assert.equal(restored.s.destructibles[searched.id].resolution,'searched');assert.equal(restored.s.destructibles[searched.id].opened,true);assert.equal(restored.s.destructibles[smashed.id].resolution,'smashed');assert.equal(restored.s.destructibles[smashed.id].broken,true);restored.assertInvariants();

  const old=w.serialize();for(const prop of Object.values(old.destructibles))if(prop.kind==='archive_cabinet'){Object.assign(prop,{kind:'crate',hp:45,maxHp:45,size:{x:1.2,y:1.2,z:1.2},radius:Math.hypot(1.2,1.2)/2});delete prop.material;delete prop.opened;delete prop.resolution;delete prop.lootContainerId;delete prop.zoneId;}
  const before=structuredClone(old.destructibles),legacy=new SurvivalWorld(w.c,old,{onlineRoster:true});assert.deepEqual(legacy.s.destructibles,before);legacy.generateDay();assert.equal(Object.values(legacy.s.destructibles).filter(prop=>prop.kind==='archive_cabinet').length,6);assert.equal(Object.keys(legacy.s.destructibles).length,36);
});
