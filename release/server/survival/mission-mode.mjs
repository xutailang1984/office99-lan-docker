// A temporary practice chapter. It observes the real world rules and never
// changes adventure saves, prices, damage or item definitions.
const STAGES=[
  {id:'move',title:'报到',hint:'走几步，转动视角',checks:['walk','look']},
  {id:'fish',title:'摸鱼',hint:'抛竿，钓起一条鱼并击败它',checks:['land','defeat_fish']},
  {id:'search',title:'外勤',hint:'翻找档案柜，再打碎练习箱',checks:['search','break']},
  {id:'fight',title:'试射',hint:'开枪并击败一只练习怪',checks:['shot','defeat']},
  {id:'base',title:'守灯',hint:'靠近协作灯，按住 E 修好它',checks:['repair']},
];
const LOANABLE=new Set(['pistol','smg','carbine','lmg','shotgun','rifle','rod_basic','rod_pro','rod_light','rod_heavy','rod_magnet','decoy_alarm','repair_kit','coffee_flask','flash_note','bandage']);
const TUTORIAL_TYPES=['crab','courier','shield_bug'];
const PARK={patrol:{x:0,z:-38,radius:14,activation:20},boss:{x:-22,z:-38,radius:11,activation:15},props:[{x:13,z:-29},{x:18,z:-32}]};
const PRACTICE_LOOT_LIMIT=12;
export const PRACTICE_CREATURE_CAP=8;
export function practiceCreatureLoad(world){
  return Object.keys(world.s.enemies).length+world.scenePlayers().filter(player=>player.fishing?.catch_kind==='creature').length;
}
export class MissionError extends Error {constructor(code,message='任务操作无效'){super(message);this.code=code;}}
const fail=(code,message)=>{throw new MissionError(code,message);};
const stage=world=>STAGES[world.s.mission.stage];

