import {attachExploration} from './exploration.mjs';
import {extendExplorationConfig} from './exploration-config.mjs';
import {initializeFishing,beginReeling,updateWaiting,updateReeling} from './fishing-experience.mjs';
import {extendDirectorConfig} from './director-config.mjs';
import {attachDirector,DirectorError} from './director.mjs';
import {EnemyAggro} from './enemy-aggro.mjs';
import {MissionError,initializeMission,missionCommand,missionEvent,missionWork,missionStep,missionPublic,placeForStage,practiceEnemyInside,PRACTICE_CREATURE_CAP,practiceCreatureLoad} from './mission-mode.mjs';
import {EnemyNavigation} from './enemy-navigation.mjs';
import { randomUUID } from './portable-id.mjs';
import { terrainHeight, rawTerrainHeight, footprintBase, TERRAIN_GRID, BUILDING_SLOTS, ROCKS, PONDS } from './terrain-layout.mjs';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const live = p => p.lifeState === 'ALIVE';
const UNARMED_DEFAULTS=Object.freeze({"id":"fist","damage":8,"range":1.25,"arc_deg":60,"cooldown_seconds":0.6,"windup_seconds":0.16});
const recycleLoot = def => ['catch','loot','material'].includes(def?.kind);
const safe = phase => ['PREP', 'RECOVERY', 'COMPLETE'].includes(phase);
const errorText = { NOT_SELLABLE:'借用品或此物品不能出售', CONFIRM_EQUIPPED:'请确认卖出已装备物品', OUT_OF_RANGE:'距离太远', WRONG_PHASE:'当前阶段不能执行', NOT_ALIVE:'当前不能行动', NO_CAPACITY:'背包或容器已满', NO_FUNDS:'共享资源不足', NOT_FOUND:'目标不存在', STALE_REVISION:'目标已经变化，请重试', BUSY:'目标正在使用或操作尚未完成', PRACTICE_CAP:'先打倒几只练习怪，再钓鱼', NO_AMMO:'没有对应备用弹药', INVALID_TARGET:'目标或参数无效', REQUEST_EXPIRED:'旧请求已处理，不会重复执行', HOST_ONLY:'仅房主可以执行', ROOM_FULL:'持久角色槽已占用' };
class GameError extends Error { constructor(code) { super(errorText[code] ?? code); this.code = code; } }
const requireThat = (condition, code) => { if (!condition) throw new GameError(code); };
function rayBox(origin, direction, box, maximum) {
  let near = 0, far = maximum;
  for (const axis of ['x','y','z']) {
    const low = box[`${axis}0`], high = box[`${axis}1`], component = direction[axis];
    if (Math.abs(component) < 1e-8) { if (origin[axis] < low || origin[axis] > high) return null; continue; }
    let a = (low - origin[axis]) / component, b = (high - origin[axis]) / component;
    if (a > b) [a,b] = [b,a]; near = Math.max(near, a); far = Math.min(far,b);
    if (near > far) return null;
  }
  return near;
}
function raySphere(o,d,c,r,max) { const x=o.x-c.x,y=o.y-c.y,z=o.z-c.z,b=x*d.x+y*d.y+z*d.z,q=b*b-(x*x+y*y+z*z-r*r); if(q<0)return null; const a=-b-Math.sqrt(q),t=a>=0?a:-b+Math.sqrt(q); return t>=0&&t<=max?t:null; }
const aim = (yaw,pitch) => ({ x:-Math.sin(yaw)*Math.cos(pitch), y:Math.sin(pitch), z:-Math.cos(yaw)*Math.cos(pitch) });
const unit = vector => { const length=Math.hypot(vector.x,vector.y,vector.z)||1;return {x:vector.x/length,y:vector.y/length,z:vector.z/length}; };

