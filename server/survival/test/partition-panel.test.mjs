import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../config.mjs';
import {SurvivalWorld} from '../world.mjs';
import {compileState,diffState} from '../state-wire.mjs';

const config=await loadConfig(new URL('../../../client/survival/balance.json',import.meta.url));

function fixture(players=1){
  const world=new SurvivalWorld(structuredClone(config),null,{onlineRoster:true});
  const roster=Array.from({length:players},(_,index)=>world.allocate(`Partition ${index+1}`,`synthetic-partition-${index+1}`));
  world.setPhase('DAY');world.s.paused=false;world.drainEvents();
  return {world,roster};
}
function rows(world){
  const groups=new Map();
  for(const panel of Object.values(world.s.destructibles).filter(prop=>prop.kind==='partition_panel')){
    if(!groups.has(panel.partitionGroupId))groups.set(panel.partitionGroupId,[]);
    groups.get(panel.partitionGroupId).push(panel);
  }
  return [...groups.values()].map(group=>group.sort((a,b)=>a.partitionIndex-b.partitionIndex));
}
function lane(panel,offset=0){
  const normal={x:-Math.sin(panel.yaw),z:-Math.cos(panel.yaw)};
  const x=panel.x+offset*Math.cos(panel.yaw),z=panel.z-offset*Math.sin(panel.yaw);
  const from={x:x+normal.x*1.2,y:panel.y+1,z:z+normal.z*1.2};
  const to={x:x-normal.x*1.2,y:panel.y+1,z:z-normal.z*1.2};
  return {from,to,direction:{x:-normal.x,y:0,z:-normal.z}};
}

test('two three-piece partitions fit the existing prop budget and form clearable lanes',()=>{
  const {world}=fixture(8),groups=rows(world);
  assert.equal(Object.keys(world.s.destructibles).length,36);
  assert.equal(groups.length,2);
  for(const group of groups){
    assert.deepEqual(group.map(panel=>panel.partitionIndex),[0,1,2]);
    assert(group.every(panel=>panel.yaw===group[0].yaw&&panel.zoneId===group[0].zoneId));
    const [left,middle,right]=group,route=lane(middle);
    assert.equal(world.rayBlock(route.from,route.direction,2.4)?.id,middle.id);
    assert.equal(world.navigationTraverse(route.from,route.to,.35,{...route.from,definitionId:'crab',radius:.35}),false);
    const enemy={...route.from,id:'synthetic-crab',y:world.ground(route.from.x,route.from.z),definitionId:'crab',source:'wild',radius:.6};
    const target={...route.to,id:'synthetic-target',y:world.ground(route.to.x,route.to.z)};
    assert.equal(world.enemyRouteTarget(enemy,target)?.id,middle.id);
    world.breakProp(middle,{actorId:null,weaponId:'rifle',shotId:'open-middle'});
    assert.equal(world.rayBlock(route.from,route.direction,2.4),null);
    assert.equal(world.blocked(middle.x,middle.y,middle.z,.35),undefined);
    assert.equal(world.navigationTraverse(route.from,route.to,.35,{...route.from,definitionId:'crab',radius:.35}),true);
    assert.equal(world.navigationTraverse(route.from,route.to,.6,{...route.from,definitionId:'crab',radius:.6}),true);
    assert.equal(world.enemyRouteTarget(enemy,target),target);
    for(const neighbor of [left,right]){
      const other=lane(neighbor);
      assert.equal(world.rayBlock(other.from,other.direction,2.4)?.id,neighbor.id);
      assert.equal(world.blocked(neighbor.x,neighbor.y,neighbor.z,.35)?.id,neighbor.id);
    }
  }
  world.assertInvariants();
});