function place(world,p,center,radius=3){
  try {const point=world.choosePoint(center,radius,[],1,0,'world');Object.assign(p,{x:point.x,y:point.y,z:point.z,vy:0,input:{}});}
  catch {const y=world.ground(center.x,center.z);Object.assign(p,{x:center.x,y,z:center.z,vy:0,input:{}});}
}
function removePracticeEnemies(world){
  for(const enemy of Object.values(world.s.enemies))if(enemy.missionWave){delete world.s.enemies[enemy.id];world.aggro.forget(enemy.id);world.event('Removed',{kind:'enemy',actorId:null},enemy.id);}
}
function spawnWave(world,p,count=2){
  removePracticeEnemies(world);
  const limit=Math.min(4,Math.max(2,count));
  for(let i=0;i<limit;i++){
    const id=TUTORIAL_TYPES[Math.floor(world.rng('combat')*TUTORIAL_TYPES.length)];
    const center={x:p.x+(i%2?7:-7),z:p.z+(i<2?7:-7)};
    let point;try{point=world.choosePoint(center,4,world.scenePlayers(),3,12,'world');}catch{continue;}
    const enemy=world.spawnEnemy(id,point.x,point.z);enemy.missionWave=true;enemy.homeX=point.x;enemy.homeZ=point.z;
  }
}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const inPark=point=>point.z>=-51&&point.z<=-18&&point.x>=-35&&point.x<=25;
export function practiceEnemyInside(enemy,point){
  const zone=PARK[enemy.practiceZone];
  return !!zone&&distance(zone,point)<=zone.radius&&point.z<=-24;
}
function removePracticeFixture(world,prop){
  if(!prop)return;
  delete world.s.destructibles[prop.id];
  if(world.navGeometry)world.navGeometry.tick=-1;
  world.event('Removed',{kind:'prop',actorId:null},prop.id);
}
function clearPractice(world){
  removePracticeEnemies(world);
  for(const prop of Object.values(world.s.destructibles))if(prop.practiceFixture)removePracticeFixture(world,prop);
  if(world.s.mission)world.s.mission.park={creatureCursor:0,activeEnemyIds:[],nextCreatureAt:world.s.time,creatureSeen:[],bossId:null,nextBossAt:world.s.time,propCursor:0,activePropIds:[],nextPropAt:world.s.time,propSeen:[],nextCleanupAt:world.s.time,patrolEmptyAt:null,bossEmptyAt:null};
}
function spawnPracticeEnemy(world,zone,id){
  const center=PARK[zone],used=[...world.scenePlayers(),...Object.values(world.s.enemies),...Object.values(world.s.destructibles).filter(prop=>!prop.broken)];
  let point;try{point=world.choosePoint(center,zone==='boss'?2:4,used,2.5,18,'combat');}catch{return null;}
  const enemy=world.spawnEnemy(id,point.x,point.z);
  Object.assign(enemy,{missionWave:true,practiceZone:zone,source:'practice',homeX:point.x,homeZ:point.z,zoneId:null});
  if(zone==='boss')enemy.variantId='base';
  return enemy;
}
function spawnPracticeProp(world,slot){
  const park=world.s.mission.park,types=world.c.destructibles.types;
  if(!types.length)return null;
  const kind=types[park.propCursor%types.length],center=PARK.props[slot];
  if(world.scenePlayers().some(p=>p.lifeState!=='DEAD_WAIT'&&distance(p,center)<2.5))return null;
  if(Object.values(world.s.destructibles).some(prop=>!prop.broken&&distance(prop,center)<3))return null;
  const prop={id:world.id('prop'),kind:kind.id,material:kind.material,x:center.x,y:world.ground(center.x,center.z),z:center.z,yaw:0,hp:kind.hp,maxHp:kind.hp,size:{...kind.size},radius:Math.hypot(kind.size.x,kind.size.z)/2,revision:1,broken:false,seed:Math.floor(world.rng('props')*2147483647),missionFixture:true,practiceFixture:true,practiceSlot:slot,opened:false,resolution:null,lootContainerId:null};
  world.s.destructibles[prop.id]=prop;
  if(world.navGeometry)world.navGeometry.tick=-1;
  park.activePropIds.push(prop.id);park.propCursor++;
  if(!park.propSeen.includes(kind.id))park.propSeen.push(kind.id);
  return prop;
}
function cleanPracticeLoot(world){
  const containers=Object.values(world.s.containers).filter(c=>c.source==='practice').sort((a,b)=>(a.createdAt??0)-(b.createdAt??0));
  const expired=containers.filter(c=>world.s.time-(c.createdAt??world.s.time)>75);
  const overflow=containers.slice(0,Math.max(0,containers.length-PRACTICE_LOOT_LIMIT));
  for(const box of new Set([...expired,...overflow])){
    for(const id of [...box.itemIds])if(world.s.items[id])world.removeItem(world.s.items[id]);
    delete world.s.containers[box.id];
    world.event('Removed',{kind:'container',actorId:null},box.id);
  }
}
function practiceStep(world){
  const park=world.s.mission.park,now=world.s.time,players=world.scenePlayers().filter(p=>p.lifeState==='ALIVE');
  const nearPatrol=players.filter(p=>distance(p,PARK.patrol)<=PARK.patrol.activation&&p.z<=-17);
  const nearBoss=players.some(p=>distance(p,PARK.boss)<=PARK.boss.activation&&p.z<=-24);
  park.patrolEmptyAt=nearPatrol.length?null:park.patrolEmptyAt??now;
  park.bossEmptyAt=nearBoss?null:park.bossEmptyAt??now;
  if(park.patrolEmptyAt!==null&&now-park.patrolEmptyAt>20)for(const id of park.activeEnemyIds){const enemy=world.s.enemies[id];if(enemy){delete world.s.enemies[id];world.aggro.forget(id);world.event('Removed',{kind:'enemy',actorId:null},id);}}
  if(park.bossEmptyAt!==null&&now-park.bossEmptyAt>20&&world.s.enemies[park.bossId]){const id=park.bossId;delete world.s.enemies[id];world.aggro.forget(id);world.event('Removed',{kind:'enemy',actorId:null},id);}
  park.activeEnemyIds=park.activeEnemyIds.filter(id=>!!world.s.enemies[id]);
  if(park.activeEnemyIds.length<Math.min(2,nearPatrol.length>=4?2:1)&&nearPatrol.length&&now>=park.nextCreatureAt&&practiceCreatureLoad(world)<PRACTICE_CREATURE_CAP){
    const roster=world.c.creatures.filter(def=>def.id!=='boss_crab');
    const id=roster[park.creatureCursor%roster.length]?.id,enemy=id?spawnPracticeEnemy(world,'patrol',id):null;
    if(enemy){park.activeEnemyIds.push(enemy.id);park.creatureCursor++;park.nextCreatureAt=now+6;if(!park.creatureSeen.includes(id))park.creatureSeen.push(id);}
    else park.nextCreatureAt=now+2;
  }
  if(nearBoss&&!world.s.enemies[park.bossId]&&now>=park.nextBossAt&&practiceCreatureLoad(world)<PRACTICE_CREATURE_CAP){
    const boss=spawnPracticeEnemy(world,'boss','boss_crab');
    if(boss){park.bossId=boss.id;park.nextBossAt=now+20;}
    else park.nextBossAt=now+2;
  }
  for(const propId of [...park.activePropIds]){
    const prop=world.s.destructibles[propId];
    if(!prop){park.activePropIds=park.activePropIds.filter(id=>id!==propId);continue;}
    if(prop.broken&&now-(prop.brokenAt??(prop.brokenAt=now))>=6){removePracticeFixture(world,prop);park.activePropIds=park.activePropIds.filter(id=>id!==propId);park.nextPropAt=now;}
  }
  if(park.activePropIds.length<PARK.props.length&&now>=park.nextPropAt){
    const slot=PARK.props.findIndex((_,i)=>!park.activePropIds.some(id=>world.s.destructibles[id]?.practiceSlot===i));
    if(slot>=0)spawnPracticeProp(world,slot);
    park.nextPropAt=now+2;
  }
  if(now>=park.nextCleanupAt){cleanPracticeLoot(world);park.nextCleanupAt=now+1;}
}
function equip(world,p,definitionId,{stageChange=false}={}){
  if(!LOANABLE.has(definitionId))fail('INVALID_TARGET','试用架没有这件物品');
  if(!stageChange&&world.s.mission?.freePlay&&['weapon','rod'].includes(world.defs.items[definitionId].kind)){
    world.requireAction(p);
    const display=world.staticWorld().terminals.find(t=>t.type==='training'&&t.definitionId===definitionId);
    if(!display||Math.hypot(p.x-display.x,p.z-display.z)>world.c.player.interact_distance||Math.abs(p.y-display.y)>1.4)fail('OUT_OF_RANGE','请到对应展架领取');
  }
  if(stageChange){
    world.cancelWork(p);
    world.cancelFishing(p,'练习任务已切换');
    p.reload=null;p.meleePending=null;p.input={};
  } else if(p.work||p.reload||p.fishing||p.meleePending)fail('BUSY','先完成当前动作');
  const def=world.defs.items[definitionId],bag=world.bag(p);
  if(def.kind==='weapon'||def.kind==='rod'){
    const container=world.s.containers[p.equipment[def.kind]];
    for(const id of [...container.itemIds])world.removeItem(world.s.items[id]);
    world.createItem(definitionId,1,container,{loanOwnerSlotId:p.slotId,magazineAmmo:world.defs.weapons[definitionId]?.magazine??0});
    p.heldSlot=def.kind;
  } else {
    for(const id of [...bag.itemIds]){const item=world.s.items[id];if(item.loanOwnerSlotId===p.slotId&&['tool','consumable'].includes(world.defs.items[item.definitionId].kind))world.removeItem(item);}
    if(!world.canFit(bag,definitionId,1))fail('NO_CAPACITY','背包已满，请先整理');
    const item=world.createItem(definitionId,Math.min(3,def.stack),bag,{loanOwnerSlotId:p.slotId});
    p.quickItemDefinitionId=item.definitionId;p.heldSlot='quick';
  }
  p.equipUntil=world.s.time+.2;world.setAction(p,'equip',.2,{definitionId});
  world.event('Notice',{code:'MISSION_EQUIPPED',actorId:p.id,message:'已领取试用品'},p.id);
  return {definitionId};
}
function refill(world,p){
  p.hp=world.c.player.max_hp;p.stamina=world.c.player.stamina_max;
  const weapon=world.equipped(p,'weapon'),definition=world.defs.weapons[weapon?.definitionId];
  if(definition){weapon.magazineAmmo=definition.magazine;weapon.revision++;}
  const bag=world.bag(p);
  const bandages=Math.max(0,2-world.count(p,'bandage'));
  if(bandages&&world.canFit(bag,'bandage',bandages))world.addItems(bag,'bandage',bandages);
  world.event('Notice',{code:'MISSION_REFILLED',actorId:p.id,message:'生命已补满 · 子弹无限'},p.id);
  return {refilled:true};
}
function enterStage(world,index){
  const mission=world.s.mission;mission.stage=index;mission.freePlay=false;mission.anchors={};
  clearPractice(world);
  for(const p of world.scenePlayers())placeForStage(world,p);
  if(index===3){const p=world.scenePlayers()[0];if(p)spawnWave(world,p,2);}
  if(index===4){const core=world.s.buildings.core;core.hp=Math.min(core.hp,Math.max(1,core.maxHp-400));core.revision++;}
  world.event('Notice',{code:'MISSION_STAGE',message:`入职任务：${stage(world).title}`});
}
export function placeForStage(world,p){
  const mission=world.s.mission;if(!mission)return;
  if(mission.freePlay){p.yaw=Math.PI;p.pitch=0;return;}
  const index=mission.stage;
  if(index===1){place(world,p,world.location('fishing_near'),3);equip(world,p,'rod_basic',{stageChange:true});}
  else if(index===2){const target=world.s.destructibles[mission.archiveId];if(target)place(world,p,target,2.5);equip(world,p,'carbine',{stageChange:true});}
  else if(index===3){place(world,p,{x:0,z:25},3);equip(world,p,'carbine',{stageChange:true});}
  else if(index===4)place(world,p,{x:0,z:2},.3);
  else place(world,p,world.staticWorld().spawn,1.2);
  mission.anchors[p.id]={x:p.x,z:p.z,yaw:p.yaw};
}
function mark(world,key){
  const mission=world.s.mission;if(!mission||mission.freePlay||mission.completed)return;
  const current=stage(world);if(!current.checks.includes(key)||mission.checks[current.id]?.includes(key))return;
  mission.checks[current.id]??=[];mission.checks[current.id].push(key);
  if(current.checks.every(value=>mission.checks[current.id].includes(value))){
    const next=STAGES.findIndex(value=>!value.checks.every(check=>mission.checks[value.id]?.includes(check)));
    if(next<0){mission.completed=true;mission.freePlay=true;clearPractice(world);world.event('Notice',{code:'MISSION_COMPLETE',message:'入职完成！可以开始冒险，也可以继续试用。'});}
    else enterStage(world,next);
  }
}
export function initializeMission(world,start='tutorial'){
  world.mode='mission';world.s.mode='mission';world.s.phase='DAY';world.s.phaseElapsed=0;world.s.calendar={minutes:600};
  world.generateDay();world.s.enemies={};world.s.projectiles={};world.events=[];
  world.s.bank.credits=10000;world.s.bank.materials=1000;world.s.bank.revision++;
  const archive=Object.values(world.s.destructibles).find(prop=>prop.kind==='archive_cabinet'&&!inPark(prop))??Object.values(world.s.destructibles).find(prop=>prop.kind==='archive_cabinet');
  for(const prop of Object.values(world.s.destructibles))if(prop.id!==archive?.id&&inPark(prop))delete world.s.destructibles[prop.id];
  for(const node of Object.values(world.s.nodes))if(inPark(node))delete world.s.nodes[node.id];
  world.s.mission={version:2,entry:start,seed:world.s.rng.world,stage:0,checks:{},anchors:{},fishEnemyId:null,archiveId:archive?.id??null,completed:false,freePlay:start==='free',park:null};
  clearPractice(world);
  if(archive){
    try{const type=world.c.destructibles.types.find(t=>t.id==='crate'),point=world.choosePoint(archive,4,[archive],2.5,12,'props');const prop={id:world.id('prop'),kind:'crate',material:type.material,...point,yaw:0,hp:type.hp,maxHp:type.hp,size:{...type.size},radius:Math.hypot(type.size.x,type.size.z)/2,revision:1,broken:false,seed:12345,missionFixture:true};world.s.destructibles[prop.id]=prop;}
    catch{/* Existing island props remain available if placement is crowded. */}
  }
}
export function missionCommand(world,p,payload){
  const mission=world.s.mission;if(!mission)fail('WRONG_PHASE');
  const action=payload?.action;
  if(action==='equip')return equip(world,p,payload.definitionId);
  if(action==='refill')return refill(world,p);
  if(['training','water','combat','props','boss'].includes(action)){
    if(!mission.freePlay)fail('WRONG_PHASE','完成入职任务后开放训练场');
    world.requireAction(p);
    if(p.work||p.fishing||p.reload||p.meleePending)fail('BUSY','先完成当前动作');
    const destinations={training:{x:0,z:17},water:{x:0,z:21.5},combat:{x:0,z:-21},props:{x:13,z:-22},boss:{x:-18,z:-26}};
    place(world,p,destinations[action],.3);
    p.yaw=['training','combat','boss','props'].includes(action)?0:Math.PI;
    p.pitch=action==='water'?-.12:0;
    world.event('MissionTeleported',{actorId:p.id,position:{x:p.x,y:p.y,z:p.z},yaw:p.yaw,pitch:p.pitch},p.id);
    return {place:action};
  }
  if(world.s.hostId!==p.id)fail('HOST_ONLY','只有房主可以切换全队任务');
  if(mission.entry==='free'&&['select','restart','free_play'].includes(action))fail('WRONG_PHASE','请从大厅单人重温入职任务');
  if(action==='select'){
    const index=STAGES.findIndex(value=>value.id===payload.stageId);if(index<0)fail('INVALID_TARGET');
    enterStage(world,index);return {stageId:payload.stageId};
  }
  if(action==='restart'){mission.checks={};mission.completed=false;mission.fishEnemyId=null;enterStage(world,0);return {restarted:true};}
  if(action==='free_play'){mission.freePlay=true;clearPractice(world);return {freePlay:true};}
  fail('INVALID_TARGET');
}
export function missionEvent(world,eventType,payload,entityId){
  const mission=world.s.mission;if(!mission)return;
  if(mission.freePlay){
    const park=mission.park;
    if(eventType==='Removed'&&payload.kind==='enemy'){
      if(park.activeEnemyIds.includes(entityId))park.nextCreatureAt=world.s.time+6;
      if(park.bossId===entityId){park.bossId=null;park.nextBossAt=world.s.time+20;}
      const box=world.s.containers[payload.lootContainerId];
      if(box?.source==='practice'){box.createdAt=world.s.time;cleanPracticeLoot(world);}
    }
    if(['Destroyed','ArchiveOpened'].includes(eventType)&&world.s.destructibles[entityId]?.practiceFixture){
      if(eventType==='Destroyed')world.s.destructibles[entityId].brokenAt=world.s.time;
      const box=world.s.containers[payload.lootContainerId];if(box){box.source='practice';box.createdAt=world.s.time;cleanPracticeLoot(world);}
    }
    return;
  }
  if(mission.completed)return;
  if(eventType==='FishingChanged'&&payload.state==='LANDED'&&payload.enemyId){mission.fishEnemyId=payload.enemyId;mark(world,'land');}
  if(eventType==='Removed'&&entityId===mission.fishEnemyId&&payload.kind==='enemy')mark(world,'defeat_fish');
  if(eventType==='Destroyed'&&payload.kind==='crate')mark(world,'break');
  if(eventType==='Shot'&&payload.actorId&&world.s.players[payload.actorId])mark(world,'shot');
  if(eventType==='Removed'&&payload.kind==='enemy'&&payload.actorId&&world.s.players[payload.actorId])mark(world,'defeat');
}
export function missionWork(world,kind,targetId){if(kind==='Search'||kind==='SearchArchive')mark(world,'search');if(kind==='Repair'&&targetId===world.s.buildings.core.id)mark(world,'repair');}
export function missionStep(world){
  const mission=world.s.mission;if(!mission)return;
  if(mission.freePlay){practiceStep(world);return;}
  if(mission.completed||mission.stage!==0)return;
  for(const p of world.scenePlayers()){
    const anchor=mission.anchors[p.id]??(mission.anchors[p.id]={x:p.x,z:p.z,yaw:p.yaw});
    if(Math.hypot(p.x-anchor.x,p.z-anchor.z)>1.2)mark(world,'walk');
    if(Math.abs(p.yaw-anchor.yaw)>.24)mark(world,'look');
  }
}
export function missionPublic(world){
  const mission=world.s.mission;if(!mission)return null;const current=stage(world),done=mission.checks[current.id]??[];
  const finished=value=>value.checks.every(check=>mission.checks[value.id]?.includes(check));
  const park=mission.park,roster=world.c.creatures.filter(def=>def.id!=='boss_crab'),props=world.c.destructibles.types;
  const activeEnemy=park?.activeEnemyIds.map(id=>world.s.enemies[id]).find(Boolean),activeProp=park?.activePropIds.map(id=>world.s.destructibles[id]).find(prop=>prop&&!prop.broken);
  const parkPublic={active:mission.freePlay,creatureId:activeEnemy?.definitionId??null,nextCreatureId:roster[park.creatureCursor%roster.length]?.id??null,creatureSeen:park.creatureSeen.length,creatureTotal:roster.length,propId:activeProp?.kind??null,nextPropId:props[park.propCursor%props.length]?.id??null,propSeen:park.propSeen.length,propTotal:props.length,bossId:world.s.enemies[park?.bossId]?.definitionId??null};
  return {stage:mission.stage,stageId:current.id,title:mission.freePlay?'自由试用':current.title,hint:mission.freePlay?'南侧试装备和钓鱼 · 北侧巡逻与拆解':current.hint,progress:done.length,goal:current.checks.length,completed:mission.completed,freePlay:mission.freePlay,seed:mission.seed,park:parkPublic,completedStages:STAGES.filter(finished).map(value=>value.id),stages:STAGES.map(value=>({id:value.id,title:value.title,done:finished(value)}))};
}