export class SurvivalWorld {
  constructor(config, saved = null, options = {}) {
    config=extendExplorationConfig(extendDirectorConfig(config));
    this.onlineRoster = options.onlineRoster === true;
    this.mode = options.mode === 'mission' ? 'mission' : 'adventure';
    this.c = config; this.terrainConfig = this.mode === 'mission' ? {...config,level:{...config.level,training_pond:true}} : config;
    this.defs = Object.fromEntries(['items','weapons','rods','creatures','buildings'].map(key => [key,Object.fromEntries(config[key].map(value => [value.id,value]))]));
    // Cache the immutable 2m vertices; interpolation below is exactly the renderer's triangles.
    const extent=Math.ceil((config.level.extent+180)/TERRAIN_GRID)*TERRAIN_GRID,width=extent*2/TERRAIN_GRID+1,values=new Float64Array(width*width);
    for(let z=0;z<width;z++)for(let x=0;x<width;x++)values[z*width+x]=rawTerrainHeight(x*TERRAIN_GRID-extent,z*TERRAIN_GRID-extent,this.terrainConfig);
    this.terrainCache={extent,width,values};this.colliderCache=new WeakMap();
    this.events = []; this.damageQueue = []; this.needsBarrier = false; this.requestSave = false; this.newAdventureRequested = false;
    this.s = saved ? structuredClone(saved) : this.createWorld();
    if (this.s.schema !== 3 || this.s.contentVersion !== config.content_version) throw Error('World schema/content version mismatch');
    const historicalSlots=Object.values(this.s.players).flatMap(p=>[p.slotId,Number(/^player-(\d+)$/.exec(p.id??'')?.[1])]).filter(Number.isSafeInteger);
    this.s.nextPlayerSlotId=Math.max(Number.isSafeInteger(this.s.nextPlayerSlotId)&&this.s.nextPlayerSlotId>0?this.s.nextPlayerSlotId:1,...historicalSlots.map(slot=>slot+1));
    for (const p of Object.values(this.s.players)) { this.migrateLife(p); p.connected = false; p.disconnectedAt = null; p.input = {}; p.inputAt = -100; this.cancelWork(p); p.reload = null;p.velocity={x:0,y:0,z:0};p.moveSpeed=0;p.action??='idle';p.actionSeq??=0;p.actionStartedAt??=this.s.time;p.actionDuration??=0;p.joinProtectionUntil??=0;p.lastProtectionAt??=-100;if(this.onlineRoster){this.cancelFishing(p,'重新连接后再抛竿');p.meleePending=null;p.jumpQueued=false;p.action='idle';p.actionDuration=0;} }
    this.s.hostId = null; this.s.paused = true;if(!this.s.destructibles){this.generateDestructibles();this.requestSave=true;}this.migrateCoreState();this.clearNewStationContainers();this.applyPlayerClearance(this.planPlayerClearance());this.assertInvariants();this.aggro=new EnemyAggro(this);attachDirector(this,{saved:!!saved});attachExploration(this,{saved:!!saved});
    if(this.mode==='mission'&&!saved)initializeMission(this,options.missionStart);
  }
  // Active-room membership is separate from historical account records.
  inScene(p) { return !!p && (!this.onlineRoster || p.connected === true); }
  scenePlayers() { return Object.values(this.s.players).filter(p=>this.inScene(p)); }
  migrateLife(p) {
    const c=this.c.player;
    p.downsThisDay??=0;p.downsDayIndex??=this.s.dayIndex;p.downedBleedRate??=c.downed_hp/c.downed_seconds;
    if(p.lifeState==='DOWNED'){
      // Older saves only stored seconds; preserve that lifetime instead of refilling health.
      p.downedHp??=clamp(finite(p.downedRemaining)*p.downedBleedRate,0,c.downed_hp);
      p.selfReviveReadyIn??=c.self_revive_quiet_seconds;
      p.downedGraceRemaining??=0;
      p.downedRemaining=p.downedHp/p.downedBleedRate;
    }else {p.downedHp=0;p.downedRemaining=0;p.selfReviveReadyIn=0;p.downedGraceRemaining=0;}
  }
  cancelRescueFor(p) {
    const rescuer=this.s.players[p.lockedBy];
    if(rescuer?.work?.kind==='Revive'&&rescuer.work.targetId===p.id)this.cancelWork(rescuer);
  }
  enterDowned(p) {
    if(p.lifeState!=='ALIVE')return;
    const c=this.c.player;
    this.cancelRescueFor(p);this.cancelWork(p);this.cancelFishing(p,'倒地，先救自己');
    if(p.downsDayIndex!==this.s.dayIndex){p.downsThisDay=0;p.downsDayIndex=this.s.dayIndex;}
    p.downsThisDay=(p.downsThisDay??0)+1;
    const seconds=Math.max(c.downed_min_seconds,c.downed_seconds-(p.downsThisDay-1)*c.downed_repeat_penalty);
    Object.assign(p,{lifeState:'DOWNED',hp:0,downedHp:c.downed_hp,downedBleedRate:c.downed_hp/seconds,downedRemaining:seconds,selfReviveReadyIn:c.self_revive_quiet_seconds,downedGraceRemaining:c.downed_grace_seconds,input:{},reload:null,meleePending:null,jumpQueued:false,sprinting:false,crouching:false,velocity:{x:0,y:0,z:0},moveSpeed:0,joinProtectionUntil:0});
    this.setAction(p,'downed',.4);this.event('LifeChanged',{state:'DOWNED'},p.id);this.requestSave=true;
  }
  rescueVisible(a,b) {
    if(Math.abs(a.y-b.y)>1.2)return false;
    const from={x:a.x,y:a.y+.85,z:a.z},to={x:b.x,y:b.y+.42,z:b.z};
    const length=Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z);
    return length<.01||!this.rayBlock(from,unit({x:to.x-from.x,y:to.y-from.y,z:to.z-from.z}),Math.max(0,length-.12));
  }
  startRescue(p,target,self=false) {
    requireThat(this.s.phase!=='COMPLETE','WRONG_PHASE');
    requireThat(this.inScene(p)&&this.inScene(target)&&target.lifeState==='DOWNED','INVALID_TARGET');
    this.migrateLife(target);
    requireThat(!p.swimming&&!target.swimming,'INVALID_TARGET');
    if(self){requireThat(p===target,'INVALID_TARGET');requireThat(target.selfReviveReadyIn<=0,'BUSY');}
    else {this.requireAction(p);requireThat(dist(p,target)<=this.c.player.interact_distance&&this.rescueVisible(p,target),'OUT_OF_RANGE');}
    requireThat(!p.work,'BUSY');
    if(!self&&target.work?.kind==='SelfRevive')this.cancelWork(target);
    this.beginWork(p,{kind:self?'SelfRevive':'Revive',targetId:target.id,duration:self?this.c.player.self_revive_seconds:this.c.player.revive_seconds,targetStartX:target.x,targetStartZ:target.z,targetHitSeq:target.hitSeq??0});
  }
  rescueHeld(p) {return p.input.interact===true&&this.s.time-p.inputAt<=.5;}
  rescueValid(p) {
    const work=p.work;if(!work||!['Revive','SelfRevive'].includes(work.kind))return false;
    const target=this.s.players[work.targetId],self=work.kind==='SelfRevive';
    return this.inScene(p)&&this.inScene(target)&&target.lifeState==='DOWNED'&&target.lockedBy===p.id&&
      (self?p===target&&target.selfReviveReadyIn<=0:live(p))&&!p.swimming&&!target.swimming&&
      dist(p,{x:work.startX,z:work.startZ})<=.25&&dist(target,{x:work.targetStartX,z:work.targetStartZ})<=.25&&
      (p.hitSeq??0)===work.startHitSeq&&(target.hitSeq??0)===work.targetHitSeq&&
      (this.rescueHeld(p)||this.s.time-work.startedAt<=.3)&&
      (self||dist(p,target)<=this.c.player.interact_distance&&this.rescueVisible(p,target));
  }
  updateDowned(p,dt) {
    this.migrateLife(p);
    const before={x:p.x,y:p.y,z:p.z},input=p.input,length=Math.hypot(input.dx??0,input.dz??0),scale=length>1?1/length:1;
    p.crouching=false;p.swimming=this.s.waterY-this.ground(p.x,p.z)>.6;
    this.move(p,(input.dx??0)*scale*this.c.player.crawl_speed,(input.dz??0)*scale*this.c.player.crawl_speed,dt,this.c.player.capsule_radius);
    const ground=this.ground(p.x,p.z);p.vy=Math.min(0,p.vy)-11*dt;p.y=Math.max(ground,p.y+p.vy*dt);if(p.y<=ground)p.vy=0;
    // Deep water still costs air; crawling is not a free way to breathe below the surface.
    if(this.s.waterY>p.y+.5){p.oxygen=Math.max(0,p.oxygen-dt);if(p.oxygen<=0)this.damageQueue.push({target:p.id,damage:this.c.player.drowning_dps*dt,actorId:'water'});}
    else p.oxygen=Math.min(this.c.player.oxygen_seconds,p.oxygen+dt*this.c.player.oxygen_seconds/2);
    p.velocity={x:(p.x-before.x)/dt,y:(p.y-before.y)/dt,z:(p.z-before.z)/dt};p.moveSpeed=Math.hypot(p.velocity.x,p.velocity.z);p.grounded=p.y<=ground+.05;p.jumpQueued=false;
    p.selfReviveReadyIn=Math.max(0,p.selfReviveReadyIn-dt);p.downedGraceRemaining=Math.max(0,p.downedGraceRemaining-dt);
    this.updateWork(p,dt);
  }
  updateLife(dt) {
    // Damage has already run. Validate all helpers after all movement, then bleed,
    // then finish aid: player iteration order cannot win a race against a lethal hit.
    for(const p of this.scenePlayers())if(p.work&&['Revive','SelfRevive'].includes(p.work.kind)&&!this.rescueValid(p))this.cancelWork(p);
    for(const p of this.scenePlayers())if(p.lifeState==='DOWNED'){
      this.migrateLife(p);const helper=this.s.players[p.lockedBy];
      if(!(helper?.work?.kind==='Revive'&&this.rescueValid(helper)&&this.rescueHeld(helper)))p.downedHp=Math.max(0,p.downedHp-p.downedBleedRate*dt);
      p.downedRemaining=p.downedHp/p.downedBleedRate;
      if(p.downedHp<=1e-8)this.die(p);
    }
    if(this.s.phase==='NIGHT'&&this.s.buildings.core.hp<=0)return;
    for(const p of this.scenePlayers()){
      const work=p.work;if(!work||!['Revive','SelfRevive'].includes(work.kind)||work.progress+1e-8<work.duration||!this.rescueValid(p)||!this.rescueHeld(p))continue;
      const target=this.s.players[work.targetId],self=work.kind==='SelfRevive';this.cancelWork(p);
      Object.assign(target,{lifeState:'ALIVE',hp:self?this.c.player.self_revive_hp:this.c.player.revive_hp,downedHp:0,downedRemaining:0,downedGraceRemaining:0,selfReviveReadyIn:0,revivesUsed:(target.revivesUsed??0)+1,input:{},jumpQueued:false});
      this.setAction(target,'revived',.45);this.event('LifeChanged',{state:'ALIVE',rescuerId:p.id,selfRescue:self},target.id);this.requestSave=true;
    }
  }
  createWorld() {
    const c=this.c;
    const s = { schema:3, worldId:randomUUID(), contentVersion:c.content_version, nextId:1, tick:0, time:0, phase:'PREP', phaseElapsed:0, dayIndex:1, threatStage:1, lockedPlayerCount:1, waterY:c.cycle.low_water_y, paused:true, hostId:null, friendlyFire:false,
      rng:{fish:c.cycle.seed_default>>>0,world:(c.cycle.seed_default+17)>>>0,combat:(c.cycle.seed_default+73)>>>0,loss:(c.cycle.seed_default+119)>>>0}, nextPlayerSlotId:1,players:{}, items:{}, containers:{}, buildings:{}, enemies:{}, projectiles:{}, nodes:{}, pools:{}, recovery:null,
      bank:{credits:0,materials:0,reservedCredits:0,reservedMaterials:0,revision:1}, night:{id:null,waveIndex:0,pending:[],spawned:0,remaining:0,bossId:null,addsSpawned:false,nextSpawnAt:0,resolved:false}, statistics:{daysSurvived:0,fishLanded:0,kills:0,shotsFired:0,deaths:0,breaches:0}, resultLedger:[] };
    s.containers.storage={id:'storage',type:'storage',slotLimit:c.economy.storage_slots,itemIds:[],x:3.5,y:this.ground(3.5,-2),z:-2,revision:1};
    const slots=[{id:'core',kind:'core',x:0,z:0,yaw:0},...BUILDING_SLOTS];
    for(const slot of slots) { const def=this.defs.buildings[slot.kind]; s.buildings[slot.id]={id:slot.id,socketId:slot.id,definitionId:slot.kind,x:slot.x,y:this.ground(slot.x,slot.z),z:slot.z,yaw:slot.yaw,level:1,hp:def.hp,maxHp:def.hp,gateOpen:slot.kind==='gate',revision:1}; }
    for(const pool of PONDS) s.pools[pool.id]={...pool,type:pool.id,y:0,quota:0};
    return s;
  }
  id(prefix) { return `${prefix}-${this.s.nextId++}`; }
  ground(x,z) { const {extent,width,values}=this.terrainCache,ix=Math.floor((x+extent)/TERRAIN_GRID),iz=Math.floor((z+extent)/TERRAIN_GRID);if(ix<0||iz<0||ix>=width-1||iz>=width-1)return terrainHeight(x,z,this.terrainConfig);const fx=(x+extent)/TERRAIN_GRID-ix,fz=(z+extent)/TERRAIN_GRID-iz,index=iz*width+ix,a=values[index],b=values[index+1],c=values[index+width],d=values[index+width+1];return fx+fz<=1?a+(b-a)*fx+(c-a)*fz:d+(c-d)*(1-fx)+(b-d)*(1-fz); }
  rng(stream) { let x=(this.s.rng[stream]??(this.c.cycle.seed_default+[...stream].reduce((n,c)=>n+c.charCodeAt(0)*31,0)))>>>0; x^=x<<13;x^=x>>>17;x^=x<<5;this.s.rng[stream]=x>>>0;return (x>>>0)/4294967296; }
  event(eventType,payload={},entityId=null) { this.events.push({type:'event',eventId:this.id('event'),serverTick:this.s.tick,eventType,...(entityId?{entityId}:{}),payload}); if(this.events.length>1024)this.events.shift();if(this.mode==='mission')missionEvent(this,eventType,payload,entityId); }
  setAction(p,action,duration=0,extra={}) { p.action=action;p.actionSeq=(p.actionSeq??0)+1;p.actionStartedAt=this.s.time;p.actionDuration=duration;this.event('Action',{actorId:p.id,action,actionSeq:p.actionSeq,startedAt:this.s.time,duration,definitionId:this.equipped(p)?.definitionId??null,weaponId:this.equipped(p,'weapon')?.definitionId??null,...extra},p.id); }
  joinSpawn(slotId) {
    const base=['NIGHT','RECOVERY'].includes(this.s.phase)||this.s.buildings.core.hp<=0?this.location('emergency'):this.staticWorld().spawn;
    const offsets=[[0,0],[-1.2,0],[1.2,0],[0,1.2],[-1.2,1.2],[1.2,1.2],[-2.4,0],[-2.4,1.2],[2.4,0],[2.4,1.2]];
    for(let radius=0;radius<=3;radius++)for(let i=0;i<offsets.length;i++){const [dx,dz]=offsets[(slotId-1+i)%offsets.length],x=base.x+dx,z=base.z+dz-radius*1.2,y=this.ground(x,z);if(this.s.waterY-y<=.6&&!this.blocked(x,y,z,this.c.player.capsule_radius)&&!Object.values(this.s.players).some(p=>(!this.onlineRoster||p.connected)&&p.lifeState!=='DEAD_WAIT'&&Math.hypot(p.x-x,p.z-z)<1))return {x,y,z};}
    throw new GameError('NO_CAPACITY');
  }
  propBox(prop) { const sine=Math.abs(Math.sin(prop.yaw)),cosine=Math.abs(Math.cos(prop.yaw)),width=prop.size.x*cosine+prop.size.z*sine,depth=prop.size.x*sine+prop.size.z*cosine;return {id:prop.id,x0:prop.x-width/2,x1:prop.x+width/2,z0:prop.z-depth/2,z1:prop.z+depth/2,y0:footprintBase(prop.x,prop.y,prop.z,width,depth,(x,z)=>this.ground(x,z)),y1:prop.y+prop.size.y}; }
  cachedPropBox(prop) {
    let cached=this.colliderCache.get(prop);
    if(!cached||cached.x!==prop.x||cached.y!==prop.y||cached.z!==prop.z||cached.yaw!==prop.yaw||cached.sx!==prop.size.x||cached.sy!==prop.size.y||cached.sz!==prop.size.z){cached={x:prop.x,y:prop.y,z:prop.z,yaw:prop.yaw,sx:prop.size.x,sy:prop.size.y,sz:prop.size.z,box:this.propBox(prop)};this.colliderCache.set(prop,cached);}
    return cached.box;
  }
  propSolidBoxes(prop) {
    const bounds=this.cachedPropBox(prop);
    const cached=this.colliderCache.get(prop);
    if(cached.solids)return cached.solids;
    if(!['barrel','barricade'].includes(prop.kind))return cached.solids=[bounds];
    const {x:w,y:h,z:d}=prop.size,angle=prop.yaw??0,cos=Math.cos(angle),sin=Math.sin(angle),parts=[];
    // Keep the visible terrain support solid, then match the actual barrel or
    // thin board silhouette instead of using its entire empty bounding box.
    if(bounds.y0<prop.y)parts.push({...bounds,y1:prop.y});
    const add=(x,z,width,depth,low,high)=>{
      const centerX=prop.x+x*cos+z*sin,centerZ=prop.z-x*sin+z*cos;
      const extentX=Math.abs(cos)*width+Math.abs(sin)*depth,extentZ=Math.abs(sin)*width+Math.abs(cos)*depth;
      parts.push({id:prop.id,x0:centerX-extentX/2,x1:centerX+extentX/2,z0:centerZ-extentZ/2,z1:centerZ+extentZ/2,y0:prop.y+low,y1:prop.y+high});
    };
    if(prop.kind==='barrel'){
      add(0,0,w*.84,d*.84,0,h);
      add(0,0,w,d*.68,0,h);
      add(0,0,w*.68,d,0,h);
    }else{
      add(0,0,w,d*.4,h*.12,h*.94);
      for(const side of [-1,1]){
        add(side*w*.38,0,w*.09,d*.52,0,h);
        add(side*w*.38,0,w*.22,d,0,h*.14);
      }
    }
    return cached.solids=parts;
  }
  generateDestructibles() {
    this.s.destructibles={};const types=this.c.destructibles.types,archive=types.find(type=>type.id==='archive_cabinet'),ordinary=types.filter(type=>type.id!=='archive_cabinet');
    // A new day can begin while teammates are already outside the camp.
    // Reserve their footprints, including downed players and retained fish,
    // so new solid scenery cannot appear around an existing body.
    const occupied=[...this.scenePlayers().filter(p=>p.lifeState!=='DEAD_WAIT').map(p=>({x:p.x,z:p.z,radius:this.c.player.capsule_radius})),...Object.values(this.s.enemies).filter(e=>e.hp>0).map(e=>({x:e.x,z:e.z,radius:e.radius??.45}))];
    const create=(definition,point,extra={})=>{const prop={id:this.id('prop'),kind:definition.id,material:definition.material,...point,yaw:this.rng('props')<.5?0:Math.PI/2,hp:definition.hp,maxHp:definition.hp,size:{...definition.size},radius:Math.hypot(definition.size.x,definition.size.z)/2,revision:1,broken:false,seed:Math.floor(this.rng('props')*2147483647),...extra};this.s.destructibles[prop.id]=prop;return prop;};
    const zones=this.dangerZones();
    for(let i=0;i<archive.count;i++){
      const zone=zones[i%zones.length],point=this.choosePoint(zone,Math.min(16,zone.radius??16),[...Object.values(this.s.destructibles),...occupied],3.5,16,'props',this.c.cycle.low_water_y);
      create(archive,point,{zoneId:zone.id,opened:false,resolution:null,lootContainerId:null});
    }
    let ordinaryIndex=0;
    for(const definition of ordinary)for(let count=0;count<definition.count;count++){
      const i=ordinaryIndex++,footprint=Math.hypot(definition.size.x,definition.size.z)/2;let point=null;
      for(let attempt=0;attempt<120;attempt++){const angle=(i%4)*Math.PI/2+(this.rng('props')-.5)*.55,radius=i<12?20+this.rng('props')*18:54+this.rng('props')*38,x=Math.sin(angle)*radius,z=Math.cos(angle)*radius,y=this.ground(x,z);if(this.c.cycle.low_water_y-y>=0||Math.hypot(x,z)<16||this.blocked(x,y,z,1.6)||Object.values(this.s.destructibles).some(prop=>Math.hypot(prop.x-x,prop.z-z)<3.5)||occupied.some(actor=>Math.hypot(actor.x-x,actor.z-z)<footprint+Math.SQRT2*actor.radius+.1))continue;point={x,y,z};break;}
      if(!point)point=this.choosePoint(this.location(i%2?'salvage':'supply'),22,[...Object.values(this.s.destructibles),...occupied],3.5,16,'props',this.c.cycle.low_water_y);
      create(definition,point);
    }
  }
  propMaterial(prop) { return prop?.material??(['barrel','archive_cabinet','equipment'].includes(prop?.kind)?'metal':'wood'); }
  resolveArchiveLoot(prop,resolution,actorId=null) {
    if(prop.kind!=='archive_cabinet'||prop.resolution)return prop.lootContainerId?this.s.containers[prop.lootContainerId]??null:null;
    const config=this.c.destructibles.archive,table=resolution==='searched'?config.searched_rewards:config.smashed_rewards,index=resolution==='searched'?prop.seed%table.length:(prop.seed%10<7?0:Math.min(1,table.length-1)),rewards=table[index];
    const forward={x:-Math.sin(prop.yaw),z:-Math.cos(prop.yaw)},x=prop.x+forward.x*.9,z=prop.z+forward.z*.9,y=this.ground(x,z),container=this.createContainer('loot',Math.max(2,rewards.length),{x,y,z,source:'archive',createdDay:this.s.dayIndex,expiresAfterDay:this.s.dayIndex+this.c.recovery.bag_retention_days});
    for(const reward of rewards)this.addItems(container,reward.definitionId,reward.quantity);
    this.containerContent(container);Object.assign(prop,{resolution,opened:resolution==='searched',lootContainerId:container.id});prop.revision++;
    if(resolution==='searched')this.event('ArchiveOpened',{targetId:prop.id,actorId,position:{x:prop.x,y:prop.y,z:prop.z},seed:prop.seed,resolution,lootContainerId:container.id},prop.id);
    this.requestSave=true;return container;
  }
  breakProp(prop,hit) {
    if(this.navGeometry)this.navGeometry.tick=-1;
    if(prop.broken)return;
    const worker=this.s.players[prop.lockedBy];if(worker?.work?.targetId===prop.id)this.cancelWork(worker);delete prop.lockedBy;
    if(prop.kind==='archive_cabinet'){
      const actor=this.s.players[hit.actorId];if(actor&&!['pistol','smg','carbine','lmg','shotgun','rifle'].includes(hit.weaponId))this.alertNoise(actor,'archive_break');
      this.resolveArchiveLoot(prop,'smashed',hit.actorId);prop.broken=true;prop.hp=0;prop.revision++;
      this.event('Destroyed',{targetId:prop.id,kind:prop.kind,material:this.propMaterial(prop),position:{x:prop.x,y:prop.y,z:prop.z},seed:prop.seed,resolution:prop.resolution,lootContainerId:prop.lootContainerId??null,actorId:hit.actorId,weaponId:hit.weaponId??null,shotId:hit.shotId??null},prop.id);this.requestSave=true;return;
    }
    prop.broken=true;prop.hp=0;prop.revision++;const container=this.createContainer('loot',2,{x:prop.x,y:prop.y,z:prop.z,createdDay:this.s.dayIndex,expiresAfterDay:this.s.dayIndex+this.c.recovery.bag_retention_days});
    const definitionId=prop.seed%20===0?'treasure':prop.seed%7===0?'ammo_light':'scrap',quantity=definitionId==='treasure'?1:definitionId==='ammo_light'?3:1+prop.seed%2;this.createItem(definitionId,quantity,container);prop.lootContainerId=container.id;
    this.event('Destroyed',{targetId:prop.id,kind:prop.kind,material:this.propMaterial(prop),position:{x:prop.x,y:prop.y,z:prop.z},seed:prop.seed,lootContainerId:container.id,actorId:hit.actorId,weaponId:hit.weaponId??null,shotId:hit.shotId??null},prop.id);this.requestSave=true;
  }
  drainEvents() { const events=this.events;this.events=[];return events; }
  location(id) { return this.c.level.locations.find(x=>x.id===id); }
  staticWorld() { const l=this.c.level,terminals=l.terminals.map(t=>({...t,y:this.ground(t.x,t.z)}));
    if(this.mode==='mission')for(const [kind,ids,z] of [['weapon',['pistol','smg','carbine','shotgun','rifle','lmg'],14],['rod',['rod_basic','rod_light','rod_pro','rod_heavy','rod_magnet'],20]])for(let i=0;i<ids.length;i++){
      const definitionId=ids[i],x=(i-(ids.length-1)/2)*3;
      terminals.push({id:`training_${definitionId}`,type:'training',kind,definitionId,label:this.defs.items[definitionId].name,x,y:this.ground(x,z),z});
    }
    const spawn=this.mode==='mission'&&this.s.mission?.freePlay?{x:0,y:this.ground(0,9),z:9}:{x:1.5,y:this.ground(1.5,3.7),z:3.7};
    return {boundaryRadius:l.boundary_radius,mainlandRadius:l.mainland_radius,mainlandHeight:l.mainland_height,outerHeight:l.outer_height,terminals,spawn,emergency:this.location('emergency')}; }
  clearNewStationContainers() {
    // Preserve legacy ground loot when a new workbench occupies its old position.
    const added=this.staticWorld().terminals.filter(t=>['upgrade','recycle'].includes(t.type));
    for(const box of Object.values(this.s.containers)) {
      if(!Number.isFinite(box.x)||box.type==='storage'||!added.some(t=>Math.abs(box.x-t.x)<1.13&&Math.abs(box.z-t.z)<.8&&Math.abs(box.y-t.y)<1.1))continue;
      let point=null;
      for(let r=1;r<=6&&!point;r+=.5)for(let i=0;i<24&&!point;i++) {
        const x=box.x+Math.sin(i*Math.PI/12)*r,z=box.z+Math.cos(i*Math.PI/12)*r,y=this.ground(x,z);
        if(Math.abs(y-box.y)<=1&&!this.blocked(x,y,z,.4))point={x,y,z};
      }
      if(point){Object.assign(box,point);box.revision++;this.requestSave=true;}
    }
    const overlaps=(p,r)=>added.some(t=>Math.abs(p.x-t.x)<.825+r&&Math.abs(p.z-t.z)<.5+r&&Math.abs(p.y-t.y)<1.1);
    for(const enemy of Object.values(this.s.enemies)) {
      const radius=enemy.radius??.45;
      if(enemy.hp<=0||!overlaps(enemy,radius))continue;
      let point=null;
      for(let r=.5;r<=8&&!point;r+=.5)for(let i=0;i<32&&!point;i++) {
        const x=enemy.x+Math.sin(i*Math.PI/16)*r,z=enemy.z+Math.cos(i*Math.PI/16)*r,y=this.ground(x,z);
        if(Math.abs(y-enemy.y)<=1&&!this.blocked(x,y,z,radius)&&!Object.values(this.s.enemies).some(other=>other!==enemy&&other.hp>0&&Math.hypot(other.x-x,other.z-z)<radius+(other.radius??.45)))point={x,y,z};
      }
      if(!point)continue;
      const homeMoved=overlaps({x:enemy.homeX,y:this.ground(enemy.homeX,enemy.homeZ),z:enemy.homeZ},radius);
      Object.assign(enemy,point);enemy.revision++;this.requestSave=true;
      if(homeMoved){enemy.homeX=point.x;enemy.homeZ=point.z;}
      if(['WINDUP','CHARGE','burrow_windup'].includes(enemy.state)){enemy.state='RECOVER';enemy.phaseRemaining=Math.max(enemy.phaseRemaining??0,.5);enemy.weak=false;}
      enemy.attackZone=null;enemy.chargeRemaining=0;enemy.chargeHit=[];enemy.targetId=null;
      for(const key of ['lockX','lockY','lockZ','rescuePosition','hitVelocity'])delete enemy[key];
      enemy.stuckTime=0;enemy.patrolBlocked=0;
      const aggro=this.s.enemyAggro?.[enemy.id];
      if(aggro){aggro.targetId=null;delete aggro.seenX;delete aggro.seenZ;aggro.seenAt=-100;aggro.scanAt=0;if(homeMoved)aggro.returning=false;}
    }
  }
  catalog() { return {items:this.c.items,weapons:this.c.weapons,rods:this.c.rods,buildings:this.c.buildings,destructibles:this.c.destructibles,fortress:this.c.fortress,fishing:this.c.fishing,player:this.c.player,cycle:this.c.cycle,construction:this.c.construction,recovery:this.c.recovery,weaponUpgrade:this.c.weapon_upgrade,melee:this.c.melee,unarmed:this.c.unarmed??UNARMED_DEFAULTS}; }
  dangerZones() { return this.c.encounters.danger_zones.map(zone=>({...zone,...this.location(zone.id)})); }
  nearestZone(point) { return this.dangerZones().sort((a,b)=>dist(point,a)-dist(point,b))[0]; }
  containerContent(container) { const hasContent=container.itemIds.length>0||(container.recoverableC??0)>0||(container.recoverableM??0)>0;container.hasContent=hasContent;container.state=hasContent?'available':'depleted';return hasContent; }
  migrateCoreState() {
    const legacyRecovery=this.s.phase==='RECOVERY'&&this.s.recovery&&!Number.isFinite(this.s.recovery.duration);
    this.s.failureStreak??=0;
    this.s.pressureDay=Math.max(1,(this.s.statistics.daysSurvived??0)+1);this.s.turrets??={};
    for(const slot of this.c.fortress.slots)this.s.turrets[slot.id]??={...slot,y:this.ground(slot.x,slot.z),definitionId:'fortress_turret',faction:'camp',level:0,hp:0,maxHp:0,ammo:0,capacity:0,yaw:0,targetId:null,shotSeq:0,fireAt:0,revision:1};
    this.s.night.playerCount??=this.s.lockedPlayerCount;this.s.night.pressureDay??=this.s.pressureDay;
    const pressure=this.nightPressure(this.s.night.playerCount);this.s.night.aliveCap??=pressure.alive_cap;this.s.night.spawnInterval??=pressure.spawn_interval;
    if(this.s.phase==='RECOVERY'&&this.s.recovery&&!Number.isFinite(this.s.recovery.duration)){this.s.recovery.clockOffset=this.s.phaseElapsed;this.s.recovery.duration=this.s.phaseElapsed+this.recoveryDuration();}
    for(const container of Object.values(this.s.containers))this.containerContent(container);
    for(const enemy of Object.values(this.s.enemies)){enemy.source??=enemy.night?'night':enemy.landed?'fishing':'wild';enemy.ownerId??=null;if(enemy.source==='wild')enemy.zoneId??=this.nearestZone(enemy)?.id??null;enemy.alertState??='patrol';enemy.patrolIndex??=0;}
    for(const node of Object.values(this.s.nodes)){const zone=this.nearestZone(node);node.zoneId??=zone?.id??null;node.danger??=!!zone&&dist(node,zone)<=zone.radius;}
    // Old recovery saves had no active guards. Populate the newly active daytime
    // once, retaining every existing search node and collected/depleted state.
    if(legacyRecovery&&!Object.values(this.s.enemies).some(e=>e.source==='wild')){
      const n=Math.max(1,this.s.lockedPlayerCount),zones=this.dangerZones(),used=Object.values(this.s.enemies);
      for(const type of ['crab','eel'])for(let i=0;i<this.c.encounters[`wild_${type}_per_player`]*n;i++){
        const center=zones[i%zones.length],point=this.choosePoint(center,n>4?22:14,used,8,45,'wildlife');used.push(point);
        const enemy=this.spawnEnemy(type,point.x,point.z);enemy.zoneId=center.id;
      }
      this.requestSave=true;
    }
    for(const p of Object.values(this.s.players))p.quickItemDefinitionId=typeof p.quickItemDefinitionId==='string'&&(p.quickItemDefinitionId==='bandage'||this.c.director?.tools[p.quickItemDefinitionId])?p.quickItemDefinitionId:null;
    for(const p of Object.values(this.s.players))if(p.fishing){p.fishing.source='sea';p.fishing.power??=1;p.fishing.y=this.s.waterY;}
    for(const pool of Object.values(this.s.pools))pool.unlimited=true;
    if(!Number.isFinite(this.s.calendar?.minutes)){const start={PREP:360,DAY:480,RETURN:1080,NIGHT:1200,RECOVERY:360,COMPLETE:360}[this.s.phase],elapsed=this.s.phaseElapsed-(this.s.phase==='RECOVERY'?(this.s.recovery?.clockOffset??0):0);this.s.calendar={minutes:(this.s.dayIndex-1)*1440+start+this.clockRate()*elapsed};}
  }
  recoveryDuration() { return Math.min(this.c.recovery.max_day_seconds,this.c.recovery.day_seconds+Math.max(0,(this.s.failureStreak??1)-1)*this.c.recovery.streak_extra_seconds); }
  nightPressure(count) { return this.c.encounters.night_pressure.find(row=>count<=row.players)??this.c.encounters.night_pressure.at(-1); }
  difficultyFor(count,pressureDay=Math.max(1,this.s.statistics.daysSurvived+1)) { const c=this.c.encounters.nightly_boss,row=this.nightPressure(count);return {pressureDay,nightPlayers:count,aliveCap:Math.min(row.alive_cap,this.c.encounters.night_alive_cap),spawnInterval:row.spawn_interval,bossHp:Math.ceil(c.base_hp*Math.min(c.hp_growth_cap,1+c.hp_daily_growth*(pressureDay-1))*(1+this.c.waves[3].boss_hp_player_factor*(count-1)))}; }
  publicDifficulty() { const n=this.s.night;if(this.s.phase==='NIGHT')return {scope:'locked',pressureDay:n.pressureDay,nightPlayers:n.playerCount,aliveCap:n.aliveCap,spawnInterval:n.spawnInterval,bossHp:n.bossHp??this.s.enemies[n.bossId]?.maxHp??null};return {scope:'next',...this.difficultyFor(Math.max(1,Object.values(this.s.players).filter(p=>p.connected).length))}; }
  clockRate() { const c=this.c.cycle;return {PREP:120/this.phaseDuration('PREP'),DAY:600/this.phaseDuration('DAY'),RETURN:120/this.phaseDuration('RETURN'),NIGHT:600/this.phaseDuration('NIGHT'),RECOVERY:720/((this.s.recovery?.duration??this.recoveryDuration())-(this.s.recovery?.clockOffset??0))}[this.s.phase]??0; }
  alignClock(phase) { if(!this.s.calendar||phase==='RECOVERY'||phase==='COMPLETE')return;const minute={PREP:360,DAY:480,RETURN:1080,NIGHT:1200}[phase],current=this.s.calendar.minutes%1440,delta=(minute-current+1440)%1440;if(delta<1435)this.s.calendar.minutes+=delta; }
  publicClock() { const minutes=this.s.calendar.minutes,dayMinutes=((minutes%1440)+1440)%1440,hour=dayMinutes/60;return {day:Math.floor(minutes/1440)+1,hour:Math.floor(hour),minute:Math.floor(dayMinutes%60),period:hour>=5&&hour<8?'dawn':hour>=8&&hour<18?'day':hour>=18&&hour<20?'dusk':'night',progress:dayMinutes/1440,protected:this.s.phase==='RECOVERY'}; }
  createContainer(type,slots,extra={}) { const value={id:this.id('container'),type,slotLimit:slots,itemIds:[],revision:1,...extra};this.s.containers[value.id]=value;return value; }
  createItem(definitionId,quantity,container,extra={}) { const def=this.defs.items[definitionId]; requireThat(def&&quantity>0&&quantity<=def.stack,'INVALID_TARGET');requireThat(container.itemIds.length<container.slotLimit,'NO_CAPACITY');const item={id:this.id('item'),definitionId,quantity,level:1,magazineAmmo:0,containerId:container.id,revision:1,...extra};this.s.items[item.id]=item;container.itemIds.push(item.id);container.revision++;return item; }
  removeItem(item) { const container=this.s.containers[item.containerId];if(container){container.itemIds=container.itemIds.filter(id=>id!==item.id);container.revision++;}delete this.s.items[item.id]; }
  moveItem(item,to,quantity=item.quantity) {
    const from=this.s.containers[item.containerId],def=this.defs.items[item.definitionId];
    if(from.id===to.id)return 0;
    requireThat(!item.lockedBy,'BUSY');
    requireThat(!item.loanOwnerSlotId||to.ownerSlotId===item.loanOwnerSlotId,'INVALID_TARGET');
    if(to.type.startsWith('equip_')) { requireThat(def.kind===to.type.slice(6),'INVALID_TARGET');requireThat(to.itemIds.length===0,'NO_CAPACITY'); }
    let remaining=Math.min(item.quantity,Math.max(1,Math.floor(finite(quantity,item.quantity)))),moved=0;
    for(const id of to.itemIds) { const stack=this.s.items[id];if(stack.definitionId!==item.definitionId||def.stack===1||stack.loanOwnerSlotId!==item.loanOwnerSlotId||stack.lockedBy)continue;const count=Math.min(remaining,def.stack-stack.quantity);stack.quantity+=count;stack.revision++;remaining-=count;item.quantity-=count;moved+=count;if(!remaining)break; }
    if(remaining&&to.itemIds.length<to.slotLimit) {
      if(remaining===item.quantity){from.itemIds=from.itemIds.filter(id=>id!==item.id);to.itemIds.push(item.id);item.containerId=to.id;item.revision++;moved+=remaining;remaining=0;}
      else {const count=remaining;item.quantity-=count;this.createItem(item.definitionId,count,to,{level:item.level,magazineAmmo:item.magazineAmmo,...(item.loanOwnerSlotId?{loanOwnerSlotId:item.loanOwnerSlotId}:{})});moved+=count;remaining=0;}
    }
    if(item.quantity===0)this.removeItem(item);else item.revision++;
    if(moved){from.revision++;to.revision++;this.event('InventoryChanged',{from:from.id,to:to.id,moved});}
    return moved;
  }
  canFit(container,definitionId,quantity=1) { const def=this.defs.items[definitionId]; let room=(container.slotLimit-container.itemIds.length)*def.stack;for(const id of container.itemIds){const item=this.s.items[id];if(item.definitionId===definitionId&&!item.lockedBy&&!item.loanOwnerSlotId)room+=def.stack-item.quantity;}return room>=quantity; }
  addItems(container,definitionId,quantity) { const def=this.defs.items[definitionId];requireThat(this.canFit(container,definitionId,quantity),'NO_CAPACITY');for(const id of container.itemIds){const item=this.s.items[id];if(item.definitionId!==definitionId||item.lockedBy||item.loanOwnerSlotId)continue;const n=Math.min(quantity,def.stack-item.quantity);item.quantity+=n;item.revision++;quantity-=n;}while(quantity>0){const n=Math.min(quantity,def.stack);this.createItem(definitionId,n,container);quantity-=n;}container.revision++; }
  bag(p) { return this.s.containers[p.backpackId]; }
  quickItem(p) { return this.bag(p).itemIds.map(id=>this.s.items[id]).find(item=>item&&item.definitionId===p.quickItemDefinitionId&&item.quantity>0&&!item.lockedBy); }
  equipped(p,slot=p.heldSlot) { return slot==='quick'?this.quickItem(p):this.s.items[this.s.containers[p.equipment[slot]]?.itemIds[0]]; }
  bindQuick(p,{itemId}) {
    requireThat(itemId===null||typeof itemId==='string','INVALID_TARGET');
    const item=itemId?this.s.items[itemId]:null;
    if(itemId!==null)requireThat(item&&item.containerId===p.backpackId&&!item.lockedBy&&(item.definitionId==='bandage'||!!this.c.director?.tools[item.definitionId]),'INVALID_TARGET');
    requireThat(!p.work&&!p.reload&&!p.fishing&&!p.meleePending,'BUSY');
    p.quickItemDefinitionId=item?.definitionId??null;
    if(p.heldSlot==='quick'){p.equipUntil=this.s.time+.35;this.setAction(p,'equip',.35);}
  }
  useQuick(p,targetId,payload) {
    requireThat(p.heldSlot==='quick'&&!p.work&&!p.reload&&!p.fishing&&!p.meleePending&&this.s.time>=p.equipUntil&&this.s.time>=(p.quickUseUntil??0),'BUSY');
    const item=this.quickItem(p);requireThat(item,'NO_AMMO');
    const id=item.definitionId;
    if(id==='bandage')return this.dispatch(p,{command:'UseBandage'});
    requireThat(this.director&&this.c.director.tools[id],'INVALID_TARGET');
    this.director.player(p);this.director.useTool(p,{...payload,definitionId:id,targetId});
    p.quickUseDefinitionId=id;p.quickUseUntil=this.s.time+.65;this.setAction(p,'tool',.65,{definitionId:id});
  }
  count(p,definitionId) { return this.bag(p).itemIds.reduce((n,id)=>n+(this.s.items[id].definitionId===definitionId&&!this.s.items[id].lockedBy?this.s.items[id].quantity:0),0); }
  consume(p,definitionId,quantity) { requireThat(this.count(p,definitionId)>=quantity,'NO_AMMO');for(const id of [...this.bag(p).itemIds]){const item=this.s.items[id];if(item.definitionId!==definitionId||item.lockedBy)continue;const n=Math.min(item.quantity,quantity);item.quantity-=n;item.revision++;quantity-=n;if(!item.quantity)this.removeItem(item);if(!quantity)break;} }
  allocate(name,tokenHash) {
    requireThat(this.s.phase!=='COMPLETE','WRONG_PHASE');requireThat(Object.values(this.s.players).filter(p=>!this.onlineRoster||p.connected).length<this.c.baseline.max_players,'ROOM_FULL');
    const slotId=this.s.nextPlayerSlotId,id=`player-${slotId}`;requireThat(Number.isSafeInteger(slotId)&&slotId>0&&slotId<Number.MAX_SAFE_INTEGER&&!this.s.players[id],'ROOM_FULL');const spawn=this.joinSpawn(slotId);this.s.nextPlayerSlotId=slotId+1;
    const memberGeneration=typeof tokenHash==='string'&&tokenHash.startsWith('account:')?(this.s.memberResetEpochs?.[tokenHash.slice(8)]??0):0;
    const bag=this.createContainer('backpack',this.c.player.backpack_slots,{ownerSlotId:slotId}),equipment={};
    for(const slot of ['weapon','rod','melee'])equipment[slot]=this.createContainer(`equip_${slot}`,1,{ownerSlotId:slotId}).id;
    const p={id,slotId,name,tokenHash,memberGeneration,connected:true,ready:false,lifeState:'ALIVE',...spawn,yaw:0,pitch:0,hp:this.c.player.max_hp,stamina:this.c.player.stamina_max,oxygen:this.c.player.oxygen_seconds,swimming:false,crouching:false,sprinting:false,inputAck:0,input:{},inputAt:-100,respawnRemaining:0,downedRemaining:0,downedHp:0,downedBleedRate:this.c.player.downed_hp/this.c.player.downed_seconds,selfReviveReadyIn:0,downedGraceRemaining:0,downsThisDay:0,downsDayIndex:this.s.dayIndex,revivesUsed:0,heldSlot:'weapon',quickItemDefinitionId:null,equipment,backpackId:bag.id,requestHighWater:0,requestCache:[],reload:null,work:null,fishing:null,vy:0,damageAt:-100,staminaUsedAt:-100,equipUntil:0,fireAt:0,meleeAt:0,disconnectedAt:null};
    Object.assign(p,{velocity:{x:0,y:0,z:0},moveSpeed:0,grounded:true,action:'idle',actionSeq:0,actionStartedAt:this.s.time,actionDuration:0,joinProtectionUntil:this.s.time+3,lastProtectionAt:this.s.time});this.s.players[id]=p;
    if(memberGeneration>0){
      for(const definitionId of this.c.economy.free_recovery_tools){const def=this.defs.items[definitionId];this.createItem(definitionId,1,this.s.containers[equipment[def.kind]],{loanOwnerSlotId:slotId});}
      p.heldSlot='rod';
    }else{
      for(const definitionId of this.c.economy.start_loadout){const def=this.defs.items[definitionId];this.createItem(definitionId,1,this.s.containers[equipment[def.kind]],{magazineAmmo:this.defs.weapons[definitionId]?.magazine??0});}
      const initialMag=this.defs.weapons.carbine.magazine;
      this.addItems(bag,'ammo_light',Math.max(0,this.c.economy.start_ammo_light-initialMag));this.addItems(bag,'bandage',this.c.economy.start_bandages);
      this.s.bank.credits+=this.c.economy.start_c_per_player;this.s.bank.materials+=this.c.economy.start_m_per_player;this.s.bank.revision++;
    }
    if(!this.s.hostId)this.s.hostId=id;this.s.paused=false;this.requestSave=true;if(this.mode==='mission')placeForStage(this,p);this.event('Spawned',{kind:'player',id,position:{x:p.x,y:p.y,z:p.z},joinProtectionSeconds:3});if(this.mode!=='mission'&&['DAY','RETURN','NIGHT'].includes(this.s.phase))this.event('Notice',{code:'JOIN_NEXT_DAY_SCALING',actorId:id,message:'队友已加入！下个白天补充物资，夜晚调整敌人',lockedPlayerCount:this.s.lockedPlayerCount,nightPlayerCount:this.s.night.playerCount});return p;
  }
  connect(p,name) { const disconnected=!p.connected;p.connected=true;p.disconnectedAt=null;p.name=name;p.input={};p.inputAt=-100;p.velocity={x:0,y:0,z:0};p.moveSpeed=0;if(!this.s.hostId)this.s.hostId=p.id;this.s.paused=false;this.migrateLife(p);if(p.lifeState==='DEAD_WAIT'&&p.respawnRemaining<=0&&!['NIGHT','COMPLETE'].includes(this.s.phase))this.respawn(p);this.applyPlayerClearance(this.planPlayerClearance([p]));if(disconnected&&live(p)&&this.s.phase!=='COMPLETE'&&this.s.time-(p.lastProtectionAt??-100)>=30){p.joinProtectionUntil=this.s.time+3;p.lastProtectionAt=this.s.time;} }
  disconnect(p) { this.cancelRescueFor(p);p.connected=false;p.input={};p.disconnectedAt=this.onlineRoster?null:this.s.time;this.cancelWork(p);this.cancelFishing(p,'连接中断');if(this.onlineRoster){p.reload=null;p.meleePending=null;p.jumpQueued=false;p.velocity={x:0,y:0,z:0};p.moveSpeed=0;p.action='idle';p.actionDuration=0;}if(this.s.hostId===p.id)this.s.hostId=Object.values(this.s.players).find(x=>x.connected)?.id??null;this.s.paused=!Object.values(this.s.players).some(x=>x.connected);this.requestSave=true; }
  input(p,data) {
    if(!Number.isSafeInteger(data.seq)||data.seq<=p.inputAck)return;
    p.inputAck=data.seq;p.inputAt=this.s.time;
    const previous=p.input;p.input={dx:clamp(finite(data.dx),-1,1),dz:clamp(finite(data.dz),-1,1),yaw:finite(data.yaw,p.yaw),pitch:clamp(finite(data.pitch,p.pitch),-1.48,1.48)};
    for(const key of ['sprint','crouch','jump','fire','ads','reel','interact'])p.input[key]=data[key]===true;
    if(p.input.ads&&!previous.ads)p.adsSince=this.s.time;
    p.jumpQueued=p.input.jump&&!previous.jump;p.yaw=p.input.yaw;p.pitch=p.input.pitch;
  }
  carriedContainer(p,id) { return id===p.backpackId||Object.values(p.equipment).includes(id); }
  own(p,item) { return !!item&&this.carriedContainer(p,item.containerId)&&this.s.containers[item.containerId]?.itemIds.includes(item.id); }
  terminal(p,type='shop',id=null) { return this.staticWorld().terminals.some(t=>t.type===type&&(!id||t.id===id)&&dist(p,t)<=this.c.player.interact_distance); }
  requireAction(p) { requireThat(this.s.phase!=='COMPLETE','WRONG_PHASE');requireThat(this.inScene(p)&&live(p),'NOT_ALIVE');requireThat(!p.swimming,'INVALID_TARGET'); }
  checkTargetRevision(target,expected) { if(expected!==undefined)requireThat(target?.revision===expected,'STALE_REVISION'); }
  command(p,message) {
    const requestId=message.requestId;
    if(!Number.isSafeInteger(requestId)||requestId<1)return {type:'result',requestId:0,ok:false,code:'INVALID_TARGET',message:'请求序号无效'};
    const cached=p.requestCache.find(r=>r.requestId===requestId);if(cached)return cached;
    if(requestId<=p.requestHighWater)return {type:'result',requestId,ok:false,code:'REQUEST_EXPIRED',message:errorText.REQUEST_EXPIRED};
    let result;
    try { const data=this.dispatch(p,message);result={type:'result',requestId,ok:true,message:'已完成',...(data?{data}:{})}; }
    catch(error){if(!(error instanceof GameError)&&!(error instanceof DirectorError)&&!(error instanceof MissionError))throw error;result={type:'result',requestId,ok:false,code:error.code,message:error.message};}
    p.requestHighWater=requestId;p.requestCache.push(result);if(p.requestCache.length>256)p.requestCache.shift();this.requestSave=true;return result;
  }
  dispatch(p,{command,targetId,expectedRevision,payload={}}) {
    const s=this.s,c=this.c;
    if(command==='MissionControl'){this.requireAction(p);return missionCommand(this,p,payload);}
    if(command==='Settings'){requireThat(s.hostId===p.id,'HOST_ONLY');requireThat(typeof payload.friendlyFire==='boolean','INVALID_TARGET');s.friendlyFire=payload.friendlyFire;return;}
    if(command==='Save'){this.requestSave=true;return;}
    if(command==='NewAdventure'){requireThat(s.hostId===p.id,'HOST_ONLY');requireThat(s.phase==='COMPLETE'&&payload.confirm===true,'WRONG_PHASE');this.newAdventureRequested=true;return;}
    if(command==='CancelWork'){this.cancelWork(p);if(p.reload){p.reload=null;if(p.action?.startsWith('reload'))this.setAction(p,'idle');}return;}
    if(command==='CancelFish'){this.cancelFishing(p,'收起鱼竿');return;}
    if(command==='SelfRevive'){this.startRescue(p,p,true);return;}
    this.requireAction(p);
    if(command==='Ready'){requireThat(s.phase==='PREP','WRONG_PHASE');p.ready=payload.ready===true;return;}
    if(command==='StartDay'){requireThat(s.hostId===p.id,'HOST_ONLY');requireThat(s.phase==='PREP','WRONG_PHASE');requireThat(Object.values(s.players).filter(x=>x.connected).every(x=>x.ready),'BUSY');this.beginDayBarrier();return;}
    if(command==='BindQuick'){this.bindQuick(p,payload);return;}
    if(command==='UseQuick'){return this.useQuick(p,targetId??payload.targetId,payload);}
    if(command==='SwitchEquip'){this.switchEquip(p,payload);return;}
    if(command==='Fire'){this.fire(p,finite(payload.yaw,p.yaw),finite(payload.pitch,p.pitch),payload.ads===true);return;}
    if(command==='Melee'){this.melee(p,finite(payload.yaw,p.yaw),finite(payload.pitch,p.pitch));return;}
    if(command==='Reload'){this.reload(p);return;}
    if(command==='Cast'){this.cast(p,payload.poolId??targetId,payload);return;}
    if(command==='Hook'){requireThat(p.fishing?.state==='BITE','INVALID_TARGET');this.beginFishingReel(p);return;}
    if(command==='UseBandage'){requireThat(p.hp<c.player.max_hp,'INVALID_TARGET');requireThat(this.count(p,'bandage')>0,'NO_AMMO');this.beginWork(p,{kind:'Bandage',duration:this.defs.items.bandage.use_seconds,targetId:p.id,automatic:true});return;}
    if(command==='Pickup'){this.pickup(p,targetId,payload,expectedRevision);return;}
    if(command==='Search'){requireThat(['PREP','DAY','RETURN','RECOVERY'].includes(s.phase),'WRONG_PHASE');const node=s.nodes[targetId];requireThat(node&&node.state!=='depleted','NOT_FOUND');requireThat(s.waterY-node.y<=.6,'INVALID_TARGET');requireThat(dist(p,node)<=c.player.interact_distance,'OUT_OF_RANGE');this.checkTargetRevision(node,expectedRevision);this.beginWork(p,{kind:'Search',duration:1,targetId});return;}
    if(command==='SearchArchive'){requireThat(['PREP','DAY','RETURN','RECOVERY'].includes(s.phase),'WRONG_PHASE');const prop=s.destructibles?.[targetId];requireThat(prop?.kind==='archive_cabinet'&&!prop.broken&&!prop.opened&&!prop.resolution,'NOT_FOUND');requireThat(s.waterY-prop.y<=.6,'INVALID_TARGET');requireThat(dist(p,prop)<=c.player.interact_distance,'OUT_OF_RANGE');this.checkTargetRevision(prop,expectedRevision);this.beginWork(p,{kind:'SearchArchive',duration:c.destructibles.archive.search_seconds,targetId});return;}
    if(command==='Transfer'){this.transfer(p,payload,expectedRevision);return;}
    if(command==='Deposit'){this.deposit(p,targetId,payload);return;}
    if(command==='Sell')return this.sell(p,payload,expectedRevision);
    if(command==='Buy'){this.buy(p,payload);return;}
    if(command==='ClaimTool'){this.claimTool(p,payload.definitionId,payload.stationId);return;}
    if(['InstallTurret','UpgradeTurret','ReloadTurret','RepairTurret'].includes(command)){this.turretWork(p,command,targetId,expectedRevision);return;}
    if(command==='ToggleGate'){
      const b=s.buildings[targetId??'G01'];requireThat(b?.definitionId==='gate'&&b.hp>0,'INVALID_TARGET');requireThat(dist(p,b)<=c.player.interact_distance,'OUT_OF_RANGE');
      requireThat(payload.open===undefined||typeof payload.open==='boolean','INVALID_TARGET');
      // Panel buttons express an explicit intention; concurrent open requests
      // must not close the door again. E retains its one-press toggle behavior.
      const open=payload.open??!b.gateOpen;if(open===b.gateOpen)return;
      const clearance=open?[]:this.previewPlayerClearance([{entity:b,changes:{gateOpen:false}}]);requireThat(clearance,'BUSY');
      b.gateOpen=open;b.revision++;if(this.navGeometry)this.navGeometry.tick=-1;this.applyPlayerClearance(clearance);return;
    }
    if(command==='Revive'){this.startRescue(p,s.players[targetId]);return;}
    if(command==='RecoveryWork'){requireThat(s.phase==='RECOVERY','WRONG_PHASE');const target=targetId==='core'?s.buildings.core:s.recovery.debris.find(x=>x.id===targetId);requireThat(target,'NOT_FOUND');requireThat(dist(p,target)<=c.player.interact_distance,'OUT_OF_RANGE');if(targetId==='core'){requireThat(target.hp<=0&&!s.recovery.coreReady,'INVALID_TARGET');requireThat(s.recovery.debris.every(x=>x.done),'BUSY');}else requireThat(!target.done,'INVALID_TARGET');this.beginWork(p,{kind:'RecoveryWork',targetId,duration:targetId==='core'?c.recovery.core_rebuild_seconds:c.recovery.debris_work_seconds});return;}
    if(['Repair','Rebuild','Upgrade'].includes(command)){requireThat(s.phase!=='COMPLETE'&&(s.phase!=='RECOVERY'||s.recovery?.coreReady||s.buildings.core.hp>0),'WRONG_PHASE');const b=s.buildings[targetId],item=s.items[targetId];this.checkTargetRevision(b??item,expectedRevision);
      let costC=0,costM=0,duration=c.construction.upgrade_seconds;
      if(b){requireThat(dist(p,b)<=c.player.interact_distance,'OUT_OF_RANGE');const def=this.defs.buildings[b.definitionId];if(command==='Repair'){requireThat(b.hp>0&&b.hp<b.maxHp,'INVALID_TARGET');costM=c.construction.repair_m;duration=c.construction.repair_seconds;}else if(command==='Rebuild'){requireThat(b.hp===0&&b.definitionId!=='core','INVALID_TARGET');costM=c.construction.rebuild_m;duration=c.construction.rebuild_seconds;}else {requireThat(b.level===1&&b.hp>0,'INVALID_TARGET');costC=def.upgrade_c;costM=def.upgrade_m;}}
      else {requireThat(s.phase!=='NIGHT','WRONG_PHASE');requireThat(command==='Upgrade'&&this.own(p,item)&&this.defs.weapons[item.definitionId]&&item.level<c.weapon_upgrade.max_level,'INVALID_TARGET');requireThat(this.terminal(p,'upgrade',payload.stationId),'OUT_OF_RANGE');costC=c.weapon_upgrade.cost_c;costM=c.weapon_upgrade.cost_m;}
      this.beginWork(p,{kind:command,targetId,duration,costC,costM,...(!b?{stationId:payload.stationId??null}:{})});return;}
    throw new GameError('INVALID_TARGET');
  }
  switchEquip(p,payload) {
    const item=payload.itemId?this.s.items[payload.itemId]:null;
    if(item){requireThat(this.own(p,item)&&!item.lockedBy,'INVALID_TARGET');const kind=this.defs.items[item.definitionId].kind;requireThat(['weapon','rod','melee'].includes(kind),'INVALID_TARGET');const target=this.s.containers[p.equipment[kind]],old=this.s.items[target.itemIds[0]],from=this.s.containers[item.containerId];if(old&&old.id!==item.id){requireThat(from.id===p.backpackId,'INVALID_TARGET');target.itemIds=[];from.itemIds=from.itemIds.filter(id=>id!==item.id);old.containerId=from.id;from.itemIds.push(old.id);item.containerId=target.id;target.itemIds.push(item.id);old.revision++;item.revision++;target.revision++;from.revision++;}else if(!old)requireThat(this.moveItem(item,target)>0,'NO_CAPACITY');p.heldSlot=kind;}
    else {requireThat(['weapon','rod','melee','quick'].includes(payload.slot),'INVALID_TARGET');p.heldSlot=payload.slot;}
    this.cancelWork(p);this.cancelFishing(p,'切换装备');p.reload=null;p.input.fire=false;p.input.ads=false;p.meleePending=null;p.quickUseUntil=0;const equipSeconds=this.defs.weapons[this.equipped(p)?.definitionId]?.equip_seconds??.35;p.equipUntil=this.s.time+equipSeconds;this.setAction(p,'equip',equipSeconds);
  }
  transfer(p,payload,expected) {
    const item=this.s.items[payload.itemId],to=this.s.containers[payload.toContainerId],from=this.s.containers[item?.containerId];requireThat(item&&to&&from,'NOT_FOUND');this.checkTargetRevision(item,expected);
    const accessible=container=>this.carriedContainer(p,container.id)||(container.type==='storage'&&this.staticWorld().terminals.some(t=>t.type==='storage'&&t.containerId===container.id&&(!payload.stationId||t.id===payload.stationId)&&dist(p,t)<=this.c.player.interact_distance));
    requireThat(accessible(from)&&accessible(to),'OUT_OF_RANGE');
    requireThat(this.moveItem(item,to,payload.quantity)>0,'NO_CAPACITY');
  }
  pickup(p,targetId,payload={},expected) {
    const entity=this.s.enemies[targetId];
    requireThat(!entity,'INVALID_TARGET');
    const container=this.s.containers[targetId];requireThat(container&&!['backpack','storage'].includes(container.type)&&!container.type.startsWith('equip_'),'INVALID_TARGET');requireThat(dist(p,container)<=this.c.player.pickup_distance,'OUT_OF_RANGE');this.checkTargetRevision(container,expected);
    requireThat(this.containerContent(container),'NOT_FOUND');
    let count=0;
    for(const id of [...container.itemIds]){if(payload.itemId&&id!==payload.itemId)continue;const item=this.s.items[id];if(item.loanOwnerSlotId&&item.loanOwnerSlotId!==p.slotId)continue;count+=this.moveItem(item,this.bag(p),payload.quantity);}
    this.containerContent(container);requireThat(count>0,'NO_CAPACITY');
  }
  deposit(p,targetId,payload={}) {
    if(targetId){const box=this.s.containers[targetId];requireThat(box?.type==='recovery','INVALID_TARGET');requireThat(dist(p,box)<=this.c.player.interact_distance,'OUT_OF_RANGE');requireThat((box.recoverableC??0)>0||(box.recoverableM??0)>0,'NOT_FOUND');this.s.bank.credits+=box.recoverableC??0;this.s.bank.materials+=box.recoverableM??0;box.recoverableC=0;box.recoverableM=0;box.revision++;this.containerContent(box);this.s.bank.revision++;return;}
    requireThat(this.s.phase!=='COMPLETE','WRONG_PHASE');requireThat(this.terminal(p,'recycle',payload.stationId),'OUT_OF_RANGE');
    let credits=0,materials=0;
    for(const id of [...this.bag(p).itemIds]){const item=this.s.items[id],def=this.defs.items[item.definitionId];if(!recycleLoot(def)||item.lockedBy||item.loanOwnerSlotId||(!def.sell_c&&!def.deposit_m))continue;credits+=(def.sell_c??0)*item.quantity;materials+=(def.deposit_m??0)*item.quantity;this.removeItem(item);}
    this.s.bank.credits+=credits;this.s.bank.materials+=materials;this.s.bank.revision++;this.event('TransactionResult',{kind:'Deposit',credits,materials,actorId:p.id});
  }
  saleQuote(item,quantity) {
    const def=this.defs.items[item.definitionId];
    if(!def||item.loanOwnerSlotId||item.lockedBy)return null;
    let credits=0,materials=0;
    if(recycleLoot(def)){credits=(def.sell_c??0)*quantity;materials=(def.deposit_m??0)*quantity;}
    else {
      if(!this.c.economy.gear_resale||!Number.isSafeInteger(def.resale_c)||def.resale_c<=0)return null;
      credits=def.resale_c*quantity;
      const weapon=this.defs.weapons[def.id];
      if(weapon)credits+=(item.magazineAmmo??0)*(this.defs.items[weapon.ammo].resale_c??0)+Math.max(0,item.level-1)*Math.floor(this.c.weapon_upgrade.cost_c*this.c.economy.resale_upgrade_fraction);
    }
    return Number.isSafeInteger(credits)&&Number.isSafeInteger(materials)&&credits+materials>0?{credits,materials}:null;
  }
  sell(p,payload,expected) {
    requireThat(this.s.phase!=='COMPLETE','WRONG_PHASE');
    requireThat(typeof payload.stationId==='string'&&payload.stationId.length>0,'INVALID_TARGET');
    requireThat(this.terminal(p,'recycle',payload.stationId),'OUT_OF_RANGE');
    const item=this.s.items[payload.itemId],quantity=payload.quantity;
    requireThat(this.own(p,item),'INVALID_TARGET');
    requireThat(Number.isSafeInteger(expected),'STALE_REVISION');this.checkTargetRevision(item,expected);
    requireThat(Number.isSafeInteger(quantity)&&quantity>0&&quantity<=item.quantity,'INVALID_TARGET');
    requireThat(!item.lockedBy&&!p.work&&!p.reload&&!p.fishing&&!p.meleePending,'BUSY');
    requireThat(!item.loanOwnerSlotId,'NOT_SELLABLE');
    const equipped=item.containerId!==p.backpackId;
    requireThat(!equipped||payload.confirmEquipped===true,'CONFIRM_EQUIPPED');
    const quote=this.saleQuote(item,quantity);requireThat(quote,'NOT_SELLABLE');
    const bank=this.s.bank;requireThat(Number.isSafeInteger(bank.credits+quote.credits)&&Number.isSafeInteger(bank.materials+quote.materials),'INVALID_TARGET');
    const definitionId=item.definitionId,itemId=item.id;
    if(quantity===item.quantity)this.removeItem(item);
    else {item.quantity-=quantity;item.revision++;this.s.containers[item.containerId].revision++;}
    if(equipped){p.input={};p.equipUntil=this.s.time+.35;this.setAction(p,'equip',.35);}
    bank.credits+=quote.credits;bank.materials+=quote.materials;bank.revision++;
    this.event('TransactionResult',{kind:'Sell',actorId:p.id,itemId,definitionId,quantity,...quote});
    return {itemId,definitionId,quantity,...quote};
  }
  checkFunds(credits,materials) { const bank=this.s.bank;requireThat(bank.credits-bank.reservedCredits>=credits&&bank.materials-bank.reservedMaterials>=materials,'NO_FUNDS'); }
  buy(p,payload) {
    requireThat(!['NIGHT','COMPLETE'].includes(this.s.phase),'WRONG_PHASE');requireThat(this.terminal(p,'shop',payload.stationId),'OUT_OF_RANGE');const def=this.defs.items[payload.definitionId];requireThat(def&&Number.isFinite(def.buy_c)&&def.id!=='knife','INVALID_TARGET');const quantity=def.buy_quantity??1;this.checkFunds(def.buy_c,def.buy_m??0);
    const equipId=p.equipment[def.kind],equip=equipId?this.s.containers[equipId]:null,old=equip?this.s.items[equip.itemIds[0]]:null;
    if(equip&&(!old||payload.replace===true)){if(old)requireThat(this.canFit(this.bag(p),old.definitionId,1)&&!old.lockedBy,'NO_CAPACITY');if(old)this.moveItem(old,this.bag(p));this.createItem(def.id,1,equip);}
    else {requireThat(this.canFit(this.bag(p),def.id,quantity),'NO_CAPACITY');this.addItems(this.bag(p),def.id,quantity);}
    this.s.bank.credits-=def.buy_c;this.s.bank.materials-=def.buy_m??0;this.s.bank.revision++;this.event('TransactionResult',{kind:'Buy',definitionId:def.id,actorId:p.id});
  }
  claimTool(p,definitionId,stationId=null) {
    requireThat(this.s.phase!=='COMPLETE'&&this.terminal(p,'shop',stationId),'OUT_OF_RANGE');requireThat(this.c.economy.free_recovery_tools.includes(definitionId),'INVALID_TARGET');const kind=this.defs.items[definitionId].kind,container=this.s.containers[p.equipment[kind]];
    const oldLoans=Object.values(this.s.items).filter(item=>item.loanOwnerSlotId===p.slotId&&item.definitionId===definitionId);
    const occupied=container.itemIds.map(id=>this.s.items[id]).filter(item=>!oldLoans.includes(item));requireThat(!occupied.length&&!this.bag(p).itemIds.some(id=>this.defs.items[this.s.items[id].definitionId].kind===kind&&!oldLoans.includes(this.s.items[id])),'INVALID_TARGET');
    for(const item of oldLoans)this.removeItem(item);
    this.createItem(definitionId,1,occupied.length?this.bag(p):container,{loanOwnerSlotId:p.slotId});
  }
  workTarget(work) { return this.s.buildings[work.targetId]??this.s.turrets?.[work.targetId]??this.s.items[work.targetId]??this.s.nodes[work.targetId]??this.s.destructibles?.[work.targetId]??this.s.players[work.targetId]??this.s.recovery?.debris.find(x=>x.id===work.targetId); }
  turretWork(p,kind,targetId,expected) {
    const target=this.s.turrets[targetId],c=this.c.fortress;requireThat(target,'NOT_FOUND');requireThat(dist(p,target)<=this.c.player.interact_distance,'OUT_OF_RANGE');this.checkTargetRevision(target,expected);requireThat(this.s.buildings.core.hp>0,'WRONG_PHASE');
    let cost,firstInstall=false;
    if(kind==='InstallTurret'){requireThat(this.s.phase!=='NIGHT','WRONG_PHASE');requireThat(target.hp<=0,'INVALID_TARGET');firstInstall=target.level===0;if(firstInstall)requireThat(this.s.buildings.core.level>=c.unlock.coreLevel&&this.s.statistics.daysSurvived>=c.unlock.daysSurvived,'WRONG_PHASE');cost=firstInstall?c.costs.install:c.costs.rebuild;}
    else {requireThat(target.level>0&&target.hp>0,'INVALID_TARGET');if(kind==='UpgradeTurret'){requireThat(this.s.phase!=='NIGHT','WRONG_PHASE');requireThat(target.level<2,'INVALID_TARGET');cost=c.costs.upgrade;}else if(kind==='ReloadTurret'){requireThat(target.ammo<target.capacity,'INVALID_TARGET');cost=c.costs.reload;}else {requireThat(target.hp<target.maxHp,'INVALID_TARGET');cost={credits:0,materials:this.c.construction.repair_m,seconds:this.c.construction.repair_seconds};}}
    this.beginWork(p,{kind,targetId,duration:cost.seconds,costC:cost.credits,costM:cost.materials,firstInstall,startLevel:target.level});
  }
  beginWork(p,work) {
    requireThat(!p.work,'BUSY');const target=this.workTarget(work);requireThat(target&&!target.lockedBy,'BUSY');this.checkFunds(work.costC??0,work.costM??0);
    this.cancelFishing(p,'开始交互');p.reload=null;target.lockedBy=p.id;
    this.s.bank.reservedCredits+=work.costC??0;this.s.bank.reservedMaterials+=work.costM??0;
    p.work={...work,progress:0,startX:p.x,startZ:p.z,startDamageAt:p.damageAt,startHitSeq:p.hitSeq??0,startedAt:this.s.time};this.setAction(p,'interact',work.duration,{workKind:work.kind,targetId:work.targetId});if(work.kind==='Search')this.alertNoise(p,'search');if(work.kind==='SearchArchive')this.alertNoise(p,'archive_search');
  }
  cancelWork(p) {
    const work=p.work;if(!work)return;const target=this.workTarget(work);if(target?.lockedBy===p.id)delete target.lockedBy;
    this.s.bank.reservedCredits=Math.max(0,this.s.bank.reservedCredits-(work.costC??0));this.s.bank.reservedMaterials=Math.max(0,this.s.bank.reservedMaterials-(work.costM??0));p.work=null;if(p.action==='interact')this.setAction(p,'idle');
  }
  updateWork(p,dt) {
    const work=p.work;if(!work)return;const target=this.workTarget(work);
    if(['Revive','SelfRevive'].includes(work.kind)){if(!this.rescueValid(p)){this.cancelWork(p);return;}if(this.rescueHeld(p))work.progress=Math.min(work.duration,work.progress+dt);return;}
    if(!this.inScene(p)||!live(p)||p.swimming||!target||(work.kind==='Revive'&&!this.inScene(target))||dist(p,{x:work.startX,z:work.startZ})>.25||p.damageAt!==work.startDamageAt||(!work.automatic&&!p.input.interact&&this.s.time-work.startedAt>.3)||(target.x!==undefined&&dist(p,target)>this.c.player.interact_distance+.1)||(['Search','SearchArchive'].includes(work.kind)&&this.s.waterY-target.y>.6)||(work.kind==='SearchArchive'&&(target.broken||target.opened||target.resolution))){this.cancelWork(p);return;}
    if(target.socketId&&((['Repair','Upgrade'].includes(work.kind)&&target.hp<=0)||(work.kind==='Rebuild'&&target.hp>0))){this.cancelWork(p);return;}
    if(work.kind==='Upgrade'&&this.defs.weapons[target.definitionId]&&(!this.own(p,target)||this.s.phase==='NIGHT'||!this.terminal(p,'upgrade',work.stationId))){this.cancelWork(p);return;}
    if(work.kind.endsWith('Turret')&&(this.s.buildings.core.hp<=0||target.level!==work.startLevel||(work.kind==='InstallTurret'?target.hp>0:target.hp<=0))){this.cancelWork(p);return;}
    work.progress+=dt;if(work.progress+1e-8<work.duration)return;
    const kind=work.kind,again=kind==='Repair'||kind==='RepairTurret';
    if(kind==='Revive'&&target.lifeState!=='DOWNED'){this.cancelWork(p);return;}
    if(kind==='Bandage'&&(this.count(p,'bandage')<1||p.hp>=this.c.player.max_hp)){this.cancelWork(p);return;}
    const activating=kind==='RecoveryWork'&&target.id==='core'?[target,...this.s.recovery.destroyedSockets.map(id=>this.s.buildings[id])]:['Rebuild','InstallTurret'].includes(kind)?[target]:[];
    const clearance=activating.length?this.previewPlayerClearance(activating.map(entity=>({entity,changes:{hp:Math.max(1,entity.hp)}}))):[];
    if(!clearance){this.cancelWork(p);this.event('Notice',{code:'CLEAR_BUILDING_SPACE',message:'建筑旁没有安全落脚位置，请队员让开后重试',actorId:p.id,targetId:target.id});return;}
    this.s.bank.credits-=work.costC??0;this.s.bank.materials-=work.costM??0;this.s.bank.revision++;
    this.cancelWork(p);
    if(kind==='Bandage'){this.consume(p,'bandage',1);p.hp=Math.min(this.c.player.max_hp,p.hp+this.defs.items.bandage.heal);}
    if(kind==='Search'){if(!target.containerId){const container=this.createContainer('loot',4,{x:target.x,y:target.y,z:target.z,createdDay:this.s.dayIndex,expiresAfterDay:this.s.dayIndex+this.c.recovery.bag_retention_days});this.addItems(container,'scrap',this.c.encounters.scrap_per_node);if(target.kind==='treasure')this.addItems(container,'treasure',1);target.containerId=container.id;}target.state='depleted';target.revision++;try{this.pickup(p,target.containerId);}catch(error){if(!(error instanceof GameError))throw error;} }
    if(kind==='SearchArchive'){const container=this.resolveArchiveLoot(target,'searched',p.id);if(container)try{this.pickup(p,container.id);}catch(error){if(!(error instanceof GameError))throw error;}}
    if(kind==='Repair')target.hp=Math.min(target.maxHp,target.hp+this.c.construction.repair_hp);
    if(this.mode==='mission')missionWork(this,kind,target.id);
    if(kind==='InstallTurret'){if(work.firstInstall)target.level=1;const def=this.c.fortress.levels[target.level-1];target.maxHp=target.hp=def.hp;target.capacity=def.capacity;target.ammo=work.firstInstall?def.capacity:0;target.fireAt=this.s.time+this.c.fortress.shotInterval;}
    if(kind==='UpgradeTurret'){const fraction=target.hp/target.maxHp;target.level++;const def=this.c.fortress.levels[target.level-1];target.maxHp=def.hp;target.hp=Math.ceil(def.hp*fraction);target.capacity=def.capacity;}
    if(kind==='ReloadTurret')target.ammo=target.capacity;
    if(kind==='RepairTurret')target.hp=Math.min(target.maxHp,target.hp+this.c.construction.repair_hp);
    if(kind.endsWith('Turret'))this.event('TurretChanged',{actorId:p.id,kind,targetId:target.id,level:target.level,hp:target.hp,ammo:target.ammo,capacity:target.capacity},target.id);
    if(kind==='Rebuild')target.hp=Math.ceil(target.maxHp*.25);
    if(kind==='Upgrade'){if(target.definitionId in this.defs.weapons)target.level++;else {const fraction=target.hp/target.maxHp;target.level=2;target.maxHp=this.defs.buildings[target.definitionId].level2_hp;target.hp=Math.ceil(target.maxHp*fraction);}}
    if(kind==='RecoveryWork'){if(target.id==='core'){target.hp=target.maxHp;for(const id of this.s.recovery.destroyedSockets){const b=this.s.buildings[id];b.hp=Math.ceil(b.maxHp*.5);b.revision++;}this.s.recovery.coreReady=true;this.event('Notice',{code:'CORE_REBUILT',message:'协作灯修复完成，剩余白天可继续搜集与备战'});}else target.done=true;this.event('RecoveryChanged',{targetId:target.id});}
    target.revision=(target.revision??0)+1;this.requestSave=true;
    this.applyPlayerClearance(clearance);
    if(again&&target.hp<target.maxHp&&p.input.interact){try{this.beginWork(p,{kind,targetId:target.id,duration:this.c.construction.repair_seconds,costM:this.c.construction.repair_m,costC:0,...(kind==='RepairTurret'?{startLevel:target.level}:{})});}catch(error){if(!(error instanceof GameError))throw error;}}
  }
  cast(p,poolId,payload) {
    requireThat(!p.carryingId,'BUSY');
    this.requireAction(p);requireThat(!p.fishing&&!p.work,'BUSY');const rod=this.equipped(p,'rod'),def=this.defs.rods[rod?.definitionId],pool=this.s.pools[poolId];requireThat(def&&!rod.lockedBy&&p.heldSlot==='rod','INVALID_TARGET');
    const explicit=payload.x!==undefined||payload.z!==undefined,x=explicit?payload.x:pool?.x,z=explicit?payload.z:pool?.z,power=payload.power??1;
    requireThat(Number.isFinite(x)&&Number.isFinite(z)&&Number.isFinite(power)&&power>=0&&power<=1,'INVALID_TARGET');
    requireThat(this.s.waterY-this.ground(p.x,p.z)<=.6&&p.y<=this.ground(p.x,p.z)+.15,'INVALID_TARGET');
    // Public positions are rounded to millimetres; a full-charge cast from
    // that position must tolerate the rounding error, but not real overreach.
    requireThat(Math.hypot(x-p.x,z-p.z)<=def.cast_range+.002&&Math.hypot(x,z)<=this.c.level.boundary_radius,'OUT_OF_RANGE');
    requireThat(this.ground(x,z)<this.s.waterY-.05,'INVALID_TARGET');
    const origin={x:p.x,y:p.y+this.c.player.camera_height,z:p.z},target={x,y:this.s.waterY+.06,z},length=Math.hypot(x-origin.x,target.y-origin.y,z-origin.z);
    requireThat(!this.rayBlock(origin,unit({x:x-origin.x,y:target.y-origin.y,z:z-origin.z}),Math.max(0,length-.08)),'INVALID_TARGET');
    const salvage=def.catch_kind==='salvage';
    if(!salvage&&this.mode==='mission'&&this.s.mission?.freePlay)requireThat(practiceCreatureLoad(this)<PRACTICE_CREATURE_CAP,'PRACTICE_CAP');
    requireThat(salvage?this.activeMagnetCount(p)<def.max_unclaimed:this.activeFishingCount(p)<this.c.fishing.open_water.max_alive_per_player,'BUSY');
    const weights=this.c.fishing.open_water.weights;let roll=this.rng('fish')*weights.reduce((n,w)=>n+w.weight,0),creature=weights.at(-1).creature;for(const entry of weights){roll-=entry.weight;if(roll<=0){creature=entry.creature;break;}}
    const castSeconds=def.cast_seconds??this.c.fishing.cast_seconds;
    let loot=null;if(salvage){const pending=p.pendingMagnetCatch;loot=def.loot_table.find(e=>e.definitionId===pending?.definitionId&&e.quantity===pending.quantity&&e.resistance===pending.resistance)??null;if(!loot){let value=this.rng('magnet')*def.loot_table.reduce((n,e)=>n+e.weight,0);loot=def.loot_table.at(-1);for(const entry of def.loot_table){value-=entry.weight;if(value<=0){loot=entry;break;}}}p.pendingMagnetCatch={definitionId:loot.definitionId,quantity:loot.quantity,resistance:loot.resistance};}
    p.fishing={id:this.id('line'),poolId:pool?.id??null,source:salvage?'magnet':'sea',power,state:'CAST',progress:0,tension:this.c.fishing.tension_start,remaining:castSeconds,elapsed:0,x,y:this.s.waterY,z,rodId:rod.id,creature:salvage?null:creature,catch_kind:salvage?'salvage':'creature',catch_resistance:salvage?loot.resistance:this.defs.creatures[creature].resistance,...(salvage?{loot_definition_id:loot.definitionId,loot_quantity:loot.quantity}:{}),breakTime:0,struggling:false};initializeFishing(p.fishing,p,def);p.reload=null;this.setAction(p,'cast',castSeconds,{lineId:p.fishing.id,poolId:p.fishing.poolId,position:target,power});this.event('FishingChanged',{state:'CAST',actorId:p.id,lineId:p.fishing.id,definitionId:rod.definitionId,catch_kind:p.fishing.catch_kind,position:target,power},p.id);
  }
  beginFishingReel(p) {
    const f=p.fishing,def=this.defs.rods[this.s.items[f.rodId]?.definitionId];
    Object.assign(f,{state:'REEL',elapsed:0,remaining:def.reel_timeout_seconds??this.c.fishing.timeout_seconds,progress:this.c.fishing.progress_start,tension:this.c.fishing.tension_start,breakTime:0});
    beginReeling(f,p,def);this.setAction(p,'hook',.35,{lineId:f.id});
  }
  activeMagnetCount(p) { return Object.values(this.s.containers).filter(c=>c.source==='magnet'&&c.ownerSlotId===p.slotId&&c.itemIds.length>0).length; }
  activeFishingCount(p) { return Object.values(this.s.enemies).filter(e=>e.source==='fishing'&&e.ownerId===p.id&&e.hp>0).length; }
  cancelFishing(p,reason) { if(p.fishing){p.fishing=null;if(['cast','hook','land','reel'].includes(p.action))this.setAction(p,'idle');this.event('FishingChanged',{state:'CANCEL',reason,actorId:p.id},p.id);} }
  updateFishing(p,dt) {
    const f=p.fishing;if(!f)return;const rod=this.s.items[f.rodId],def=this.defs.rods[rod?.definitionId];
    if(!live(p)||p.swimming||p.heldSlot!=='rod'||!def||this.equipped(p,'rod')?.id!==f.rodId||rod.lockedBy||Math.hypot(p.x-f.x,p.z-f.z)>def.cast_range+3||this.s.phase==='COMPLETE'||this.ground(f.x,f.z)>=this.s.waterY-.05){this.cancelFishing(p,'鱼线失效');return;}f.y=this.s.waterY;
    f.elapsed+=dt;f.remaining-=dt;
    if(f.state==='CAST'&&f.remaining<=0){f.state='WAIT';const min=def.bite_wait_min??this.c.fishing.bite_wait_min,max=def.bite_wait_max??this.c.fishing.bite_wait_max;f.remaining=min+this.rng('fish')*(max-min);}
    else if(f.state==='WAIT'){
      const waiting=updateWaiting(f,p,def,dt,this.c.fishing);
      if(waiting.autoHook)this.beginFishingReel(p);
      else if(waiting.readyToBite){f.state='BITE';f.remaining=def.hook_window_seconds??this.c.fishing.hook_window_seconds;this.event('FishingChanged',{state:'BITE'},p.id);}
    }
    else if(f.state==='BITE'&&f.remaining<=0)this.cancelFishing(p,'错过提竿时机');
    else if(f.state==='REEL'){
      const rates=updateReeling(f,p,def,dt,this.c.fishing);
      if(p.input.reel){f.progress+=rates.progressRate/(f.catch_resistance??this.defs.creatures[f.creature]?.resistance??1)*(p.stamina<=0?.7:1)*dt;f.tension+=rates.tensionRate*(this.director?.tensionFactor(p)??1)*dt;p.stamina=Math.max(0,p.stamina-this.c.fishing.reel_stamina_drain*rates.drainScale*dt);p.staminaUsedAt=this.s.time;}
      else {f.progress-=rates.lossRate*dt;f.tension-=def.tension_fall*dt;}
      f.progress=clamp(f.progress,0,100);f.tension=clamp(f.tension,0,100);f.breakTime=f.tension>=100?f.breakTime+dt:0;
      if(f.breakTime>=this.c.fishing.break_hold_seconds||f.remaining<=0){this.cancelFishing(p,'张力过高或收线超时');return;}
      if(f.progress>=this.c.fishing.progress_goal){f.state='LAND';f.remaining=this.c.fishing.landing_seconds;this.setAction(p,'land',f.remaining,{lineId:f.id});}
    }else if(f.state==='LAND'&&f.remaining<=0){
      const direction=aim(p.yaw,0);let landing=null;
      for(const distance of [1.8,1.2,2.4,.6,0]){
        const candidate={x:p.x+direction.x*distance,z:p.z+direction.z*distance},ground=this.ground(candidate.x,candidate.z);
        if(this.s.waterY-ground>.6||this.blocked(candidate.x,ground,candidate.z,f.special?.9:.35))continue;
        // A magnet package must land on this side of a wall or crate. Use the
        // complete low-height segment, including its endpoint; combat sight
        // intentionally stops short of an actor and is unsuitable for loot.
        if(f.catch_kind==='salvage'&&distance>0){const from={x:p.x,y:p.y+.35,z:p.z},delta={x:candidate.x-p.x,y:ground-p.y,z:candidate.z-p.z},length=Math.hypot(delta.x,delta.y,delta.z);if(this.rayBlock(from,unit(delta),length))continue;}
        landing=candidate;break;
      }
      if(f.special&&Object.values(this.s.enemies).some(e=>e.source==='rare_catch')){this.cancelFishing(p,'已有大鱼上岸，先一起处理');return;}
      if(!landing||(f.catch_kind==='salvage'?this.activeMagnetCount(p)>=(def.max_unclaimed??2):this.activeFishingCount(p)>=this.c.fishing.open_water.max_alive_per_player)){this.cancelFishing(p,f.catch_kind==='salvage'?'请先捡起磁吸物，或寻找可用岸边':'请先击败已上岸的鱼，或寻找可用岸边');return;}
      if(f.catch_kind==='salvage'){
        const loot=this.defs.items[f.loot_definition_id];
        if(!loot||!Number.isSafeInteger(f.loot_quantity)||f.loot_quantity<1||f.loot_quantity>loot.stack){this.cancelFishing(p,'磁吸物失效');return;}
        const position={...landing,y:this.ground(landing.x,landing.z)},box=this.createContainer('loot',1,{...position,source:'magnet',ownerSlotId:p.slotId,lineId:f.id,createdDay:this.s.dayIndex,expiresAfterDay:this.s.dayIndex+this.c.recovery.bag_retention_days});
        this.createItem(f.loot_definition_id,f.loot_quantity,box);this.containerContent(box);p.fishing=null;p.pendingMagnetCatch=null;this.requestSave=true;
        this.event('FishingChanged',{state:'LANDED',actorId:p.id,lootContainerId:box.id,definitionId:f.loot_definition_id,quantity:f.loot_quantity,catch_kind:'salvage',source:'magnet',position},p.id);return;
      }
      const enemy=this.spawnEnemy(f.creature,landing.x,landing.z,false);enemy.source='fishing';enemy.ownerId=p.id;enemy.hp=enemy.maxHp=this.c.fishing.open_water.hp[f.creature];enemy.attackRadius=this.c.fishing.open_water.attack_range;enemy.state='STUNNED';enemy.phaseRemaining=this.c.fishing.spawn_stun_seconds;enemy.landed=true;this.s.statistics.fishLanded++;this.exploration?.landed(enemy,p,f);p.fishing=null;this.event('FishingChanged',{state:'LANDED',actorId:p.id,enemyId:enemy.id,definitionId:enemy.definitionId,source:enemy.source,position:{x:enemy.x,y:enemy.y,z:enemy.z}},p.id);
    }
  }
  boxes(includeCore=true) {
    this.staticBoxes??=[...ROCKS.map(r=>({id:r.id,x0:r.x-r.width/2,x1:r.x+r.width/2,z0:r.z-r.depth/2,z1:r.z+r.depth/2,y0:this.ground(r.x,r.z),y1:this.ground(r.x,r.z)+r.height})),...this.staticWorld().terminals.map(t=>({id:t.id,x0:t.x-.825,x1:t.x+.825,z0:t.z-.5,z1:t.z+.5,y0:t.y,y1:t.y+(t.type==='training'?.96:1.1)}))];
    const boxes=this.staticBoxes.slice();
    for(const turret of Object.values(this.s.turrets??{}))if(turret.hp>0)for(const part of this.c.fortress.collision)boxes.push({id:turret.id,x0:turret.x+part.x-part.width/2,x1:turret.x+part.x+part.width/2,y0:turret.y+part.y-part.height/2,y1:turret.y+part.y+part.height/2,z0:turret.z+part.z-part.depth/2,z1:turret.z+part.z+part.depth/2});
    for(const prop of Object.values(this.s.destructibles??{}))if(!prop.broken&&prop.hp>0)boxes.push(...this.propSolidBoxes(prop));
    for(const b of Object.values(this.s.buildings)){
      if(b.hp<=0||(!includeCore&&b.id==='core'))continue;
      const cached=this.colliderCache.get(b);if(cached&&cached.x===b.x&&cached.y===b.y&&cached.z===b.z&&cached.yaw===b.yaw&&cached.gateOpen===b.gateOpen){boxes.push(...cached.boxes);continue;}const shapes=[];
      if(b.id==='core')shapes.push({id:b.id,x0:b.x-1.5,x1:b.x+1.5,z0:b.z-1.5,z1:b.z+1.5,y0:b.y,y1:b.y+3});
      else {
      const rotated=Math.abs(Math.sin(b.yaw))>.5,width=rotated?.3:3,depth=rotated?3:.3;
      if(b.definitionId==='gate'&&b.gateOpen){for(const side of [-1,1]){const x=b.x+(rotated?0:side*1.35),z=b.z+(rotated?side*1.35:0);shapes.push({id:b.id,x0:x-.15,x1:x+.15,z0:z-.15,z1:z+.15,y0:b.y,y1:b.y+2.5});}}
      else shapes.push({id:b.id,x0:b.x-width/2,x1:b.x+width/2,z0:b.z-depth/2,z1:b.z+depth/2,y0:b.y,y1:b.y+2.5});
      }this.colliderCache.set(b,{x:b.x,y:b.y,z:b.z,yaw:b.yaw,gateOpen:b.gateOpen,boxes:shapes});boxes.push(...shapes);
    }
    return boxes;
  }
  blocked(x,y,z,radius=.35,ignoreId=null) { return this.boxes().find(box=>box.id!==ignoreId&&x>box.x0-radius&&x<box.x1+radius&&z>box.z0-radius&&z<box.z1+radius&&y<box.y1&&y+1.6>box.y0); }
  // Collision activation is preflighted before charging a job or closing a gate.
  // Only the solids already intersecting a capsule may be crossed while pushing
  // it out; unrelated walls, terrain cliffs and deep water remain impassable.
  previewPlayerClearance(changes) {
    const previous=changes.map(({entity,changes})=>({entity,changes:Object.fromEntries(Object.keys(changes).map(key=>[key,entity[key]]))}));
    try{for(const entry of changes)Object.assign(entry.entity,entry.changes);return this.planPlayerClearance();}
    finally{for(const entry of previous)Object.assign(entry.entity,entry.changes);}
  }
  planPlayerClearance(players=this.scenePlayers()) {
    const boxes=this.boxes(),radius=this.c.player.capsule_radius,plans=[],moved=new Map();
    const intersects=(p,b)=>p.x>b.x0-radius&&p.x<b.x1+radius&&p.z>b.z0-radius&&p.z<b.z1+radius&&p.y<b.y1&&p.y+1.6>b.y0;
    for(const p of players){if(!this.inScene(p)||p.lifeState==='DEAD_WAIT')continue;const overlapping=boxes.filter(b=>intersects(p,b));if(!overlapping.length)continue;
      const crossed=new Set(overlapping),margin=radius+.08,candidates=[];
      for(const b of overlapping)candidates.push({x:b.x0-margin,z:p.z},{x:b.x1+margin,z:p.z},{x:p.x,z:b.z0-margin},{x:p.x,z:b.z1+margin});
      for(let r=.5;r<=16;r+=.5)for(let side=0;side<32;side++){const angle=side*Math.PI/16;candidates.push({x:p.x+Math.cos(angle)*r,z:p.z+Math.sin(angle)*r});}
      candidates.sort((a,b)=>dist(p,a)-dist(p,b));let chosen=null;
      for(const q of candidates){const ground=this.ground(q.x,q.z);q.y=Math.max(ground,p.y);
        if(Math.hypot(q.x,q.z)>=this.c.level.boundary_radius-radius||this.s.waterY-ground>.6||boxes.some(b=>intersects(q,b)))continue;
        if(this.scenePlayers().some(other=>other.id!==p.id&&other.connected&&other.lifeState!=='DEAD_WAIT'&&dist(q,moved.get(other.id)??other)<radius*2+.08))continue;
        const steps=Math.max(1,Math.ceil(dist(p,q)/.2));let prior=this.ground(p.x,p.z),clear=true;
        for(let i=1;i<=steps;i++){const t=i/steps,x=p.x+(q.x-p.x)*t,z=p.z+(q.z-p.z)*t,y=this.ground(x,z),point={x,z,y:Math.max(y,p.y)};if(Math.abs(y-prior)>.75||this.s.waterY-y>.6||boxes.some(b=>!crossed.has(b)&&intersects(point,b))){clear=false;break;}prior=y;}
        if(clear){chosen=q;break;}
      }
      if(!chosen)return null;plans.push({player:p,position:chosen});moved.set(p.id,chosen);
    }
    return plans;
  }
  applyPlayerClearance(plans) {
    if(!plans)return false;
    for(const {player:p,position}of plans){const from={x:p.x,y:p.y,z:p.z};this.cancelWork(p);this.cancelFishing(p,'建筑恢复，已移至旁边安全位置');p.reload=null;p.input={};p.jumpQueued=false;p.vy=0;p.velocity={x:0,y:0,z:0};p.moveSpeed=0;p.sprinting=false;Object.assign(p,position);this.setAction(p,'idle');this.event('PositionCorrected',{actorId:p.id,reason:'building_clearance',from,position:{...position}},p.id);this.requestSave=true;}
    return true;
  }
  rayBlock(origin,direction,maximum,ignoreId=null) {
    let best=null;
    for(const box of this.boxes()){if(box.id===ignoreId)continue;const t=rayBox(origin,direction,box,maximum);if(t!==null&&(!best||t<best.distance)){
      const position={x:origin.x+direction.x*t,y:origin.y+direction.y*t,z:origin.z+direction.z*t},faces=[];for(const axis of ['x','y','z'])for(const side of [0,1])faces.push({distance:Math.abs(position[axis]-box[`${axis}${side}`]),normal:{x:0,y:0,z:0,[axis]:side?1:-1}});faces.sort((a,b)=>a.distance-b.distance);
      const building=this.s.buildings[box.id],prop=this.s.destructibles?.[box.id];best={id:box.id,distance:t,position,normal:t<1e-6?{x:-direction.x,y:-direction.y,z:-direction.z}:faces[0].normal,surface:building?.definitionId??(prop?this.propMaterial(prop):this.s.turrets?.[box.id]?'turret':box.id.startsWith('rock_')?'rock':this.staticWorld().terminals.some(t=>t.id===box.id)?'terminal':'unknown')};
    }}
    const step=.45,limit=best?.distance??maximum;
    for(let t=.01;t<=limit;t=Math.min(limit,t+step)){const x=origin.x+direction.x*t,z=origin.z+direction.z*t;if(origin.y+direction.y*t<this.ground(x,z)+.02){let low=Math.max(0,t-step),high=t;for(let i=0;i<12;i++){const mid=(low+high)/2,mx=origin.x+direction.x*mid,mz=origin.z+direction.z*mid;if(origin.y+direction.y*mid<this.ground(mx,mz)+.02)high=mid;else low=mid;}const distance=high,position={x:origin.x+direction.x*distance,y:origin.y+direction.y*distance,z:origin.z+direction.z*distance},epsilon=.04;const normal=unit({x:(this.ground(position.x-epsilon,position.z)-this.ground(position.x+epsilon,position.z))/(2*epsilon),y:1,z:(this.ground(position.x,position.z-epsilon)-this.ground(position.x,position.z+epsilon))/(2*epsilon)});best={id:'terrain',distance,position,normal,surface:'terrain'};break;}if(t===limit)break;}
    return best;
  }
  lineVisible(a,b) { const from={x:a.x,y:a.y+1,z:a.z},to={x:b.x,y:b.y+(b.lifeState==='DOWNED'?.42:1),z:b.z},length=Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z);if(length<.01)return true;const direction={x:(to.x-from.x)/length,y:(to.y-from.y)/length,z:(to.z-from.z)/length};return !this.rayBlock(from,direction,Math.max(0,length-.5),b.id); }
  move(p,dx,dz,dt,radius=.35) {
    let x=p.x+dx*dt,z=p.z+dz*dt;
    const boundary=this.c.level.boundary_radius,r=Math.hypot(x,z);if(r>boundary){x*=boundary/r;z*=boundary/r;}
    const oldGround=this.ground(p.x,p.z),newGround=this.ground(x,z);
    if(newGround-oldGround>Math.max(.75,Math.hypot(x-p.x,z-p.z)*.8))return false;
    if(!this.blocked(x,p.y,z,radius,p.id)){p.x=x;p.z=z;return true;}
    if(!this.blocked(x,p.y,p.z,radius,p.id))p.x=x;
    if(!this.blocked(p.x,p.y,z,radius,p.id))p.z=z;
    return false;
  }
  updatePlayer(p,dt) {
    if(!this.inScene(p))return;
    const previousPosition={x:p.x,y:p.y,z:p.z};p.velocity={x:0,y:0,z:0};p.moveSpeed=0;
    if(!live(p)){p.sprinting=false;p.meleePending=null;}
    if(p.disconnectedAt!==null&&this.s.time-p.disconnectedAt>=this.c.session.reconnect_seconds){if(p.lifeState!=='DEAD_WAIT')this.die(p);p.disconnectedAt=null;p.respawnRemaining=0;}
    if(p.lifeState==='DEAD_WAIT'){if(this.s.phase!=='NIGHT'&&p.connected&&p.respawnRemaining>0){p.respawnRemaining-=dt;if(p.respawnRemaining<=0)this.respawn(p);}return;}
    if(this.s.time-p.inputAt>.5)p.input={};
    if(p.lifeState==='DOWNED'){this.updateDowned(p,dt);return;}
    const input=p.input,length=Math.hypot(input.dx??0,input.dz??0),scale=length>1?1/length:1;
    p.crouching=input.crouch===true;p.swimming=this.s.waterY-this.ground(p.x,p.z)>.6;
    p.sprinting=!p.carryingId&&!!input.sprint&&!p.crouching&&!p.swimming&&p.stamina>0&&length>.01;
    let speed=p.swimming?this.c.player.swim_speed:p.sprinting?this.c.player.sprint_speed:p.crouching?this.c.player.crouch_speed:this.c.player.walk_speed;
    if(!p.swimming&&this.s.waterY>this.ground(p.x,p.z))speed*=.7;
    speed*=this.director?.moveFactor(p)??1;
    if(p.carryingId)speed*=this.c.exploration.carrySpeed;
    if(!p.swimming&&p.heldSlot==='weapon')speed*=this.defs.weapons[this.equipped(p)?.definitionId]?.move_multiplier??1;
    this.move(p,(input.dx??0)*scale*speed,(input.dz??0)*scale*speed,dt,this.c.player.capsule_radius);
    const ground=this.ground(p.x,p.z);
    if(p.swimming){p.y=Math.max(ground,this.s.waterY-1.15);p.vy=0;p.oxygen=Math.max(0,p.oxygen-dt);if(p.oxygen<=0)this.damageQueue.push({target:p.id,damage:this.c.player.drowning_dps*dt,actorId:'water'});}
    else {p.oxygen=Math.min(this.c.player.oxygen_seconds,p.oxygen+this.c.player.oxygen_seconds/2*dt);if(!p.carryingId&&p.jumpQueued&&p.y<=ground+.05){p.vy=Math.sqrt(2*11*this.c.player.jump_height);this.setAction(p,'jump',.3);}p.vy-=11*dt;p.y=Math.max(ground,p.y+p.vy*dt);if(p.y<=ground)p.vy=0;}
    p.jumpQueued=false;
    p.velocity={x:(p.x-previousPosition.x)/dt,y:(p.y-previousPosition.y)/dt,z:(p.z-previousPosition.z)/dt};p.moveSpeed=Math.hypot(p.velocity.x,p.velocity.z);p.grounded=!p.swimming&&p.y<=ground+.05;
    if(p.sprinting){p.stamina=Math.max(0,p.stamina-this.c.player.sprint_drain*(this.director?.sprintFactor(p)??1)*dt);p.staminaUsedAt=this.s.time;}
    else if(this.s.time-p.staminaUsedAt>=this.c.player.regen_delay)p.stamina=Math.min(this.c.player.stamina_max,p.stamina+this.c.player.stamina_regen*dt);
    this.updateReload(p,dt);this.updateFishing(p,dt);this.updateWork(p,dt);
    if(input.fire&&!p.carryingId&&!p.work&&!p.swimming&&this.s.time>=p.equipUntil){try{if((!this.equipped(p)||p.heldSlot==='melee')&&this.s.time>=p.meleeAt)this.melee(p,p.yaw,p.pitch);else if(p.heldSlot==='weapon'&&this.s.time>=p.fireAt&&!p.reload&&this.defs.weapons[this.equipped(p)?.definitionId]?.fire_mode!=='semi')this.fire(p,p.yaw,p.pitch,!!input.ads);}catch(error){if(!(error instanceof GameError))throw error;}}
    if(p.meleePending&&p.meleePending.at<=this.s.time){const pending=p.meleePending;p.meleePending=null;this.resolveMelee(p,pending);}
  }
  reload(p) {
    requireThat(!p.carryingId,'BUSY');
    const item=this.equipped(p,'weapon'),def=this.defs.weapons[item?.definitionId];requireThat(p.heldSlot==='weapon'&&def&&!item.lockedBy&&!p.work,'INVALID_TARGET');requireThat(item.magazineAmmo<def.magazine&&!p.reload,'BUSY');requireThat(this.mode==='mission'||this.count(p,def.ammo)>0,'NO_AMMO');
    const multiplier=item.level>1?this.c.weapon_upgrade.reload_multiplier:1;
    p.reload={itemId:item.id,remaining:((def.reload_start_seconds??0)+def.reload_seconds)*multiplier*(this.director?.reloadFactor(p)??1),loaded:0};this.setAction(p,'reload',p.reload.remaining,{definitionId:def.id});
  }
  updateReload(p,dt) {
    const reload=p.reload;if(!reload)return;const item=this.s.items[reload.itemId],def=this.defs.weapons[item?.definitionId];if(!item||this.equipped(p)?.id!==item.id||p.swimming){p.reload=null;return;}reload.remaining-=dt;if(reload.remaining>0)return;
    const count=Math.min(this.mode==='mission'?def.magazine:this.count(p,def.ammo),def.magazine-item.magazineAmmo,def.id==='shotgun'?1:Infinity);
    if(count){if(this.mode!=='mission')this.consume(p,def.ammo,count);item.magazineAmmo+=count;item.revision++;reload.loaded+=count;this.setAction(p,def.id==='shotgun'?'reload_insert':'reload_complete',def.id==='shotgun'?.15:.1,{definitionId:def.id,loaded:count,magazineAmmo:item.magazineAmmo});}
    if(def.id==='shotgun'&&item.magazineAmmo<def.magazine&&(this.mode==='mission'||this.count(p,def.ammo)>0))reload.remaining+=def.reload_seconds*(item.level>1?this.c.weapon_upgrade.reload_multiplier:1)*(this.director?.reloadFactor(p)??1);else p.reload=null;
  }
  fire(p,yaw,pitch,ads=false) {
    requireThat(!p.carryingId,'BUSY');
    this.requireAction(p);requireThat(!p.work&&!p.fishing&&!p.sprinting&&p.heldSlot==='weapon','BUSY');const item=this.equipped(p),def=this.defs.weapons[item?.definitionId];requireThat(def&&!item.lockedBy,'INVALID_TARGET');requireThat(this.s.time>=p.equipUntil&&this.s.time>=p.fireAt,'BUSY');
    if(p.reload){requireThat(def.id==='shotgun'&&item.magazineAmmo>0,'BUSY');p.reload=null;}
    if(item.magazineAmmo<1){try{this.reload(p);}catch(error){if(!(error instanceof GameError))throw error;}throw new GameError('NO_AMMO');}
    item.magazineAmmo--;item.revision++;p.fireAt=this.s.time+60/def.rpm;this.s.statistics.shotsFired++;p.joinProtectionUntil=0;this.alertNoise(p,'shot');const shotId=this.id('shot');this.setAction(p,'fire',Math.min(.24,60/def.rpm),{shotId,definitionId:def.id,pelletCount:def.pellets});
    ads=ads&&p.input.ads===true&&this.s.time-(p.adsSince??this.s.time)>=(def.ads_seconds??.15);
    const camera={x:p.x,y:p.y+(p.crouching?1.05:this.c.player.camera_height),z:p.z},muzzle={x:p.x,y:p.y+(p.crouching?.85:1.05),z:p.z};
    const candidates=[...Object.values(this.s.enemies),...(this.s.friendlyFire?this.scenePlayers().filter(other=>other.id!==p.id&&other.lifeState!=='DEAD_WAIT'):[])];
    const center=target=>({x:target.x,y:target.y+(target.lifeState?(target.lifeState==='DOWNED'?.42:1.1):target.definitionId==='boss_crab'?1:.65),z:target.z});
    const radius=target=>target.lifeState?.55:target.radius;
    for(let pellet=0;pellet<def.pellets;pellet++){
      const spread=((ads?def.ads_spread_deg:def.hip_spread_deg)+(def.move_spread_deg??0)*clamp((p.moveSpeed??0)/2,0,1))*(p.crouching?.75:1)*Math.PI/180;
      const cameraDirection=aim(yaw+(this.rng('combat')*2-1)*spread,clamp(pitch+(this.rng('combat')*2-1)*spread,-1.5,1.5)),cameraBlock=this.rayBlock(camera,cameraDirection,def.range_end);let aimDistance=cameraBlock?.distance??def.range_end;
      for(const candidate of candidates){if(candidate.hp<=0&&candidate.lifeState!=='DOWNED')continue;const distance=raySphere(camera,cameraDirection,center(candidate),radius(candidate),aimDistance);if(distance!==null)aimDistance=Math.min(aimDistance,distance);}
      const aimPoint={x:camera.x+cameraDirection.x*aimDistance,y:camera.y+cameraDirection.y*aimDistance,z:camera.z+cameraDirection.z*aimDistance},direction=unit({x:aimPoint.x-muzzle.x,y:aimPoint.y-muzzle.y,z:aimPoint.z-muzzle.z});
      const maximum=Math.min(def.range_end,Math.hypot(aimPoint.x-muzzle.x,aimPoint.y-muzzle.y,aimPoint.z-muzzle.z)+.025),blocker=this.rayBlock(muzzle,direction,maximum);let closest=blocker?.distance??maximum,target=null;
      for(const candidate of candidates){if(candidate.hp<=0&&candidate.lifeState!=='DOWNED')continue;const distance=raySphere(muzzle,direction,center(candidate),radius(candidate),closest);if(distance!==null&&distance<closest){closest=distance;target=candidate;}}
      if(!target&&blocker&&this.s.destructibles?.[blocker.id])target=this.s.destructibles[blocker.id];
      const propTarget=target&&this.s.destructibles?.[target.id],to={x:muzzle.x+direction.x*closest,y:muzzle.y+direction.y*closest,z:muzzle.z+direction.z*closest};let surface=propTarget?this.propMaterial(propTarget):target?(target.lifeState?'player':'creature'):blocker?.surface??'air',normal=target&&!propTarget?unit({x:to.x-center(target).x,y:to.y-center(target).y,z:to.z-center(target).z}):blocker?.normal??{x:0,y:0,z:0},weak=false;
      if(target){const falloff=closest<=def.range_full?1:1-(1-def.range_end_multiplier)*clamp((closest-def.range_full)/(def.range_end-def.range_full),0,1);let multiplier=item.level>1?this.c.weapon_upgrade.damage_multiplier:1;
        if(target.definitionId==='boss_crab'){const forward=aim(target.yaw,0),back=(p.x-target.x)*forward.x+(p.z-target.z)*forward.z<0;weak=target.weak&&back;multiplier*=weak?this.defs.creatures.boss_crab.weak_multiplier:this.defs.creatures.boss_crab.armor_multiplier;}
        this.damageQueue.push({target:target.id,damage:Math.max(1,Math.floor(def.damage*falloff*multiplier)),actorId:p.id,weaponId:def.id,shotId,direction,position:to,weak,pelletHits:1});}
      const payload={actorId:p.id,shotId,weapon:def.id,weaponId:def.id,definitionId:def.id,from:muzzle,to,targetId:target?.id??blocker?.id??null,surface,normal,pellet,pelletCount:def.pellets,recoilPitch:def.recoil_pitch_deg,recoilYaw:(this.rng('combat')*2-1)*def.recoil_yaw_deg};this.event('Shot',payload,p.id);
      if((!target||propTarget)&&surface!=='air')this.event('Impact',{...payload,position:to},blocker.id);
    }
  }
  melee(p,yaw,pitch) {
    requireThat(!p.carryingId,'BUSY');
    this.requireAction(p);const item=this.equipped(p),empty=!item;
    requireThat(!p.work&&!p.fishing&&!p.reload,'BUSY');
    requireThat(['weapon','rod','melee','quick'].includes(p.heldSlot)&&(empty||(p.heldSlot==='melee'&&item.definitionId==='knife'&&!item.lockedBy)),'INVALID_TARGET');
    requireThat(this.s.time>=p.equipUntil&&this.s.time>=p.meleeAt&&!p.meleePending,'BUSY');
    const def=empty?(this.c.unarmed??UNARMED_DEFAULTS):this.c.melee,definitionId=empty?'fist':'knife';
    p.meleeAt=this.s.time+def.cooldown_seconds;p.joinProtectionUntil=0;const shotId=this.id('melee');
    p.meleePending={at:this.s.time+def.windup_seconds,yaw,pitch,shotId,definitionId,itemId:item?.id??null,heldSlot:p.heldSlot,damage:def.damage,range:def.range,arc_deg:def.arc_deg};
    this.setAction(p,empty?'punch':'melee',def.cooldown_seconds,{shotId,definitionId});
  }
  resolveMelee(p,pending) {
    const definitionId=pending.definitionId??'knife',item=this.equipped(p),heldSlot=pending.heldSlot??'melee';
    if(!this.inScene(p)||!live(p)||p.swimming||p.work||p.fishing||p.reload||this.s.phase==='COMPLETE'||this.s.time<p.equipUntil||p.heldSlot!==heldSlot)return;
    if(definitionId==='fist'?!!item:(definitionId!=='knife'||item?.definitionId!=='knife'||item.lockedBy||(pending.itemId!==undefined&&item.id!==pending.itemId)))return;
    // Older saved knife windups did not capture parameters or item IDs.
    const fallback=definitionId==='fist'?(this.c.unarmed??UNARMED_DEFAULTS):this.c.melee;
    const def={damage:pending.damage??fallback.damage,range:pending.range??fallback.range,arc_deg:pending.arc_deg??fallback.arc_deg};
    const direction=aim(pending.yaw,0),candidates=[...Object.values(this.s.enemies),...Object.values(this.s.destructibles??{}).filter(prop=>!prop.broken),...(this.s.friendlyFire?this.scenePlayers().filter(q=>q.id!==p.id&&q.lifeState!=='DEAD_WAIT'):[])];let selected=null,nearest=Infinity;
    for(const target of candidates){const d=dist(p,target);if(d>def.range||d>=nearest||target.hp<=0&&target.lifeState!=='DOWNED')continue;const cosine=((target.x-p.x)*direction.x+(target.z-p.z)*direction.z)/Math.max(.01,d);if(cosine<Math.cos(def.arc_deg*Math.PI/360)||Math.abs(target.y-p.y)>2||!this.lineVisible(p,target))continue;nearest=d;selected=target;}
    if(selected){let multiplier=1,weak=false;if(selected.definitionId==='boss_crab'){const forward=aim(selected.yaw,0),back=(p.x-selected.x)*forward.x+(p.z-selected.z)*forward.z<0;weak=selected.weak&&back;multiplier=weak?this.defs.creatures.boss_crab.weak_multiplier:this.defs.creatures.boss_crab.armor_multiplier;}this.damageQueue.push({target:selected.id,damage:Math.max(1,Math.floor(def.damage*multiplier)),actorId:p.id,weaponId:definitionId,shotId:pending.shotId,direction:unit({x:selected.x-p.x,y:0,z:selected.z-p.z}),weak});}
    const surface=selected?(this.s.destructibles?.[selected.id]?this.propMaterial(selected):selected.lifeState?'player':'creature'):'air',from={x:p.x,y:p.y+1,z:p.z},to=selected?{x:selected.x,y:selected.y+.6,z:selected.z}:{x:p.x+direction.x*def.range,y:p.y+1,z:p.z+direction.z*def.range};
    this.event('Shot',{actorId:p.id,shotId:pending.shotId,weapon:definitionId,weaponId:definitionId,definitionId,targetId:selected?.id??null,pellet:0,pelletCount:1,from,to,surface},p.id);
    if(selected&&this.s.destructibles?.[selected.id])this.event('Impact',{actorId:p.id,shotId:pending.shotId,weapon:definitionId,weaponId:definitionId,targetId:selected.id,from,to,position:to,surface,normal:unit({x:p.x-selected.x,y:0,z:p.z-selected.z}),pellet:0,pelletCount:1},selected.id);
  }
  reactToHit(enemy,hit,direction) {
    if(enemy.definitionId==='boss_crab')return;
    const elite=this.defs.creatures[enemy.definitionId].tier==='elite',shielded=hit.shielded===true;
    if(this.s.time>=(enemy.staggerResistUntil??0)){enemy.hitStunRemaining=elite?.06:.12;enemy.staggerResistUntil=this.s.time+(elite?1.1:.7);}
    if(!hit.shotId||enemy.lastImpulseShotId!==hit.shotId){const factor=(hit.weaponId==='shotgun'?3.6:hit.weaponId==='knife'?2.5:2)*(elite?.4:1)*(shielded?.25:1);enemy.hitVelocity={x:direction.x*factor,z:direction.z*factor};enemy.lastImpulseShotId=hit.shotId??null;}
    if(elite&&this.s.time>=(enemy.poiseResistUntil??0)){
      enemy.poiseDamage=(this.s.time-(enemy.poiseAt??-100)>2?0:enemy.poiseDamage??0)+Math.max(0,hit.actualDamage??hit.damage);enemy.poiseAt=this.s.time;
      if(enemy.poiseDamage>=Math.max(18,enemy.maxHp*.2)&&['WINDUP','CHARGE'].includes(enemy.state)){
        enemy.state='STUNNED';enemy.phaseRemaining=.55;enemy.hitStunRemaining=0;enemy.poiseDamage=0;enemy.poiseResistUntil=this.s.time+4;enemy.attackZone=null;enemy.chargeRemaining=0;enemy.chargeHit=[];
        this.event('EnemyInterrupted',{enemyId:enemy.id,role:enemy.role,hitSeq:enemy.hitSeq,duration:.55,position:{x:enemy.x,y:enemy.y,z:enemy.z}},enemy.id);
      }
    }
  }
  enemyGroundHeight(enemy) {const def=this.defs.creatures[enemy.definitionId];return this.ground(enemy.x,enemy.z)+(enemy.source!=='fishing'&&def?.locomotion==='air'?def.hover_height:0);}
  updateHitReaction(enemy,dt) {
    const velocity=enemy.hitVelocity;if(velocity){this.move(enemy,velocity.x,velocity.z,dt,enemy.radius);enemy.y=this.enemyGroundHeight(enemy);const damping=Math.exp(-10*dt);velocity.x*=damping;velocity.z*=damping;if(Math.hypot(velocity.x,velocity.z)<.03)enemy.hitVelocity=null;}
    if((enemy.hitStunRemaining??0)>0){enemy.hitStunRemaining=Math.max(0,enemy.hitStunRemaining-dt);if(enemy.state==='WINDUP'&&enemy.attackZone)enemy.attackZone.endsAt+=dt;return true;}return false;
  }
  updateTurrets() {
    if(this.s.paused||this.s.phase==='COMPLETE'||this.s.buildings.core.hp<=0)return;
    const config=this.c.fortress,enemyCenter=e=>({x:e.x,y:e.y+(e.definitionId==='boss_crab'?1:.65),z:e.z});
    for(const turret of Object.values(this.s.turrets)){if(turret.hp<=0||turret.level===0||turret.ammo<=0||turret.lockedBy){turret.targetId=null;continue;}if(this.s.time<turret.fireAt){if(!this.s.enemies[turret.targetId])turret.targetId=null;continue;}turret.targetId=null;
      const from={x:turret.x,y:turret.y+config.muzzleHeight,z:turret.z},candidates=Object.values(this.s.enemies).filter(e=>e.hp>0&&['wild','night'].includes(e.source)&&dist(turret,e)<=config.range).sort((a,b)=>(a.definitionId==='boss_crab'?1:0)-(b.definitionId==='boss_crab'?1:0)||dist(turret,a)-dist(turret,b));
      for(const enemy of candidates){const center=enemyCenter(enemy),vector={x:center.x-from.x,y:center.y-from.y,z:center.z-from.z},length=Math.hypot(vector.x,vector.y,vector.z),direction=unit(vector),distance=raySphere(from,direction,center,enemy.radius,length)??length;if(this.rayBlock(from,direction,distance,turret.id))continue;
        // A friendly body or an angler's living catch blocks a clear firing lane.
        const obstructed=[...this.scenePlayers().filter(p=>p.lifeState!=='DEAD_WAIT'),...Object.values(this.s.enemies).filter(e=>e.id!==enemy.id&&e.hp>0)].some(entity=>raySphere(from,direction,entity.lifeState?{x:entity.x,y:entity.y+(entity.lifeState==='DOWNED'?.42:1.1),z:entity.z}:enemyCenter(entity),entity.lifeState?.55:entity.radius,distance-.01)!==null);if(obstructed)continue;
        turret.targetId=enemy.id;turret.yaw=Math.atan2(-vector.x,-vector.z);turret.ammo--;turret.revision++;turret.shotSeq++;turret.fireAt=this.s.time+config.shotInterval;const shotId=this.id('turret-shot'),to={x:from.x+direction.x*distance,y:from.y+direction.y*distance,z:from.z+direction.z*distance};let multiplier=1,weak=false;
        if(enemy.definitionId==='boss_crab'){const forward=aim(enemy.yaw,0);weak=enemy.weak&&((turret.x-enemy.x)*forward.x+(turret.z-enemy.z)*forward.z<0);multiplier=weak?this.defs.creatures.boss_crab.weak_multiplier:this.defs.creatures.boss_crab.armor_multiplier;}
        const damage=Math.max(1,Math.floor(config.levels[turret.level-1].damage*multiplier));this.damageQueue.push({target:enemy.id,actorId:turret.id,weaponId:'fortress_turret',damage,shotId,direction,position:to,weak});
        this.event('Shot',{actorId:turret.id,shotId,shotSeq:turret.shotSeq,weapon:'fortress_turret',weaponId:'fortress_turret',definitionId:'fortress_turret',from,to,targetId:enemy.id,surface:'creature',normal:unit({x:to.x-center.x,y:to.y-center.y,z:to.z-center.z}),pellet:0,pelletCount:1},turret.id);break;
      }
    }
  }
  resolveDamage() {
    const queued=this.damageQueue;this.damageQueue=[];const pending=[],groups=new Map();
    for(const hit of queued){const key=hit.shotId?`${hit.shotId}:${hit.target}`:null;if(key&&groups.has(key)){const group=groups.get(key);group.damage+=hit.damage;group.pelletHits=(group.pelletHits??1)+(hit.pelletHits??1);}else {const group={...hit};pending.push(group);if(key)groups.set(key,group);}}
    for(const hit of pending){const target=this.s.players[hit.target]??this.s.enemies[hit.target]??this.s.buildings[hit.target]??this.s.turrets[hit.target]??this.s.destructibles?.[hit.target];if(!target||(target.lifeState&&!this.inScene(target))||target.hp<=0&&target.lifeState!=='DOWNED')continue;
      const actor=this.s.players[hit.actorId]??this.s.enemies[hit.actorId]??this.s.turrets[hit.actorId],direction=unit(hit.direction??{x:target.x-(actor?.x??target.x),y:0,z:target.z-(actor?.z??target.z)}),targetKind=target.lifeState?'player':this.s.enemies[target.id]?'enemy':this.s.turrets[target.id]?'turret':this.s.destructibles?.[target.id]?'prop':'building';
      if(actor?.source==='practice'&&(targetKind!=='player'||!practiceEnemyInside(actor,target)))continue;
      const feedback={actorId:hit.actorId,targetId:target.id,targetKind,definitionId:target.definitionId??target.kind??'player',weaponId:hit.weaponId??actor?.definitionId??null,shotId:hit.shotId??null,direction,weak:hit.weak===true,shielded:hit.shielded===true,pelletHits:hit.pelletHits??1,position:hit.position??{x:target.x,y:target.y+(target.definitionId==='boss_crab'?1:.65),z:target.z}};
      if(target.lifeState){if(target.lifeState==='DEAD_WAIT')continue;if(this.s.players[hit.actorId]&&!this.s.friendlyFire)continue;if((target.joinProtectionUntil??0)>this.s.time||(target.lifeState==='DOWNED'&&(target.downedGraceRemaining??0)>0)){this.event('Hit',{...feedback,damage:0,killed:false,protected:true},target.id);continue;}target.damageAt=this.s.time;this.cancelRescueFor(target);this.cancelWork(target);this.cancelFishing(target,'受到伤害');if(target.lifeState==='DOWNED'){this.migrateLife(target);target.downedHp=Math.max(0,target.downedHp-hit.damage);target.selfReviveReadyIn=this.c.player.self_revive_quiet_seconds;target.hitSeq=(target.hitSeq??0)+1;target.hitAt=this.s.time;target.lastHitDirection=direction;target.downedRemaining=target.downedHp/target.downedBleedRate;this.setAction(target,'hurt',.18);this.event('Hit',{...feedback,damage:hit.damage,killed:target.downedHp<=0,hitSeq:target.hitSeq,hp:target.downedHp,maxHp:this.c.player.downed_hp,downed:true},target.id);if(target.downedHp<=0)this.die(target);continue;}this.setAction(target,'hurt',.15);}
      const hpBefore=target.hp;target.hp=Math.max(0,target.hp-hit.damage);target.revision=(target.revision??0)+1;target.hitSeq=(target.hitSeq??0)+1;target.hitAt=this.s.time;target.lastHitDirection=direction;
      if(targetKind==='enemy')this.aggro.damage(target,actor,Math.max(0,hpBefore-target.hp));
      if(targetKind==='enemy'){target.lastHitShielded=hit.shielded===true;target.lastHitHeavy=['shotgun','rifle','knife'].includes(hit.weaponId);}
      if(target.hp>0&&targetKind==='enemy'&&(this.s.players[hit.actorId]||this.s.turrets[hit.actorId]))this.reactToHit(target,{...hit,actualDamage:Math.max(0,hpBefore-target.hp)},direction);
      this.event('Hit',{...feedback,damage:hit.damage,killed:target.hp<=0,killingWeaponId:target.hp<=0?feedback.weaponId:null,hitSeq:target.hitSeq,actionSeq:target.lifeState?target.actionSeq:null,hitStunRemaining:target.hitStunRemaining??0,hp:target.hp,maxHp:target.maxHp??this.c.player.max_hp},target.id);
      if(target.hp<=0){if(target.lifeState){this.enterDowned(target);}else if(this.s.enemies[target.id])this.killEnemy(target,hit.actorId);else if(targetKind==='prop')this.breakProp(target,hit);else if(targetKind==='turret'){target.ammo=0;target.targetId=null;this.event('TurretChanged',{destroyed:true,targetId:target.id},target.id);}else {target.gateOpen=false;this.event('BuildingChanged',{destroyed:true},target.id);}}
    }
  }
  die(p) {
    if(p.lifeState==='DEAD_WAIT')return;
    this.cancelRescueFor(p);this.cancelWork(p);this.cancelFishing(p,'倒下了');p.reload=null;p.meleePending=null;p.lifeState='DEAD_WAIT';p.hp=0;p.input={};p.downedHp=0;p.downedRemaining=0;p.downedGraceRemaining=0;p.selfReviveReadyIn=0;p.respawnRemaining=this.s.phase==='NIGHT'?0:this.c.player.day_respawn_seconds;this.s.statistics.deaths++;
    if(this.mode==='mission'){p.respawnRemaining=5;this.event('LifeChanged',{state:'DEAD_WAIT'},p.id);return;}
    const sources=[this.bag(p),...Object.values(p.equipment).map(id=>this.s.containers[id])];const ids=sources.flatMap(c=>c.itemIds);
    if(ids.length){const corpse=this.createContainer('corpse',ids.length,{ownerSlotId:p.slotId,x:p.x,y:p.y,z:p.z,createdDay:this.s.dayIndex,expiresAfterDay:this.s.dayIndex+this.c.recovery.bag_retention_days});for(const source of sources)for(const id of [...source.itemIds]){const item=this.s.items[id];delete item.lockedBy;source.itemIds=source.itemIds.filter(x=>x!==id);corpse.itemIds.push(id);item.containerId=corpse.id;item.revision++;source.revision++;}}
    this.event('LifeChanged',{state:'DEAD_WAIT'},p.id);this.requestSave=true;
  }
  respawn(p,emergency=false) { const position=emergency?this.location('emergency'):this.staticWorld().spawn;Object.assign(p,{x:position.x,y:position.y,z:position.z,lifeState:'ALIVE',hp:this.c.player.max_hp,stamina:this.c.player.stamina_max,oxygen:this.c.player.oxygen_seconds,respawnRemaining:0,downedHp:0,downedRemaining:0,downedGraceRemaining:0,selfReviveReadyIn:0,swimming:false,vy:0,input:{},jumpQueued:false});this.event('LifeChanged',{state:'ALIVE',respawn:true},p.id); }
  spawnEnemy(definitionId,x,z,night=false,multiplier=1) {
    const def=this.defs.creatures[definitionId],enemy={id:this.id('enemy'),definitionId,x,y:this.ground(x,z),z,yaw:0,hp:Math.ceil(def.hp*multiplier),maxHp:Math.ceil(def.hp*multiplier),state:'CHASE',phaseRemaining:0,night,radius:definitionId==='boss_crab'?def.collision_radius:.6,weak:false,attackRadius:def.attack_range??0,attackKind:'melee',revision:1,homeX:x,homeZ:z,targetId:null,attackIndex:0,damageMultiplier:1,lostSight:0,stuckTime:0,hitSeq:0,hitAt:-100,lastHitDirection:{x:0,y:0,z:0},hitStunRemaining:0,hitResistance:definitionId==='boss_crab'?1:.7};
    Object.assign(enemy,{source:night?'night':'wild',ownerId:null,zoneId:night?null:this.nearestZone(enemy)?.id??null,alertState:'patrol',patrolIndex:0});this.s.enemies[enemy.id]=enemy;this.event('Spawned',{kind:'enemy',definitionId},enemy.id);return enemy;
  }
  killEnemy(enemy,actorId) { if(!this.s.enemies[enemy.id])return;this.s.statistics.kills++;const loot=enemy.source==='fishing'?this.c.fishing.open_water.loot:this.defs.creatures[enemy.definitionId].loot;let lootContainerId=null;if(!enemy.night&&loot){const box=this.createContainer('loot',1,{x:enemy.x,y:this.ground(enemy.x,enemy.z),z:enemy.z,source:enemy.source,createdDay:this.s.dayIndex,expiresAfterDay:this.s.dayIndex+this.c.recovery.bag_retention_days});this.createItem(loot,1,box);this.containerContent(box);lootContainerId=box.id;}if(enemy.definitionId==='boss_crab')this.bossReward(enemy,actorId);delete this.s.enemies[enemy.id];this.aggro.forget(enemy.id);this.event('Removed',{kind:'enemy',actorId,lootContainerId},enemy.id); }
  enemyDefinition(enemy) { const def=this.defs.creatures[enemy.definitionId];return enemy.source==='fishing'?{...def,...this.c.fishing.open_water,aggressive:true}:enemy.source==='practice'?{...def,speed:Math.max(1.2,def.speed??0)}:def; }
  bossReward(enemy,actorId) {
    const night=this.s.night,key=`boss-reward:${night.id}`;
    if(!night.id||night.bossId!==enemy.id||night.rewardClaimed||this.s.resultLedger.includes(key))return;
    night.bossDefeated=true;night.rewardClaimed=true;this.s.resultLedger.push(key);
    const c=this.c.encounters.nightly_boss,box=this.createContainer('loot',2,{x:enemy.x,y:enemy.y,z:enemy.z,source:'boss',createdDay:this.s.dayIndex,expiresAfterDay:this.s.dayIndex+this.c.recovery.bag_retention_days});this.createItem(c.reward_item,1,box);this.addItems(box,'scrap',c.reward_scrap);this.containerContent(box);night.rewardContainerId=box.id;
    if(this.s.threatStage>=4&&!this.s.statistics.stage4BossDefeated){this.s.statistics.stage4BossDefeated=true;this.event('Notice',{code:'STAGE_FOUR_MILESTONE',message:'击败四阶首领！冒险仍将继续'});}
    this.requestSave=true;this.event('BossReward',{actorId,enemyId:enemy.id,lootContainerId:box.id,definitionId:c.reward_item,nightId:night.id},enemy.id);
  }
  alertNoise(p,reason) {
    if(!['PREP','DAY','RETURN','RECOVERY'].includes(this.s.phase))return;
    const config=this.c.encounters.guard_alert,archive=this.c.destructibles.archive,radius=reason==='shot'?config.shot_radius:reason==='archive_search'?archive.search_radius:reason==='archive_break'?archive.break_radius:config.search_radius,ids=[];
    for(const enemy of Object.values(this.s.enemies)){if(enemy.source!=='wild'||enemy.night||enemy.hp<=0||dist(enemy,p)>radius)continue;enemy.investigateX=p.x;enemy.investigateZ=p.z;enemy.alertUntil=this.s.time+config.investigate_seconds;enemy.alertState='investigate';ids.push(enemy.id);}
    if(ids.length)this.event('Alert',{actorId:p.id,reason,position:{x:p.x,y:p.y,z:p.z},enemyIds:ids,zoneId:this.nearestZone(p)?.id??null},p.id);
  }
  patrolEnemy(enemy,def,dt) {
    enemy.targetId=null;enemy.state='CHASE';const home={x:enemy.homeX,z:enemy.homeZ},config=this.c.encounters.guard_alert,leash=this.aggro.leash(enemy);
    const remembered=this.aggro.returnPoint(enemy);let target=remembered??home;enemy.alertState=this.aggro.state(enemy).returning?'returning':remembered?'investigate':'patrol';
    if(!remembered&&['wild','practice'].includes(enemy.source)&&dist(enemy,home)<leash){
      if((enemy.alertUntil??0)>this.s.time){target={x:enemy.investigateX,z:enemy.investigateZ};const length=dist(target,home);if(length>leash-1){target={x:home.x+(target.x-home.x)/length*(leash-1),z:home.z+(target.z-home.z)/length*(leash-1)};}enemy.alertState='investigate';}
      else {const angle=(enemy.patrolIndex??0)*Math.PI/2;target={x:home.x+Math.sin(angle)*config.patrol_radius,z:home.z+Math.cos(angle)*config.patrol_radius};if(dist(enemy,target)<.6||(enemy.patrolBlocked??0)>2){enemy.patrolIndex=((enemy.patrolIndex??0)+1)%4;enemy.patrolBlocked=0;}}
    }
    if(dist(enemy,target)<.35)return;
    if(!this.navigateEnemy(enemy,target,def.speed*.65,dt))enemy.patrolBlocked=(enemy.patrolBlocked??0)+dt;else enemy.patrolBlocked=0;
  }
  selectEnemyTarget(enemy) {
    return this.aggro.select(enemy);
  }
  navigationGeometry(refresh=false) {
    if(!refresh&&this.navGeometry?.tick===this.s.tick)return this.navGeometry;
    const boxes=this.boxes(),before=this.navGeometry?.boxes;
    const unchanged=before?.length===boxes.length&&boxes.every((b,i)=>b===before[i]||['id','x0','x1','y0','y1','z0','z1'].every(key=>b[key]===before[i][key]));
    if(!unchanged)this.navRevision=(this.navRevision??0)+1;
    this.navGeometry={tick:this.s.tick,boxes,key:this.navRevision};return this.navGeometry;
  }
  navigationTraverse(a,b,radius,enemy) {
    const length=dist(a,b);if(length<1e-7)return true;
    const steps=Math.max(1,Math.ceil(length/.5));let prior=this.ground(a.x,a.z);
    // Match the physical capsule and terrain checks. Check the whole edge,
    // including diagonal corners, before passing one speed-limited step to move.
    for(let i=1;i<=steps;i++){
      const t=i/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,y=this.ground(x,z);
      if(y-prior>.75||Math.hypot(x,z)>this.c.level.boundary_radius-radius)return false;prior=y;
    }
    const hover=this.enemyGroundHeight(enemy)-this.ground(enemy.x,enemy.z),from={x:a.x,y:this.ground(a.x,a.z)+hover,z:a.z},to={x:b.x,y:this.ground(b.x,b.z)+hover,z:b.z},delta={x:to.x-from.x,y:to.y-from.y,z:to.z-from.z};
    for(const box of this.navigationGeometry().boxes){
      if(box.id===enemy.id)continue;
      const epsilon=1e-6,expanded={x0:box.x0-radius+epsilon,x1:box.x1+radius-epsilon,z0:box.z0-radius+epsilon,z1:box.z1+radius-epsilon,y0:box.y0-1.6+epsilon,y1:box.y1-epsilon};
      if(rayBox(from,delta,expanded,1)!==null)return false;
    }
    return true;
  }
  enemyRouteBlock(enemy,target,maximum=2.5) {
    if(!target)return null;
    const length=dist(enemy,target);if(length<.01)return null;
    const direction={x:(target.x-enemy.x)/length,y:0,z:(target.z-enemy.z)/length};let first=null;
    for(const box of this.navigationGeometry(true).boxes){
      const epsilon=1e-6,expanded={x0:box.x0-enemy.radius+epsilon,x1:box.x1+enemy.radius-epsilon,z0:box.z0-enemy.radius+epsilon,z1:box.z1+enemy.radius-epsilon,y0:box.y0-1.6+epsilon,y1:box.y1-epsilon};
      const distance=rayBox(enemy,direction,expanded,Math.min(length,maximum));
      if(distance!==null&&(!first||distance<first.distance))first={id:box.id,distance};
    }
    return first;
  }
  enemyRouteTarget(enemy,target) {
    if(enemy.source==='practice')return target;
    // Narrow actors can use the open doorway; a capsule wider than the
    // opening still has to break the gate instead of clipping its posts.
    if(enemy.night&&target?.definitionId==='gate'&&target.gateOpen&&enemy.radius<1.2)target=this.s.buildings.core;
    const first=this.enemyRouteBlock(enemy,target);
    const obstacle=this.s.destructibles?.[first?.id]??this.s.buildings[first?.id]??this.s.turrets[first?.id];
    return obstacle?.hp>0&&!obstacle.broken&&!(obstacle.definitionId==='gate'&&obstacle.gateOpen&&enemy.radius<1.2)&&this.lineVisible(enemy,obstacle)?obstacle:target;
  }
  routeAttack(enemy,target,def) {
    const obstacle=id=>this.s.destructibles?.[id]??this.s.buildings[id]??this.s.turrets[id];
    const inReach=t=>this.navigationGeometry().boxes.some(b=>b.id===t.id&&Math.hypot(enemy.x-clamp(enemy.x,b.x0,b.x1),enemy.z-clamp(enemy.z,b.z0,b.z1))<=enemy.radius+.85);
    if(enemy.state==='WINDUP'&&enemy.attackKind==='clear_route'){
      if(enemy.phaseRemaining<=0){
        const actual=obstacle(enemy.targetId);
        if(actual?.hp>0&&!actual.broken&&!(actual.definitionId==='gate'&&actual.gateOpen&&enemy.radius<1.2)&&inReach(actual)&&this.lineVisible(enemy,actual))this.damageQueue.push({target:actual.id,damage:Math.ceil((enemy.role==='breaker'?(def.building_damage??def.damage):def.damage)*(enemy.damageMultiplier??1)),actorId:enemy.id});
        enemy.state='RECOVER';enemy.phaseRemaining=def.attack_cooldown;enemy.attackZone=null;
      }
      return true;
    }
    // Only the immediate solid on this route becomes a melee target. In
    // particular ranged, support and area-effect roles cannot farm nearby props.
    if(!target||obstacle(target.id)!==target||(target.definitionId==='gate'&&target.gateOpen&&enemy.radius<1.2)||!inReach(target)||!this.lineVisible(enemy,target))return false;
    enemy.targetId=target.id;enemy.yaw=Math.atan2(-(target.x-enemy.x),-(target.z-enemy.z));
    enemy.state='WINDUP';enemy.phaseRemaining=Math.max(.35,def.attack_windup);enemy.attackKind='clear_route';enemy.attackRadius=enemy.radius+.85;
    enemy.lockX=target.x;enemy.lockY=target.y+1;enemy.lockZ=target.z;
    enemy.attackZone={shape:'circle',x:target.x,y:target.y,z:target.z,radius:.7,endsAt:this.s.time+enemy.phaseRemaining};return true;
  }
  navigateEnemy(enemy,target,speed,dt) {
    const geometry=this.navigationGeometry(true);
    this.navigation??=new EnemyNavigation({canTraverse:(a,b,r,e)=>this.navigationTraverse(a,b,r,e),projectPoint:p=>({...p,y:this.ground(p.x,p.z)})});
    const goal={x:target.x,y:this.ground(target.x,target.z),z:target.z},targetBoxes=geometry.boxes.filter(b=>b.id===target.id);
    // A solid target has many legal attack positions. Search for any reachable
    // one, rather than a single front-side point hidden inside another rock.
    const hover=this.enemyGroundHeight(enemy)-this.ground(enemy.x,enemy.z);
    const baseBoss=!enemy.variantId||enemy.variantId==='base',bossDef=this.defs.creatures.boss_crab;
    const slamNext=enemy.hp<=enemy.maxHp*.5?enemy.attackIndex%3===0:enemy.attackIndex%2===0;
    const bossReach=baseBoss?(slamNext?bossDef.slam_radius+(target.lifeState?0:1.5):8):9;
    const isGoal=targetBoxes.length?point=>{
      const inRange=enemy.definitionId==='boss_crab'?dist(point,target)<=bossReach:targetBoxes.some(b=>Math.hypot(point.x-clamp(point.x,b.x0,b.x1),point.z-clamp(point.z,b.z0,b.z1))<=enemy.radius+.85);
      return inRange&&this.lineVisible({...point,y:this.ground(point.x,point.z)+hover},target);
    }:null;
    const finishPoint=targetBoxes.length?point=>{
      const length=dist(point,target);if(length>6||length<.01)return null;
      const from={...point,y:this.ground(point.x,point.z)+hover},direction={x:(target.x-point.x)/length,y:0,z:(target.z-point.z)/length};let stop=length;
      for(const box of targetBoxes){
        const margin=enemy.radius+.1,t=rayBox(from,direction,{x0:box.x0-margin,x1:box.x1+margin,z0:box.z0-margin,z1:box.z1+margin,y0:box.y0-1.6,y1:box.y1},length);
        if(t!==null)stop=Math.min(stop,t);
      }
      return stop<length?{x:point.x+direction.x*stop,z:point.z+direction.z*stop}:null;
    }:null;
    const home=this.aggro.home(enemy),outside=!this.aggro.inside(enemy,enemy),limit=Math.max(this.aggro.leash(enemy),dist(enemy,home));
    const allowPoint=p=>Math.hypot(p.x,p.z)<=this.c.level.boundary_radius-enemy.radius&&(enemy.night||this.aggro.inside(enemy,p)||(outside&&dist(p,home)<=limit+.05));
    const route=this.navigation.next({enemy,goal,goalKey:target.id??`${enemy.alertState}:${target.x.toFixed(1)},${target.z.toFixed(1)}`,geometryRevision:geometry.key,tick:this.s.tick,now:this.s.time,allowPoint,isGoal,finishPoint});
    if(!route.waypoint){enemy.stuckTime=(enemy.stuckTime??0)+dt;return false;}
    const waypoint=route.waypoint,distance=dist(enemy,waypoint),amount=Math.min(speed*dt,distance);if(amount<=1e-6)return false;
    const dx=(waypoint.x-enemy.x)/distance,dz=(waypoint.z-enemy.z)/distance,before={x:enemy.x,z:enemy.z};
    enemy.yaw=Math.atan2(-dx,-dz);this.move(enemy,dx*amount/dt,dz*amount/dt,dt,enemy.radius);enemy.y=this.enemyGroundHeight(enemy);
    if(dist(before,enemy)<1e-7){enemy.stuckTime=(enemy.stuckTime??0)+dt;this.navigation.invalidate(enemy.id);return false;}
    enemy.stuckTime=0;return true;
  }
  updateEnemy(enemy,dt) {
    if(this.updateHitReaction(enemy,dt))return;
    if(this.aggro.returnGate(enemy)){
      if(['STUNNED','RECOVER'].includes(enemy.state)){enemy.phaseRemaining=Math.max(0,enemy.phaseRemaining-dt);if(enemy.phaseRemaining<=0)enemy.state='CHASE';return;}
      enemy.state='CHASE';enemy.phaseRemaining=0;enemy.attackZone=null;this.patrolEnemy(enemy,this.enemyDefinition(enemy),dt);return;
    }
    const def=this.enemyDefinition(enemy),ranged=enemy.definitionId==='eel'&&enemy.source!=='fishing';if(!def.aggressive){if(enemy.source==='practice')this.patrolEnemy(enemy,def,dt);return;}
    if(enemy.definitionId==='boss_crab'){this.updateBoss(enemy,dt);return;}
    enemy.phaseRemaining=Math.max(0,enemy.phaseRemaining-dt);
    if(enemy.state==='burrow_windup'){delete enemy.rescuePosition;enemy.state='CHASE';enemy.stuckTime=0;return;}
    if(enemy.state==='STUNNED'||enemy.state==='RECOVER'){if(enemy.phaseRemaining<=0)enemy.state='CHASE';return;}
    if(this.routeAttack(enemy,null,def))return;
    if(enemy.state==='WINDUP'){
      const playerTarget=this.s.players[enemy.targetId],target=(this.inScene(playerTarget)?playerTarget:null)??this.s.buildings[enemy.targetId]??this.s.turrets[enemy.targetId];
      if(enemy.source==='practice'&&(!target||!practiceEnemyInside(enemy,target))){enemy.state='CHASE';enemy.attackZone=null;enemy.targetId=null;return;}
      if(enemy.phaseRemaining>.3&&target){enemy.lockX=target.x;enemy.lockY=target.y+1;enemy.lockZ=target.z;enemy.yaw=Math.atan2(-(target.x-enemy.x),-(target.z-enemy.z));}
      if(enemy.phaseRemaining<=0){
        if(ranged&&Object.keys(this.s.projectiles).length<(this.c.director?.budgets.maxProjectiles??64)){
          const from={x:enemy.x,y:enemy.y+.85,z:enemy.z},length=Math.hypot(enemy.lockX-from.x,enemy.lockY-from.y,enemy.lockZ-from.z)||1;
          const projectile={id:this.id('projectile'),...from,vx:(enemy.lockX-from.x)/length*def.projectile_speed,vy:(enemy.lockY-from.y)/length*def.projectile_speed,vz:(enemy.lockZ-from.z)/length*def.projectile_speed,radius:def.projectile_radius,damage:Math.ceil(def.damage*enemy.damageMultiplier),actorId:enemy.id,life:4,practiceZone:enemy.practiceZone??null};this.s.projectiles[projectile.id]=projectile;
        }else if(!ranged&&target&&dist(enemy,target)<=def.attack_range+.6&&this.lineVisible(enemy,target)){const forward=aim(enemy.yaw,0),targetDistance=Math.max(.01,dist(enemy,target));if(((target.x-enemy.x)*forward.x+(target.z-enemy.z)*forward.z)/targetDistance>=.5)this.damageQueue.push({target:target.id,damage:Math.ceil(def.damage*enemy.damageMultiplier),actorId:enemy.id});}
        enemy.state='RECOVER';enemy.phaseRemaining=def.attack_cooldown;
      }
      return;
    }
    let target=this.enemyRouteTarget(enemy,this.selectEnemyTarget(enemy));
    if(!target){enemy.lostSight+=dt;if(!enemy.night)this.patrolEnemy(enemy,def,dt);return;}
    enemy.alertState='chase';enemy.lostSight=0;enemy.targetId=target.id;const dx=target.x-enemy.x,dz=target.z-enemy.z,d=Math.hypot(dx,dz)||1;enemy.yaw=Math.atan2(-dx,-dz);
    if(this.routeAttack(enemy,target,def))return;
    if(ranged&&target.lifeState&&d<8){const retreat={id:`retreat:${target.id}`,x:enemy.x-dx/d*2-dz/d*.7,z:enemy.z-dz/d*2+dx/d*.7};if(this.navigateEnemy(enemy,retreat,def.speed,dt))return;}
    const reach=(ranged&&target.lifeState?Math.min(12,def.attack_range):def.attack_range)+(target.definitionId==='core'?1.5:target.socketId?.startsWith('W')?.2:0);
    if(d<=reach&&this.lineVisible(enemy,target)){enemy.state='WINDUP';enemy.phaseRemaining=def.attack_windup;enemy.attackKind=ranged?'projectile':'melee';enemy.attackRadius=def.attack_range;enemy.lockX=target.x;enemy.lockY=target.y+1;enemy.lockZ=target.z;return;}
    this.navigateEnemy(enemy,target,def.speed,dt);
  }
  bossRouteTarget(boss,target) {
    return this.enemyRouteTarget(boss,target);
  }
  bossAttackObjects(boss) {
    if(boss.source==='practice')return [];
    // Breaking a route obstruction uses the same damage/loot transaction as a
    // player strike. Do not sweep unrelated scene props into every area attack.
    const prop=this.s.destructibles?.[boss.targetId];
    return [...Object.values(this.s.buildings),...Object.values(this.s.turrets),...(prop?.hp>0&&!prop.broken?[prop]:[])];
  }
  moveBoss(boss,target,dt) {
    this.navigateEnemy(boss,target,this.defs.creatures.boss_crab.speed,dt);
  }
  updateBoss(boss,dt) {
    const def=this.defs.creatures.boss_crab,practice=boss.source==='practice',practiceTarget=practice?this.selectEnemyTarget(boss):null;
    if(practice&&!practiceTarget){boss.state='CHASE';boss.phaseRemaining=0;boss.attackZone=null;boss.chargeRemaining=0;this.patrolEnemy(boss,def,dt);return;}
    if(boss.state==='CHASE'||boss.state==='RECOVER')boss.combatPhase=boss.hp<=boss.maxHp*.5?2:1;
    if(!practice&&boss.hp<=boss.maxHp*.5&&!this.s.night.addsSpawned)boss.addsPending=true;
    boss.phaseRemaining=Math.max(0,boss.phaseRemaining-dt);
    if(boss.state==='WEAK'){boss.weak=true;if(boss.phaseRemaining<=0){boss.weak=false;boss.state='RECOVER';boss.phaseRemaining=2;}return;}
    if(boss.state==='RECOVER'){if(boss.phaseRemaining<=0){if(!practice&&boss.addsPending&&!this.s.night.addsSpawned){this.s.night.addsSpawned=true;for(let i=0;i<this.c.waves[3].adds_crab_per_player*this.s.night.playerCount;i++)this.s.night.pending.push({definitionId:'crab',at:this.s.phaseElapsed+i*this.s.night.spawnInterval,entry:i%3});}boss.state='CHASE';}return;}
    if(boss.state==='WINDUP'){
      if(boss.phaseRemaining<=0){if(boss.attackKind==='slam'){
        for(const p of this.scenePlayers())if(p.lifeState!=='DEAD_WAIT'&&(!practice||practiceEnemyInside(boss,p))&&dist(p,boss)<=def.slam_radius&&this.lineVisible(boss,p))this.damageQueue.push({target:p.id,damage:def.slam_player_damage,actorId:boss.id});
        for(const b of this.bossAttackObjects(boss))if(b.hp>0&&dist(b,boss)<=def.slam_radius+1.5&&this.lineVisible(boss,b))this.damageQueue.push({target:b.id,damage:def.slam_building_damage,actorId:boss.id});
        this.event('EnemyAttackResolved',{enemyId:boss.id,attackKind:'slam',zone:{shape:'circle',x:boss.x,y:boss.y,z:boss.z,radius:def.slam_radius},position:{x:boss.x,y:boss.y,z:boss.z}},boss.id);
        boss.state='WEAK';boss.weak=true;boss.phaseRemaining=def.weak_seconds;
      }else {boss.state='CHARGE';boss.chargeRemaining=def.charge_range;boss.chargeHit=[];}}
      return;
    }
    if(boss.state==='CHARGE'){
      const direction=aim(boss.yaw,0),step=Math.min(10*dt,boss.chargeRemaining),next={x:boss.x+direction.x*step,z:boss.z+direction.z*step},block=this.enemyRouteBlock(boss,next,step),travel=block?Math.max(0,block.distance-.01):step;
      if(practice&&!practiceEnemyInside(boss,next)){boss.state='WEAK';boss.weak=true;boss.phaseRemaining=def.weak_seconds;boss.chargeRemaining=0;return;}
      this.move(boss,direction.x*travel/dt,direction.z*travel/dt,dt,boss.radius);boss.y=this.enemyGroundHeight(boss);boss.chargeRemaining-=travel;
      for(const p of this.scenePlayers()){if(p.lifeState==='DEAD_WAIT'||practice&&!practiceEnemyInside(boss,p)||boss.chargeHit.includes(p.id)||dist(p,boss)>1.7||!this.lineVisible(boss,p))continue;boss.chargeHit.push(p.id);this.damageQueue.push({target:p.id,damage:def.charge_damage,actorId:boss.id});}
      if(!practice&&block&&(this.s.buildings[block.id]||this.s.turrets[block.id]||this.s.destructibles?.[block.id])&&!boss.chargeHit.includes(block.id)){boss.chargeHit.push(block.id);this.damageQueue.push({target:block.id,damage:90,actorId:boss.id});}
      if(block||boss.chargeRemaining<=0){boss.state='WEAK';boss.weak=true;boss.phaseRemaining=def.weak_seconds;}return;
    }
    const target=this.bossRouteTarget(boss,practice?practiceTarget:this.selectEnemyTarget(boss)??this.s.buildings.core),dx=target.x-boss.x,dz=target.z-boss.z,d=Math.hypot(dx,dz)||1;boss.targetId=target.id;boss.yaw=Math.atan2(-dx,-dz);
    const slamNext=boss.combatPhase===2?boss.attackIndex%3===0:boss.attackIndex%2===0;
    if(d<=(slamNext?def.slam_radius+(target.lifeState?0:1.5):8)&&this.lineVisible(boss,target)){boss.attackIndex++;boss.attackKind=slamNext?'slam':'charge';boss.attackRadius=slamNext?def.slam_radius:1;boss.state='WINDUP';boss.phaseRemaining=slamNext?def.slam_windup:def.charge_windup;boss.attackZone={shape:slamNext?'circle':'line',x:boss.x,y:boss.y,z:boss.z,yaw:boss.yaw,radius:def.slam_radius,length:def.charge_range,width:3.4,endsAt:this.s.time+boss.phaseRemaining};return;}
    this.moveBoss(boss,target,dt);
  }
  updateProjectiles(dt) {
    for(const projectile of Object.values(this.s.projectiles)){
      const practice=projectile.practiceZone?{practiceZone:projectile.practiceZone}:null;
      if(practice&&!practiceEnemyInside(practice,projectile)){delete this.s.projectiles[projectile.id];continue;}
      if(!Number.isFinite(projectile.spawnAt)){projectile.spawnAt=this.s.time-dt;projectile.from={x:projectile.x,y:projectile.y,z:projectile.z};}
      const length=Math.hypot(projectile.vx,projectile.vy,projectile.vz)*dt,direction={x:projectile.vx*dt/(length||1),y:projectile.vy*dt/(length||1),z:projectile.vz*dt/(length||1)};let hit=this.rayBlock(projectile,direction,length),targetId=practice?null:this.s.buildings[hit?.id]||this.s.turrets[hit?.id]||(projectile.definitionId==='power_bolt'&&this.s.destructibles?.[hit?.id])?hit.id:null,closest=hit?.distance??length;
      for(const p of this.scenePlayers()){if(p.lifeState==='DEAD_WAIT'||practice&&!practiceEnemyInside(practice,p))continue;const t=raySphere(projectile,direction,{x:p.x,y:p.y+(p.lifeState==='DOWNED'?.42:1),z:p.z},.5+projectile.radius,closest);if(t!==null){closest=t;targetId=p.id;hit={distance:t};}}
      if(targetId)this.damageQueue.push({target:targetId,damage:projectile.damage,actorId:projectile.actorId,slowSeconds:projectile.slowSeconds});
      projectile.life-=dt;if(hit||projectile.life<=0||practice&&!practiceEnemyInside(practice,{x:projectile.x+projectile.vx*dt,z:projectile.z+projectile.vz*dt})){
        const at={x:projectile.x+direction.x*closest,y:projectile.y+direction.y*closest,z:projectile.z+direction.z*closest};
        this.event('EnemyProjectileImpact',{projectileId:projectile.id,definitionId:projectile.definitionId??'electric_bolt',actorId:projectile.actorId,targetId:targetId??hit?.id??null,position:at,normal:hit?.normal??{x:-direction.x,y:-direction.y,z:-direction.z},surface:targetId?(this.s.players[targetId]?'player':this.s.destructibles?.[targetId]?this.propMaterial(this.s.destructibles[targetId]):'building'):hit?.surface??'air'},projectile.id);
        delete this.s.projectiles[projectile.id];
      }else {projectile.x+=projectile.vx*dt;projectile.y+=projectile.vy*dt;projectile.z+=projectile.vz*dt;}
    }
  }
  beginDayBarrier() {
    if(this.needsBarrier)return;
    for(const p of Object.values(this.s.players)){this.cancelWork(p);this.cancelFishing(p,'准备出发');}
    this.expireContainers();
    this.needsBarrier=true;this.requestSave=true;
  }
  expireContainers() { for(const container of Object.values(this.s.containers))if(container.expiresAfterDay!==undefined&&container.expiresAfterDay<=this.s.dayIndex){for(const id of [...container.itemIds])this.removeItem(this.s.items[id]);delete this.s.containers[container.id];} }
  retainFishingEnemies() { this.s.enemies=Object.fromEntries(Object.entries(this.s.enemies).filter(([,enemy])=>enemy.source==='fishing'&&enemy.hp>0)); }
  finishDayBarrier() { if(!this.needsBarrier)return;this.needsBarrier=false;this.s.lockedPlayerCount=Math.max(1,Object.values(this.s.players).filter(x=>x.connected).length);this.setPhase('DAY');this.generateDay(); }
  setPhase(phase) { this.alignClock(phase);this.s.phase=phase;this.s.phaseElapsed=0;if(phase==='RETURN')this.s.returnNotices=[];this.requestSave=true;this.event('PhaseChanged',{phase,dayIndex:this.s.dayIndex,threatStage:this.s.threatStage}); }
  choosePoint(center,radius,used=[],minimumDistance=3,minimumCore=0,stream='nodes',waterY=this.s.waterY) {
    const valid=(x,z)=>{const y=this.ground(x,z),r=Math.hypot(x,z);return r>=minimumCore&&r<this.c.level.boundary_radius-5&&waterY-y<=.6&&!this.blocked(x,y,z,.7)&&!used.some(p=>Math.hypot(x-p.x,z-p.z)<minimumDistance);};
    for(let attempt=0;attempt<150;attempt++){const angle=this.rng(stream)*Math.PI*2,r=Math.sqrt(this.rng(stream))*radius,x=center.x+Math.sin(angle)*r,z=center.z+Math.cos(angle)*r;if(valid(x,z))return {x,y:this.ground(x,z),z};}
    // Bounded, deterministic backup grid on the same resource route, never a blocked center fallback.
    const candidates=[];for(let x=-32;x<=32;x+=8)for(let z=-32;z<=32;z+=8)candidates.push({x:center.x+x,z:center.z+z,d:x*x+z*z});candidates.sort((a,b)=>a.d-b.d);
    for(const point of candidates)if(valid(point.x,point.z))return {x:point.x,y:this.ground(point.x,point.z),z:point.z};
    throw Error('No reachable encounter backup point');
  }
  generateDay() {
    this.s.nodes={};this.retainFishingEnemies();this.s.projectiles={};this.generateDestructibles();const n=this.s.lockedPlayerCount,used=Object.values(this.s.enemies).map(e=>({x:e.x,z:e.z}));
    for(const pool of Object.values(this.s.pools))pool.quota=this.c.fishing.pools.find(p=>p.id===pool.type).quota_per_player*n;
    const zones=this.dangerZones();for(const type of ['crab','eel'])for(let i=0;i<this.c.encounters[`wild_${type}_per_player`]*n;i++){const center=zones[i%zones.length],point=this.choosePoint(center,n>4?22:14,used,8,45,'wildlife');used.push(point);const enemy=this.spawnEnemy(type,point.x,point.z);enemy.zoneId=center.id;}
    for(const kind of ['scrap','treasure'])for(let i=0;i<(kind==='scrap'?this.c.encounters.scrap_nodes_per_player:this.c.encounters.treasure_caches_per_player)*n;i++){
      const center=zones[i%zones.length],point=this.choosePoint(center,18,used);used.push(point);const node={id:this.id('node'),kind,...point,zoneId:center.id,danger:true,state:'available',revision:1};this.s.nodes[node.id]=node;
    }
  }
  startNight() {
    for(const p of Object.values(this.s.players)){this.cancelWork(p);this.cancelFishing(p,'夜潮来袭');p.revivesUsed=0;p.reload=null;if(p.lifeState==='DEAD_WAIT')p.respawnRemaining=0;}
    this.retainFishingEnemies();this.s.projectiles={};
    const gates=Object.values(this.s.buildings).filter(gate=>gate.definitionId==='gate'&&gate.hp>0&&gate.gateOpen);
    if(gates.length){
      const clearance=this.previewPlayerClearance(gates.map(entity=>({entity,changes:{gateOpen:false}})));
      if(clearance){
        for(const gate of gates){gate.gateOpen=false;gate.revision++;}
        this.applyPlayerClearance(clearance);
      }else this.event('Notice',{code:'NIGHT_GATE_BLOCKED',message:'门边没有安全位置，已保持开门，请让开后手动关门'});
    }
    this.setPhase('NIGHT');const n=Math.max(1,Object.values(this.s.players).filter(p=>p.connected).length),stage=Math.min(3,this.s.threatStage),wave=this.c.waves.find(w=>w.stage===stage),growth=this.c.encounters.nightly_boss,difficulty=this.difficultyFor(n);this.s.pressureDay=difficulty.pressureDay;
    this.s.night={id:this.id('night'),waveIndex:0,pending:[],spawned:0,remaining:0,bossId:null,addsSpawned:false,nextSpawnAt:0,resolved:false,bossDefeated:false,rewardClaimed:false,playerCount:n,pressureDay:difficulty.pressureDay,aliveCap:difficulty.aliveCap,spawnInterval:difficulty.spawnInterval,bossHp:difficulty.bossHp};
    const position=this.location('night_south'),boss=this.spawnEnemy('boss_crab',position.x,position.z,true);boss.hp=boss.maxHp=difficulty.bossHp;this.s.night.bossId=boss.id;this.s.night.spawned=1;
    {const countFactor=(1+this.c.encounters.ordinary_count_player_factor*(n-1))*Math.min(growth.count_growth_cap,1+growth.count_daily_growth*(difficulty.pressureDay-1)),counts={crab:Math.ceil(wave.base_crab*countFactor),eel:Math.ceil(wave.base_eel*countFactor)},list=[];while(counts.crab>0||counts.eel>0){for(const type of ['crab','eel'])if(counts[type]>0){counts[type]--;list.push(type);}}
      list.forEach((definitionId,i)=>this.s.night.pending.push({definitionId,at:wave.spawn_seconds[i%3],entry:i%3}));this.s.night.pending.sort((a,b)=>a.at-b.at);const counters={};for(const entry of this.s.night.pending){entry.entry=(counters[entry.at]??0)%3;counters[entry.at]=(counters[entry.at]??0)+1;}}
  }
  updateNightQueue() {
    const night=this.s.night;night.pending.sort((a,b)=>a.at-b.at);
    if(night.pending.length&&night.pending[0].at<=this.s.phaseElapsed&&this.s.time>=night.nextSpawnAt&&Object.values(this.s.enemies).filter(e=>e.night).length<night.aliveCap){const entry=night.pending.shift(),position=this.location(['night_north','night_east','night_south'][entry.entry]),wave=this.c.waves.find(w=>w.stage===Math.min(3,this.s.threatStage)),enemy=this.spawnEnemy(entry.definitionId,position.x,position.z,true,wave.hp_multiplier);enemy.damageMultiplier=wave.damage_multiplier;night.spawned++;night.nextSpawnAt=this.s.time+night.spawnInterval;night.waveIndex=Math.min(3,Math.floor(this.s.phaseElapsed/35)+1);}
    night.remaining=Object.values(this.s.enemies).filter(e=>e.night).length+night.pending.length;
  }
  resolveNight() {
    const s=this.s;if(s.phase!=='NIGHT'||s.night.resolved)return;
    // All simultaneous damage resolves before this decision. A core loss always beats a boss kill.
    const online=Object.values(s.players).filter(p=>p.connected);if(s.buildings.core.hp<=0||(online.length>0&&online.every(p=>p.lifeState==='DEAD_WAIT'))){this.defeat();return;}
    const cleared=!!s.night.id&&!!s.night.bossId&&s.night.bossDefeated===true&&!s.enemies[s.night.bossId]&&s.night.pending.length===0&&!Object.values(s.enemies).some(e=>e.night&&e.hp>0);
    if(s.phaseElapsed>=this.phaseDuration('NIGHT')||cleared){
      s.night.resolved=true;
      if(s.resultLedger.includes(s.night.id))return;
      s.night.completedEarly=cleared&&s.phaseElapsed<this.phaseDuration('NIGHT');s.resultLedger.push(s.night.id);s.statistics.daysSurvived++;s.failureStreak=0;s.dayIndex++;s.threatStage=Math.min(4,s.threatStage+1);
      if(s.night.completedEarly)this.event('Notice',{code:'NIGHT_CLEARED',message:'夜袭全清，提前下班！'});
      this.toPrep(true);
    }
  }
  toPrep(revive=true) { this.retainFishingEnemies();this.s.projectiles={};this.s.waterY=this.c.cycle.low_water_y;for(const p of this.scenePlayers()){this.cancelWork(p);this.cancelFishing(p,'返回据点');p.ready=false;if(revive||p.lifeState!=='ALIVE')this.respawn(p);else {const spawn=this.staticWorld().spawn;p.x=spawn.x;p.y=spawn.y;p.z=spawn.z;}}for(const b of Object.values(this.s.buildings))if(b.definitionId==='gate'&&b.hp>0)b.gateOpen=true;this.setPhase('PREP'); }
  defeat() {
    const s=this.s;if(s.night.resolved||s.resultLedger.includes(s.night.id))return;s.night.resolved=true;s.resultLedger.push(s.night.id);s.statistics.breaches++;const defeatId=this.id('defeat');
    for(const p of this.scenePlayers()){this.die(p);this.respawn(p,true);p.ready=false;}
    for(const turret of Object.values(s.turrets)){turret.hp=0;turret.ammo=0;turret.targetId=null;turret.revision++;}
    s.enemies={};s.projectiles={};s.dayIndex++;s.failureStreak=(s.failureStreak??0)+1;s.waterY=this.c.cycle.low_water_y;
    const lostC=Math.ceil(s.bank.credits*this.c.recovery.warehouse_loss_fraction),lostM=Math.ceil(s.bank.materials*this.c.recovery.warehouse_loss_fraction);s.bank.credits-=lostC;s.bank.materials-=lostM;s.bank.revision++;
    const chest=this.createContainer('recovery',this.c.economy.storage_slots,{x:-4,y:this.ground(-4,3),z:3,createdDay:s.dayIndex,expiresAfterDay:s.dayIndex+this.c.recovery.bag_retention_days,recoverableC:Math.floor(lostC*this.c.recovery.lost_resource_recover_fraction),recoverableM:Math.floor(lostM*this.c.recovery.lost_resource_recover_fraction),defeatId});
    const stored=[...s.containers.storage.itemIds];for(let i=stored.length-1;i>0;i--){const j=Math.floor(this.rng('loss')*(i+1));[stored[i],stored[j]]=[stored[j],stored[i]];}
    for(const id of stored.slice(0,Math.ceil(stored.length*this.c.recovery.stored_stack_drop_fraction)))this.moveItem(s.items[id],chest);
    const sockets=BUILDING_SLOTS.map(b=>b.id);for(let i=sockets.length-1;i>0;i--){const j=Math.floor(this.rng('loss')*(i+1));[sockets[i],sockets[j]]=[sockets[j],sockets[i]];}const destroyedSockets=sockets.slice(0,this.c.recovery.damaged_sockets);
    for(const id of destroyedSockets){const b=s.buildings[id];b.level=1;b.maxHp=this.defs.buildings[b.definitionId].hp;b.hp=0;b.gateOpen=false;b.revision++;}s.buildings.core.hp=0;s.buildings.core.revision++;
    const debris=[];for(let i=0;i<this.c.recovery.debris_tasks;i++){const angle=Math.PI/4+i*Math.PI*2/this.c.recovery.debris_tasks,x=Math.cos(angle)*4.2,z=Math.sin(angle)*4.2;debris.push({id:this.id('debris'),x,y:this.ground(x,z),z,done:false,revision:1});}
    s.recovery={defeatId,destroyedSockets,debris,coreReady:false,duration:this.recoveryDuration()};this.alignClock('PREP');this.setPhase('RECOVERY');s.lockedPlayerCount=Math.max(1,this.scenePlayers().filter(p=>p.connected).length);this.expireContainers();this.generateDay();this.event('BreachResolved',{defeatId,lostC,lostM,chestId:chest.id,recoverySeconds:s.recovery.duration});
  }
  finishRecovery() {
    if(this.s.time<(this.s.recovery.clearanceRetryAt??0))return;
    for(const p of Object.values(this.s.players))this.cancelWork(p);
    if(this.s.buildings.core.hp<=0){const core=this.s.buildings.core,gates=Object.values(this.s.buildings).filter(g=>g.definitionId==='gate'),clearance=this.previewPlayerClearance([{entity:core,changes:{hp:1}},...gates.map(entity=>({entity,changes:{hp:Math.max(1,entity.hp),gateOpen:true}}))]);if(!clearance){this.s.recovery.clearanceRetryAt=this.s.time+1;if(this.s.time>=(this.s.recovery.clearanceNoticeAt??0)){this.s.recovery.clearanceNoticeAt=this.s.time+5;this.event('Notice',{code:'CLEAR_BUILDING_SPACE',message:'应急加固需要安全落脚位置，请队员离开残骸范围'});}return;}core.hp=Math.ceil(core.maxHp*.25);core.revision++;for(const gate of gates){gate.hp=Math.max(gate.hp,Math.ceil(gate.maxHp*.5));gate.gateOpen=true;gate.revision++;}this.applyPlayerClearance(clearance);this.s.recovery.coreReady=true;this.s.recovery.emergencyRestored=true;this.event('Notice',{code:'EMERGENCY_CORE_RESTORED',message:'应急加固已恢复最低协作灯与门，距夜袭还有60秒，请准备防守'});}
    this.setPhase('RETURN');
  }
  step(dt=1/this.c.session.server_hz) {
    if(this.s.paused||this.needsBarrier||this.s.phase==='COMPLETE')return;
    if(this.mode==='mission'){
      const s=this.s;s.tick++;s.time+=dt;s.phaseElapsed+=dt;
      for(const p of Object.values(s.players))this.updatePlayer(p,dt);
      for(const enemy of Object.values(s.enemies))this.updateEnemy(enemy,dt);
      this.updateProjectiles(dt);this.updateTurrets();this.resolveDamage();this.updateLife(dt);
      if(s.buildings.core.hp<=0){s.buildings.core.hp=1;s.buildings.core.revision++;}
      missionStep(this);return;
    }
    const s=this.s;s.tick++;s.time+=dt;s.calendar.minutes+=this.clockRate()*dt;
    s.phaseElapsed+=dt;
    if(s.phase==='RETURN'){s.waterY=this.c.cycle.low_water_y+(this.c.cycle.high_water_y-this.c.cycle.low_water_y)*clamp(s.phaseElapsed/this.phaseDuration('RETURN'),0,1);s.returnNotices??=[];for(const seconds of [30,10])if(this.phaseDuration('RETURN')-s.phaseElapsed<=seconds&&!s.returnNotices.includes(seconds)){s.returnNotices.push(seconds);this.event('Notice',{code:'RETURN_WARNING',seconds,message:`距离夜潮还剩${seconds}秒，请返回据点`});}}
    for(const p of Object.values(s.players))this.updatePlayer(p,dt);
    if(s.phase==='NIGHT')this.updateNightQueue();for(const enemy of Object.values(s.enemies))if(['DAY','RETURN','NIGHT','RECOVERY'].includes(s.phase)||enemy.source==='fishing')this.updateEnemy(enemy,dt);this.updateProjectiles(dt);
    this.updateTurrets();this.resolveDamage();this.updateLife(dt);
    if(s.phase==='PREP'&&s.phaseElapsed>=this.phaseDuration('PREP'))this.beginDayBarrier();
    else if(s.phase==='DAY'&&s.phaseElapsed>=this.phaseDuration('DAY')){this.setPhase('RETURN');}
    else if(s.phase==='RETURN'&&s.phaseElapsed>=this.phaseDuration('RETURN')){s.waterY=this.c.cycle.high_water_y;this.startNight();}
    else if(s.phase==='RECOVERY'&&s.phaseElapsed>=(s.recovery?.duration??this.recoveryDuration()))this.finishRecovery();
    if(s.phase==='NIGHT'){this.s.night.remaining=Object.values(s.enemies).filter(e=>e.night).length+s.night.pending.length;this.resolveNight();}
  }
  phaseDuration(phase=this.s.phase) {return this.director?.duration(phase)??({PREP:this.c.cycle.prep_seconds,DAY:this.c.cycle.day_seconds,RETURN:this.c.cycle.return_seconds,NIGHT:this.c.cycle.night_survival_seconds,RECOVERY:this.s.recovery?.duration??this.recoveryDuration()}[phase]??0);}
  phaseRemaining() {return Math.max(0,this.phaseDuration()-this.s.phaseElapsed);}
  publicState(save={}) {
    const s=this.s,copy=structuredClone;
    for(const container of Object.values(s.containers))this.containerContent(container);
    const players=this.scenePlayers().map(p=>{const {tokenHash,memberGeneration,requestCache,input,inputAt,disconnectedAt,jumpQueued,meleePending,damageAt,staminaUsedAt,equipUntil,fireAt,meleeAt,vy,lockedBy,lastProtectionAt,joinProtectionUntil,pendingMagnetCatch,pendingSeaCatch,...publicPlayer}=p;
      Object.assign(publicPlayer,{weaponId:this.equipped(p,'weapon')?.definitionId??null,heldDefinitionId:p.heldSlot==='quick'&&s.time<(p.quickUseUntil??0)?p.quickUseDefinitionId:this.equipped(p)?.definitionId??null,equipmentDefinitionId:this.equipped(p)?.definitionId??null,velocity:p.velocity??{x:0,y:0,z:0},moveSpeed:p.moveSpeed??0,grounded:!p.swimming&&p.y<=this.ground(p.x,p.z)+.05,sprint:live(p)&&p.sprinting===true,ads:live(p)&&p.heldSlot==='weapon'&&!!this.equipped(p,'weapon')&&p.input.ads===true&&!p.sprinting&&!p.swimming&&s.time-(p.adsSince??s.time)>=(this.defs.weapons[this.equipped(p)?.definitionId]?.ads_seconds??.15),joinProtectionRemaining:Math.max(0,(p.joinProtectionUntil??0)-s.time),action:p.carryingId?'carry':s.time<(p.actionStartedAt??0)+(p.actionDuration??0)?p.action:p.reload?'reload':p.fishing?.state==='REEL'?'reel':p.work?'interact':'idle',actionSeq:p.actionSeq??0,actionStartedAt:p.actionStartedAt??s.time,actionDuration:p.actionDuration??0});
      publicPlayer.downedRemaining=p.lifeState==='DOWNED'?p.downedHp/p.downedBleedRate:0;publicPlayer.downedMaxHp=this.c.player.downed_hp;const rescuer=s.players[p.lockedBy];publicPlayer.rescue=rescuer?.work?.kind==='Revive'&&this.rescueValid(rescuer)&&this.rescueHeld(rescuer)?{rescuerId:rescuer.id,progress:rescuer.work.progress,duration:rescuer.work.duration}:null;
      publicPlayer.work=p.work?{kind:p.work.kind,targetId:p.work.targetId,progress:p.work.progress,duration:p.work.duration}:null;publicPlayer.fishing=p.fishing?{id:p.fishing.id,poolId:p.fishing.poolId,x:p.fishing.x,y:p.fishing.y??s.waterY,z:p.fishing.z,power:p.fishing.power??1,source:p.fishing.catch_kind==='salvage'?'magnet':'sea',catch_kind:p.fishing.catch_kind??'creature',state:p.fishing.state,progress:p.fishing.progress,tension:p.fishing.tension,remaining:p.fishing.remaining,struggling:p.fishing.struggling,reeling:p.input.reel===true,mode:p.fishing.mode,cue:p.fishing.cue,behavior:p.fishing.behavior,pullSide:p.fishing.pullSide,angleAdvantage:p.fishing.angleAdvantage,activity:p.fishing.activity,signal:p.fishing.signal,motion:p.fishing.motion}:null;return copy(publicPlayer);});
    return {type:'state',protocolVersion:3,build:'0.11.6',mode:this.mode,mission:this.mode==='mission'?missionPublic(this):null,maxPlayers:this.c.baseline.max_players,difficulty:this.publicDifficulty(),snapshotId:s.tick,serverTick:s.tick,time:s.time,clock:this.publicClock(),dangerZones:this.dangerZones(),worldId:s.worldId,contentVersion:s.contentVersion,phase:s.phase,phaseElapsed:s.phaseElapsed,phaseRemaining:this.mode==='mission'?0:this.phaseRemaining(),dayIndex:s.dayIndex,threatStage:s.threatStage,lockedPlayerCount:s.lockedPlayerCount,waterY:s.waterY,paused:s.paused||this.needsBarrier,hostId:s.hostId,friendlyFire:s.friendlyFire,save,bank:copy(s.bank),players,items:copy(Object.values(s.items)),containers:copy(Object.values(s.containers)),buildings:copy(Object.values(s.buildings)),turrets:copy(Object.values(s.turrets)),enemies:copy(Object.values(s.enemies)),destructibles:copy(Object.values(s.destructibles??{}).map(prop=>({...prop,supportY:this.cachedPropBox(prop).y0}))),projectiles:copy(Object.values(s.projectiles)),nodes:copy(Object.values(s.nodes)),pools:Object.values(s.pools).map(p=>({...p,activeLines:this.scenePlayers().filter(x=>x.fishing?.poolId===p.id).length,submerged:s.waterY>this.ground(p.x+p.radius+2,p.z)+.6})),recovery:copy(s.recovery),night:copy(s.night),statistics:copy(s.statistics),world:this.staticWorld()};
  }
  serialize() { for(const c of Object.values(this.s.containers))this.containerContent(c);this.aggro.prune();this.assertInvariants();return structuredClone(this.s); }
  assertInvariants() {
    const counts={};for(const container of Object.values(this.s.containers)){if(container.itemIds.length>container.slotLimit||new Set(container.itemIds).size!==container.itemIds.length)throw Error('Invalid container capacity');for(const id of container.itemIds){const item=this.s.items[id];if(!item||item.containerId!==container.id)throw Error('Item ownership mismatch');counts[id]=(counts[id]??0)+1;}}
    for(const item of Object.values(this.s.items)){const def=this.defs.items[item.definitionId];if(!def||counts[item.id]!==1||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>def.stack)throw Error('Invalid item instance');if(this.defs.weapons[item.definitionId]&&(item.magazineAmmo<0||item.magazineAmmo>this.defs.weapons[item.definitionId].magazine))throw Error('Invalid magazine');}
    for(const t of Object.values(this.s.turrets??{})){const def=this.c.fortress.levels[t.level-1];if(!this.c.fortress.slots.some(slot=>slot.id===t.id)||!Number.isInteger(t.level)||t.level<0||t.level>2||!Number.isSafeInteger(t.ammo)||t.ammo<0||t.ammo>(def?.capacity??0)||!Number.isFinite(t.hp)||t.hp<0||t.hp>(def?.hp??0))throw Error('Invalid turret state');}
    if(Object.values(this.s.players).filter(p=>!this.onlineRoster||p.connected).length>this.c.baseline.max_players||this.s.bank.credits<0||this.s.bank.materials<0||this.s.bank.reservedCredits<0||this.s.bank.reservedMaterials<0)throw Error('Invalid world ledger');
  }
}