test('eight simultaneous hits remove one panel once and save its open passage',()=>{
  const {world,roster}=fixture(8),[left,middle,right]=rows(world)[0],route=lane(middle);
  const beforeFrame=compileState(world.publicState());
  for(const player of roster)world.damageQueue.push({target:middle.id,damage:20,actorId:player.id,weaponId:'pistol',shotId:`shot-${player.id}`});
  world.resolveDamage();
  const patch=diffState(beforeFrame,compileState(world.publicState())).delta.entities.destructibles;
  assert.deepEqual(patch.patch.map(change=>change.id),[middle.id]);
  assert.equal(patch.patch[0].set.broken,true);
  assert.equal(patch.patch[0].set.hp,0);
  assert.equal(patch.remove.length,0);
  const events=world.drainEvents().filter(event=>event.eventType==='Destroyed'&&event.payload.targetId===middle.id);
  assert.equal(events.length,1);
  assert.equal(middle.broken,true);
  const loot=world.s.containers[middle.lootContainerId];
  assert(loot);assert.equal(loot.itemIds.length,1);
  assert.equal(world.s.items[loot.itemIds[0]].definitionId,'scrap');
  assert.equal(world.s.items[loot.itemIds[0]].quantity,1);
  world.breakProp(middle,{actorId:roster[0].id,weaponId:'rifle',shotId:'late-hit'});
  assert.equal(Object.values(world.s.containers).filter(box=>box.id===loot.id).length,1);
  const publicPanels=world.publicState().destructibles.filter(panel=>panel.partitionGroupId===middle.partitionGroupId);
  assert.deepEqual(publicPanels.sort((a,b)=>a.partitionIndex-b.partitionIndex).map(panel=>panel.broken),[false,true,false]);
  const restored=new SurvivalWorld(world.c,world.serialize(),{onlineRoster:true});
  assert.equal(restored.s.destructibles[middle.id].broken,true);
  assert.equal(restored.s.destructibles[left.id].broken,false);
  assert.equal(restored.s.destructibles[right.id].broken,false);
  assert.equal(restored.rayBlock(route.from,route.direction,2.4),null);
  assert.equal(restored.navigationTraverse(route.from,route.to,.35,{...route.from,definitionId:'crab',radius:.35}),true);
  assert.deepEqual(restored.s.containers[loot.id].itemIds,loot.itemIds);
  restored.assertInvariants();
});

test('eight players can repeatedly breach every segment without duplicated drops or stale cover',()=>{
  for(let round=0;round<12;round++){
    const {world,roster}=fixture(8),panels=rows(world).flat(),before=compileState(world.publicState());
    assert.equal(panels.length,6);
    for(const panel of panels)for(const player of roster)world.damageQueue.push({
      target:panel.id,damage:20,actorId:player.id,weaponId:'pistol',shotId:`round-${round}-${panel.id}-${player.id}`
    });
    world.resolveDamage();
    const destroyed=world.drainEvents().filter(event=>event.eventType==='Destroyed'&&panels.some(panel=>panel.id===event.payload.targetId));
    assert.equal(destroyed.length,6);
    assert.equal(new Set(destroyed.map(event=>event.payload.targetId)).size,6);
    const patch=diffState(before,compileState(world.publicState())).delta.entities.destructibles;
    assert.deepEqual(new Set(patch.patch.map(change=>change.id)),new Set(panels.map(panel=>panel.id)));
    for(const panel of panels){
      const route=lane(panel),loot=world.s.containers[panel.lootContainerId];
      assert.equal(panel.broken,true);
      assert.equal(world.rayBlock(route.from,route.direction,2.4),null);
      assert(loot);assert.equal(loot.itemIds.length,1);
      assert.equal(world.s.items[loot.itemIds[0]].quantity,1);
    }
    const restored=new SurvivalWorld(world.c,world.serialize(),{onlineRoster:true});
    assert(panels.every(panel=>restored.s.destructibles[panel.id].broken));
    restored.assertInvariants();
  }
});

test('old scenery remains during resumed day and new panels appear on the next day',()=>{
  const {world}=fixture(),saved=world.serialize();
  for(const panel of Object.values(saved.destructibles).filter(prop=>prop.kind==='partition_panel')){
    Object.assign(panel,{kind:'barricade',hp:80,maxHp:80,size:{x:2.4,y:1.25,z:.4}});
    delete panel.partitionGroupId;delete panel.partitionIndex;
  }
  const resumed=new SurvivalWorld(world.c,saved,{onlineRoster:true});
  assert.equal(rows(resumed).length,0);
  assert.deepEqual(resumed.s.destructibles,saved.destructibles);
  resumed.generateDay();
  assert.equal(rows(resumed).length,2);
  assert.equal(Object.keys(resumed.s.destructibles).length,36);
  resumed.assertInvariants();
});
