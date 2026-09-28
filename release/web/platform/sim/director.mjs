import {updateDirectedEnemy, updateDirectedBoss, prepareDirectedDamage, updateDeployables} from './director-combat.mjs';

const copy=structuredClone;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const alive=p=>p?.lifeState==='ALIVE';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export class DirectorError extends Error { constructor(code,message){super(message??({INVALID_TARGET:'目标或参数无效',NO_AMMO:'没有这种工具',BUSY:'请先完成当前操作',OUT_OF_RANGE:'距离太远',ALREADY_CLAIMED:'这份奖励已经领取',NOT_FOUND:'没有可领取的奖励'}[code]??code));this.code=code;} }
export const need=(condition,code,message)=>{if(!condition)throw new DirectorError(code,message);};

export function attachDirector(world,{saved=false}={}) {
  if(world.c.director?.enabled===false)return null;
  const director=new ContentDirector(world,saved);
  world.director=director;
  director.install();
  return director;
}

export class ContentDirector {
  constructor(w,saved) {
    this.w=w;this.c=w.c.director;this.spawnContext=null;
    w.s.director??={version:1,epoch:0,history:[],objective:null,optionalObjective:null,nightPlan:null,deployables:[],rewardLedger:[],noise:{}};
    this.s=w.s.director;
    need(this.s.version===1&&Array.isArray(this.s.history)&&Array.isArray(this.s.rewardLedger)&&Array.isArray(this.s.deployables),'INVALID_TARGET','内容进度格式无效');
    this.s.noise??={};
    if(!w.s.phasePlan)w.s.phasePlan=saved?{phase:w.s.phase,players:w.s.lockedPlayerCount||1,duration:this.legacyDuration(w.s.phase),legacy:true,locked:true,startedAt:w.s.time-w.s.phaseElapsed,startTick:w.s.tick}:{phase:w.s.phase,players:0,duration:null,legacy:false,locked:false,startedAt:w.s.time,startTick:w.s.tick};
    const plan=w.s.phasePlan;need(plan.phase===w.s.phase&&(!plan.locked||Number.isFinite(plan.duration)&&plan.duration>=0),'INVALID_TARGET','阶段计划格式无效');
    for(const p of Object.values(w.s.players))this.player(p);
    for(const enemy of Object.values(w.s.enemies)){enemy.role??=w.defs.creatures[enemy.definitionId]?.role??(enemy.definitionId==='boss_crab'?'boss':'melee');enemy.variantId??=enemy.definitionId==='boss_crab'?'base':null;enemy.attackZone??=null;this.classify(enemy);}
    this.reconcileObjectives(false);
  }
  player(p) {
    p.perks??=[];p.rewardOffers??=[];p.toolCooldowns??={};
    need(Array.isArray(p.perks)&&new Set(p.perks).size===p.perks.length&&p.perks.every(id=>this.c.perks.some(x=>x.id===id)),'INVALID_TARGET','个人能力格式无效');
    need(Array.isArray(p.rewardOffers)&&p.rewardOffers.length<=256&&p.rewardOffers.every(o=>typeof o.id==='string'&&Array.isArray(o.options)&&o.options.every(id=>this.c.perks.some(x=>x.id===id))&&(!o.selected||o.options.includes(o.selected))),'INVALID_TARGET','奖励记录格式无效');
    if(this.has(p,'pockets')&&!p.perkBackpackApplied){this.w.bag(p).slotLimit+=2;p.perkBackpackApplied=true;}
    return p;
  }
  classify(enemy) {
    const def=this.w.defs.creatures[enemy.definitionId];
    enemy.tier=enemy.source==='fishing'?'minion':def.tier;enemy.locomotion=enemy.source==='fishing'?'ground':def.locomotion;enemy.rangeClass=enemy.source==='fishing'?'melee':def.rangeClass;
    if(enemy.locomotion==='air')enemy.y=this.w.enemyGroundHeight(enemy);
    if(enemy.tier==='boss')enemy.combatPhase??=1;
  }
  has(p,id) {return p?.perks?.includes(id)===true;}
  effect(p,id,fallback=1) {return this.has(p,id)?this.c.perks.find(x=>x.id===id).value:fallback;}
  moveFactor(p) {return (p.slowUntil??0)>this.w.s.time?.65:1;}
  sprintFactor(p) {return this.effect(p,'endurance');}
  reloadFactor(p) {return this.effect(p,'quick_reload');}
  tensionFactor(p) {return this.effect(p,'angler');}
  online() {return this.w.scenePlayers().filter(p=>p.connected);}
  count() {return clamp(this.online().length||1,1,this.w.c.baseline.max_players);}
  row(count=this.count()) {return this.c.phaseRows.find(r=>count<=r.players)??this.c.phaseRows.at(-1);}
  legacyDuration(phase) {const w=this.w,c=w.c.cycle;return {PREP:c.prep_seconds,DAY:c.day_seconds,RETURN:c.return_seconds,NIGHT:c.night_survival_seconds,RECOVERY:w.s.recovery?.duration??w.recoveryDuration(),COMPLETE:0}[phase]??0;}
  duration(phase=this.w.s.phase) {const p=this.w.s.phasePlan;return p?.phase===phase&&p.locked?p.duration:phase==='RECOVERY'?this.legacyDuration(phase):this.row()[phase]??0;}
  lockPhase() {const w=this.w,phase=w.s.phase;w.s.phasePlan={phase,players:this.count(),duration:phase==='RECOVERY'?this.legacyDuration(phase):this.row()[phase]??0,legacy:false,locked:true,startedAt:w.s.time-w.s.phaseElapsed,startTick:w.s.tick};w.requestSave=true;}
  enterPhase(phase) {
    this.lockPhase();
    if(phase==='NIGHT'){
      const selected=this.choose(this.c.nightPlans,'night');this.s.nightPlan={...copy(selected),startedAt:this.w.s.time};
      this.s.objective=null;this.s.optionalObjective=null;
    }else if(phase==='DAY'||phase==='RECOVERY'){
      this.s.epoch++;this.s.objective=this.newObjective(this.choose(this.c.objectives,'objective'));
      this.s.optionalObjective=this.s.objective.definitionId==='risk_order'?null:this.newObjective(this.choose(this.c.objectives.filter(x=>['risk_order','lost_files','courier_cache'].includes(x.id)&&x.id!==this.s.objective.definitionId),'optional'),true);
    }
    this.w.event('DirectorChanged',{phase,phasePlan:copy(this.w.s.phasePlan),objective:this.publicObjective(this.s.objective),nightPlan:this.s.nightPlan?copy(this.s.nightPlan):null});
  }
  choose(library,kind) {
    const now=this.w.s.time;this.s.history=this.s.history.filter(h=>now-h.at<=this.c.historySeconds).slice(-64);
    const history=this.s.history.filter(h=>h.kind===kind),recent=new Set(history.map(h=>h.id));let pool=library.filter(x=>!recent.has(x.id));
    if(!pool.length){const time=id=>history.filter(h=>h.id===id).at(-1)?.at??-Infinity;const oldest=Math.min(...library.map(x=>time(x.id)));pool=library.filter(x=>time(x.id)===oldest);}
    const chosen=pool[Math.floor(this.w.rng('director')*pool.length)];
    this.s.history.push({kind,id:chosen.id,at:now});return chosen;
  }
  newObjective(def,optional=false) {return {id:this.w.id('objective'),definitionId:def.id,name:def.name,verb:def.verb,zoneId:def.zone,goal:Math.ceil(def.base+def.perPlayer*(this.count()-1)),progress:0,completed:false,optional,startedAt:this.w.s.time,seen:[],zones:[],rewardContainerId:null};}
  publicObjective(o) {if(!o)return null;const {seen,zones,...rest}=o;return copy(rest);}
  publicState() {return {version:1,contentEpoch:this.s.epoch,objective:this.publicObjective(this.s.objective),optionalObjective:this.publicObjective(this.s.optionalObjective),nightPlan:this.s.nightPlan?{id:this.s.nightPlan.id,name:this.s.nightPlan.name,variantId:this.s.nightPlan.boss}:null,history:copy(this.s.history),deployables:this.s.deployables.map(({expiresAt,...d})=>({...copy(d),remaining:Math.max(0,expiresAt-this.w.s.time)}))};}
  decorateDay() {
    // Existing nodes/items remain the only search stock. Objectives point at
    // reachable stock, rather than creating a second set of infinite pickups.
    this.reconcileObjectives();
  }
  reconcileObjectives(settle=true) {
    if(!['DAY','RETURN','RECOVERY'].includes(this.w.s.phase))return;
    const nodes=Object.values(this.w.s.nodes);
    for(const o of [this.s.objective,this.s.optionalObjective]){
      if(!o||o.completed||o.unavailable||!['search','treasure','quiet_search','zones'].includes(o.verb))continue;
      const eligible=nodes.filter(n=>o.verb!=='treasure'||n.kind==='treasure'),remaining=()=>Math.max(0,o.goal-o.progress);
      const available=zone=>eligible.filter(n=>n.state!=='depleted'&&(!zone||n.zoneId===zone));
      // A locked/in-progress search still has all of its potential stock.
      if(o.zoneId&&available(o.zoneId).length<remaining()){o.zoneId=null;o.stockExpanded=true;this.w.requestSave=true;}
      // Only ordinary search/treasure can be reconstructed from actual current
      // stage nodes. A depleted node does not prove a historic quiet search.
      if(o.stockExpanded&&['search','treasure'].includes(o.verb)){
        o.seen??=[];
        for(const node of eligible){const key='search:'+node.id;if(node.state!=='depleted'||o.seen.includes(key))continue;o.seen.push(key);o.progress=Math.min(o.goal,o.progress+1);this.w.requestSave=true;}
      }
      if(o.progress>=o.goal){if(settle)this.completeObjective(o);else this.objectiveSettlementPending=true;continue;}
      const potential=o.verb==='zones'?new Set(available(o.zoneId).map(n=>n.zoneId).filter(id=>id&&!(o.zones??[]).includes(id))).size:available(o.zoneId).length;
      if(potential<remaining()){o.unavailable=true;o.unavailableReason='INSUFFICIENT_REMAINING_STOCK';o.unavailableMessage='本轮错过，明天再试';this.w.requestSave=true;}
    }
  }
  record(type,data) {
    for(const o of [this.s.objective,this.s.optionalObjective]){
      if(!o||o.completed||o.unavailable||(o.zoneId&&data.zoneId!==o.zoneId))continue;
      const key=`${type}:${data.id}`;if(o.seen.includes(key))continue;
      let value=0;
      if(type==='search'){
        if(o.verb==='search'||o.verb==='treasure'&&data.kind==='treasure'||o.verb==='quiet_search'&&this.w.s.time-(this.s.noise[data.zoneId]??-100)>=(this.c.objectives.find(x=>x.id===o.definitionId).quietSeconds??8))value=1;
        if(o.verb==='zones'&&data.zoneId&&!o.zones.includes(data.zoneId)){o.zones.push(data.zoneId);value=1;}
      }else if(type==='break'&&o.verb==='break')value=1;
      else if(type==='kill'&&o.verb==='kill'&&data.source==='wild')value=1;
      else if(type==='fish'&&o.verb==='fish')value=1;
      else if(type==='deposit'&&o.verb==='deposit')value=data.materials;
      if(value<=0)continue;
      o.seen.push(key);o.progress=Math.min(o.goal,o.progress+value);this.w.requestSave=true;
      if(o.progress>=o.goal)this.completeObjective(o);
    }
    if(type==='search')this.reconcileObjectives();
  }
  completeObjective(o) {
    const key=`objective:${o.id}`;if(o.completed||this.s.rewardLedger.includes(key))return;
    o.completed=true;o.completedAt=this.w.s.time;this.s.rewardLedger.push(key);
    const w=this.w,box=w.createContainer('loot',2,{x:3.5,y:w.ground(3.5,2),z:2,source:'objective',objectiveId:o.id,createdDay:w.s.dayIndex,expiresAfterDay:w.s.dayIndex+w.c.recovery.bag_retention_days});
    w.createItem(o.optional?'repair_kit':'decoy_alarm',1,box);w.containerContent(box);o.rewardContainerId=box.id;
    this.offer(key);w.event('ObjectiveCompleted',{objective:this.publicObjective(o),lootContainerId:box.id});
  }
  offer(source) {
    for(const p of this.online()){
      this.player(p);const id=`${source}:slot:${p.slotId}`;if(p.rewardOffers.some(o=>o.id===id))continue;
      const options=this.c.perks.filter(x=>!this.has(p,x.id)).map(x=>x.id);
      for(let i=options.length-1;i>0;i--){const j=Math.floor(this.w.rng('rewards')*(i+1));[options[i],options[j]]=[options[j],options[i]];}
      if(options.length)p.rewardOffers.push({id,source,options:options.slice(0,3),selected:null,createdAt:this.w.s.time});
      p.rewardOffers=p.rewardOffers.slice(-128);
    }
    this.w.requestSave=true;this.w.event('RewardsAvailable',{source});
  }
  chooseReward(p,payload) {
    this.player(p);const offer=p.rewardOffers.find(o=>o.id===payload.offerId);need(offer,'NOT_FOUND');need(!offer.selected,'ALREADY_CLAIMED');need(offer.options.includes(payload.perkId)&&!this.has(p,payload.perkId),'INVALID_TARGET');
    offer.selected=payload.perkId;offer.claimedAt=this.w.s.time;p.perks.push(payload.perkId);this.player(p);for(const pending of p.rewardOffers)if(!pending.selected&&pending.options.every(id=>this.has(p,id)))pending.exhausted=true;this.w.requestSave=true;this.w.event('RewardChosen',{actorId:p.id,offerId:offer.id,perkId:payload.perkId},p.id);
  }
  useTool(p,payload) {
    const w=this.w,id=payload.definitionId,def=this.c.tools[id];need(def,'INVALID_TARGET');need(!p.work&&!p.reload&&!p.fishing&&!p.meleePending&&w.s.time>=p.equipUntil,'BUSY');need(w.count(p,id)>0,'NO_AMMO');need(w.s.time>=(p.toolCooldowns[id]??0),'BUSY');
    if(id==='coffee_flask'){
      need(p.stamina<w.c.player.stamina_max,'INVALID_TARGET');w.consume(p,id,1);const before=p.stamina;p.stamina=Math.min(w.c.player.stamina_max,p.stamina+def.stamina);w.event('ToolUsed',{actorId:p.id,definitionId:id,amount:p.stamina-before,position:{x:p.x,y:p.y,z:p.z}},p.id);
    }else if(id==='repair_kit'){
      const target=w.s.buildings[payload.targetId]??w.s.turrets[payload.targetId];need(target&&target.hp>0&&target.hp<target.maxHp&&!target.lockedBy,'INVALID_TARGET');need(distance(p,target)<=def.range&&w.lineVisible(p,target),'OUT_OF_RANGE');
      w.consume(p,id,1);const before=target.hp;target.hp=Math.min(target.maxHp,target.hp+def.heal);target.revision++;w.event('ToolUsed',{actorId:p.id,definitionId:id,targetId:target.id,amount:target.hp-before,position:{x:target.x,y:target.y,z:target.z}},p.id);
    }else{
      need(Number.isFinite(payload.x)&&Number.isFinite(payload.z),'INVALID_TARGET');const at={x:payload.x,z:payload.z,y:w.ground(payload.x,payload.z)};
      need(distance(p,at)<=def.range&&w.s.waterY-at.y<=.6&&!w.blocked(at.x,at.y,at.z,.3)&&w.lineVisible(p,at),'OUT_OF_RANGE');
      if(id==='flash_note'){
        need((at.x-p.x)*-Math.sin(p.yaw)+(at.z-p.z)*-Math.cos(p.yaw)>=-.01,'INVALID_TARGET');
        w.consume(p,id,1);const enemyIds=[];
        for(const e of Object.values(w.s.enemies))if(e.hp>0&&e.definitionId!=='boss_crab'&&distance(e,at)<=def.radius&&w.lineVisible(at,e)){e.state='STUNNED';e.phaseRemaining=def.duration;e.attackZone=null;e.chargeRemaining=0;e.chargeHit=[];enemyIds.push(e.id);}
        w.event('ToolUsed',{actorId:p.id,definitionId:id,position:at,duration:def.duration,radius:def.radius,enemyIds},p.id);
      }else{
        need(this.s.deployables.length<this.c.budgets.maxDeployables&&this.s.deployables.filter(d=>d.ownerId===p.id&&d.definitionId===id).length<this.c.budgets.maxDecoysPerPlayer,'BUSY');
        w.consume(p,id,1);const entity={id:w.id('deployable'),definitionId:id,kind:'decoy',ownerId:p.id,faction:'camp',...at,radius:def.radius,hp:1,expiresAt:w.s.time+def.duration};this.s.deployables.push(entity);w.aggro.stimulus();w.event('ToolUsed',{actorId:p.id,definitionId:id,deployableId:entity.id,position:at,duration:def.duration},p.id);
      }
    }
    p.toolCooldowns[id]=w.s.time+def.cooldown;w.requestSave=true;
  }
  target(enemy) {return this.w.s.players[enemy.targetId]&&this.w.inScene(this.w.s.players[enemy.targetId])?this.w.s.players[enemy.targetId]:this.w.s.buildings[enemy.targetId]??this.w.s.turrets[enemy.targetId]??this.w.s.enemies[enemy.targetId]??this.s.deployables.find(d=>d.id===enemy.targetId);}
  addZone(enemy,point) {
    const def=this.w.defs.creatures[enemy.definitionId];if(this.s.deployables.filter(d=>d.kind==='slow').length>=this.c.budgets.maxEnemyZones||this.s.deployables.length>=this.c.budgets.maxDeployables)return;
    const zone={id:this.w.id('zone'),definitionId:'sticky_zone',kind:'slow',ownerId:enemy.id,faction:'enemy',x:point.x,y:this.w.ground(point.x,point.z),z:point.z,radius:def.zone_radius,expiresAt:this.w.s.time+def.zone_seconds,practiceZone:enemy.practiceZone??null};this.s.deployables.push(zone);this.w.event('ZoneCreated',copy(zone),zone.id);
  }
  install() {
    const w=this,game=this.w;
    const wrap=(name,fn)=>{const original=game[name].bind(game);game[name]=(...args)=>fn(original,...args);};
    wrap('allocate',(original,...args)=>w.player(original(...args)));
    wrap('connect',(original,p,...args)=>{w.player(p);return original(p,...args);});
    wrap('setPhase',(original,phase)=>{original(phase);w.enterPhase(phase);});
    wrap('step',(original,dt)=>{if(!game.s.paused&&!game.needsBarrier&&game.s.phase!=='COMPLETE'){if(!game.s.phasePlan.locked)w.lockPhase();if(w.objectiveSettlementPending){w.objectiveSettlementPending=false;w.reconcileObjectives();}}return original(dt);});
    wrap('catalog',original=>({...original(),creatures:game.c.creatures,director:{objectives:w.c.objectives,nightPlans:w.c.nightPlans,perks:w.c.perks,tools:w.c.tools,phaseRows:w.c.phaseRows}}));
    wrap('publicState',(original,...args)=>{const result=original(...args);result.phasePlan={...copy(game.s.phasePlan),duration:w.duration(),players:game.s.phasePlan.locked?game.s.phasePlan.players:w.count()};result.director=w.publicState();return result;});
    wrap('dispatch',(original,p,message)=>{if(!['UseTool','ChooseReward'].includes(message.command))return original(p,message);game.requireAction(p);w.player(p);return message.command==='UseTool'?w.useTool(p,{...message.payload,targetId:message.targetId??message.payload?.targetId}):w.chooseReward(p,message.payload??{});});
    wrap('generateDay',original=>{w.spawnContext='day';try{return original();}finally{w.spawnContext=null;w.decorateDay();}});
    wrap('spawnEnemy',(original,id,x,z,night=false,multiplier=1)=>{
      if(w.spawnContext==='day'&&['crab','eel'].includes(id)){const candidates=id==='crab'?['crab','courier','shield_bug','breaker','spore_slug','stamp_bat']:['eel','jammer','medic_bug','paper_drone','archive_guard'];id=candidates[Math.floor(game.rng('wild_roles')*candidates.length)];}
      // New elite/air roles replace existing spawn slots; never add a parallel wave.
      const enemy=original(id,x,z,night,multiplier);enemy.role=game.defs.creatures[id].role??(id==='boss_crab'?'boss':id==='eel'?'ranged':'melee');enemy.variantId=id==='boss_crab'?(w.s.nightPlan?.boss??'base'):null;enemy.attackZone=null;w.classify(enemy);return enemy;
    });
    wrap('startNight',original=>{original();const plan=w.s.nightPlan;if(!plan)return;game.s.night.pending.forEach((entry,i)=>{entry.entry=plan.entries[i%plan.entries.length];entry.definitionId=plan.roles[i%plan.roles.length];});game.s.night.planId=plan.id;game.s.night.variantId=plan.boss;});
    wrap('resolveNight',original=>{const before=game.s.statistics.daysSurvived,id=game.s.night.id;original();if(game.s.statistics.daysSurvived>before)w.offer(`night:${id}`);});
    wrap('alertNoise',(original,p,reason)=>{if(reason==='shot'){const zone=game.nearestZone(p);if(zone&&distance(p,zone)<=zone.radius)w.s.noise[zone.id]=game.s.time;}return original(p,reason);});
    wrap('breakProp',(original,prop,...args)=>{const was=prop.broken;const value=original(prop,...args);if(!was&&prop.broken&&game.s.players[args[0]?.actorId])w.record('break',{id:prop.id,zoneId:game.nearestZone(prop)?.id});return value;});
    wrap('killEnemy',(original,enemy,...args)=>{const existed=!!game.s.enemies[enemy.id];const value=original(enemy,...args);if(existed&&!game.s.enemies[enemy.id])w.record('kill',{id:enemy.id,source:enemy.source,zoneId:enemy.zoneId});return value;});
    wrap('deposit',(original,p,...args)=>{const before=game.s.bank.materials;const result=original(p,...args);w.record('deposit',{id:`${p.id}:${p.requestHighWater+1}`,materials:Math.max(0,game.s.bank.materials-before)});return result;});
    wrap('sell',(original,p,...args)=>{const result=original(p,...args);if(result.materials>0)w.record('deposit',{id:`${p.id}:${p.requestHighWater+1}`,materials:result.materials});return result;});
    wrap('updateWork',(original,p,dt)=>{
      const work=p.work,source=work?game.workTarget(work):null,before=source?copy(source):null,oldHp=p.hp;
      const result=original(p,dt);
      const nodeSearched=work?.kind==='Search'&&before?.state!=='depleted'&&source?.state==='depleted',archiveSearched=work?.kind==='SearchArchive'&&!before?.resolution&&source?.resolution==='searched';
      if(nodeSearched||archiveSearched){
        const containerId=nodeSearched?source.containerId:source.lootContainerId;
        if(w.has(p,'scavenger')){const box=game.s.containers[containerId];game.addItems(box,'scrap',w.effect(p,'scavenger'));try{game.pickup(p,box.id);}catch(error){if(!error.code)throw error;}}
        w.record('search',{id:source.id,kind:source.kind,zoneId:source.zoneId});
      }
      if(work?.kind==='Bandage'&&p.hp>oldHp&&w.has(p,'medic'))p.hp=Math.min(game.c.player.max_hp,p.hp+w.effect(p,'medic'));
      return result;
    });
    wrap('updateFishing',(original,p,dt)=>{const landed=game.s.statistics.fishLanded;const result=original(p,dt);if(game.s.statistics.fishLanded>landed){for(const e of Object.values(game.s.enemies))if(e.source==='fishing')w.classify(e);w.record('fish',{id:`landed:${game.s.statistics.fishLanded}`});}return result;});
    wrap('cast',(original,p,...args)=>{const result=original(p,...args);if(p.fishing&&p.fishing.catch_kind!=='salvage'){if(game.rng('fish_variants')*100<w.c.fishVariants.weight){const list=w.c.fishVariants.ids;p.fishing.creature=list[Math.floor(game.rng('fish_variants')*list.length)];}p.fishing.catch_resistance=game.defs.creatures[p.fishing.creature].resistance;}return result;});
    wrap('updateEnemy',(original,enemy,dt)=>updateDirectedEnemy(w,enemy,dt)?undefined:original(enemy,dt));
    wrap('updateBoss',(original,enemy,dt)=>enemy.variantId&&enemy.variantId!=='base'?updateDirectedBoss(w,enemy,dt):original(enemy,dt));
    wrap('reactToHit',(original,enemy,hit,direction)=>{original(enemy,hit,direction);if(['courier','medic','swooper'].includes(enemy.role)&&['WINDUP','CHARGE'].includes(enemy.state)){enemy.state='RECOVER';enemy.phaseRemaining=1.2;enemy.attackZone=null;enemy.weak=false;enemy.chargeRemaining=0;enemy.chargeHit=[];game.event('EnemyInterrupted',{enemyId:enemy.id,role:enemy.role,hitSeq:enemy.hitSeq,duration:1.2,position:{x:enemy.x,y:enemy.y,z:enemy.z}},enemy.id);}});
    wrap('resolveDamage',original=>{prepareDirectedDamage(w);return original();});
    wrap('updateProjectiles',(original,dt)=>{updateDeployables(w,dt);const keys=Object.keys(game.s.projectiles);for(const id of keys.slice(w.c.budgets.maxProjectiles))delete game.s.projectiles[id];return original(dt);});
  }
}
