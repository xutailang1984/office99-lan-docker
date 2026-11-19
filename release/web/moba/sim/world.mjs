import {VERSION,RULES,HEROES,HERO_IDS,ITEMS,RECOMMENDED,stats,skillRank,upgradePrice,skillPoints,canLearn,damageTypeFor,MINION_REWARDS,SUPPORT_INCOME} from './catalog.mjs';
import {MAP,distance,clamp,pathPoint,blocked,clearLine,findPath,nearestOpen} from './map.mjs';

const copy=x=>structuredClone(x),finite=n=>typeof n==='number'&&Number.isFinite(n),point=p=>p&&finite(p.x)&&finite(p.z)&&Math.abs(p.x)<=MAP.boundary&&Math.abs(p.z)<=MAP.boundary;
const vector=(a,b)=>{const d=distance(a,b)||1;return{x:(b.x-a.x)/d,z:(b.z-a.z)/d};};
const segmentDistance=(p,a,b)=>{const dx=b.x-a.x,dz=b.z-a.z,t=clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz||1),0,1);return distance(p,{x:a.x+dx*t,z:a.z+dz*t});};
const alive=e=>e&&e.hp>0;
const supportRole=h=>HEROES[h?.heroId]?.roleId==='support';
// Short gaps between impacts still belong to the same immobilization chain.
const controlLimit=1.8, controlRecovery=.75, controlLinkGap=.35;
export class MobaWorld{
 constructor({roster=[],state=null}={}){
  this.visionCache=new Map();this.time=0;this.tick=0;this.serial=0;this.phase='running';this.winner=null;this.events=[];this.eventSeq=0;this.wave=0;this.nextWave=RULES.firstWave;this.heroes=[];this.units=[];this.projectiles=[];this.zones=[];this.casts=[];this.botAt=0;this.metrics={kills:0,waves:0,maxUnits:0};
  if(state){MobaWorld.validate(state);for(const key of ['time','tick','serial','phase','winner','eventSeq','wave','nextWave','heroes','units','projectiles','zones','casts','botAt','metrics'])this[key]=copy(state[key]);return;}
  if(roster.length!==10||new Set(roster.map(r=>r.id)).size!==10)throw Error('对局需要十个独立席位');
  if(roster.some(r=>!HERO_IDS.includes(r.heroId)))throw Error('英雄无效');
  for(let team=0;team<2;team++){const members=roster.filter(r=>r.team===team);if(members.length!==5||new Set(members.map(r=>HEROES[r.heroId]?.roleId)).size!==5||members.some(r=>!HEROES[r.heroId]))throw Error('每队需要五种不同定位');}
  this.heroes=roster.map((r,index)=>{
   const s=stats({heroId:r.heroId,level:1,items:[]}),spawn=MAP.spawn[r.team],offset=index%5;
   return{id:r.id,name:String(r.name??HEROES[r.heroId].name).slice(0,24),kind:'hero',heroId:r.heroId,team:r.team,bot:!!r.bot,connected:!!r.connected,level:1,xp:0,gold:RULES.startingGold,items:[],itemRanks:{},x:spawn.x+(r.team?1:-1)*(offset%3-1)*1.3,z:spawn.z+(offset<3?1:-1)*1.2,hp:s.hp,maxHp:s.hp,mana:s.mana,maxMana:s.mana,radius:.65,angle:0,cooldowns:{q:0,w:0,e:0,r:0},skillRanks:{q:0,w:0,e:0,r:0},summoners:{d:0,f:0},wardAt:0,shield:0,shieldUntil:0,slowUntil:0,slow:0,stunUntil:0,rootUntil:0,controlDeadline:0,controlGuardUntil:0,silenceUntil:0,guardUntil:0,hasteUntil:0,supportedBy:{},revealUntil:0,buffUntil:0,attackAt:0,attackCount:0,lastAttackTarget:null,empowered:0,ultUntil:0,lastHurt:-10,lastFight:-10,passiveAt:0,ink:{},respawnAt:0,recallAt:0,path:[],order:null,queuedOrder:null,lastSeq:-1,kills:0,deaths:0,assists:0,damage:0,healing:0,lastHit:0,action:'idle',actionAt:0,actionSeq:0,contributors:{}};
  });
  for(const h of this.heroes)Object.assign(h,{cs:0,totalGold:RULES.startingGold,supportGold:0,supportCredit:SUPPORT_INCOME.capacity,supportCreditAt:0,supportProcAt:-10,recentDamage:[],recentControls:[],deathRecap:null,pendingCast:null});
  for(let team=0;team<2;team++){
   const spawn=MAP.spawn[team];this.units.push({id:'core-'+team,kind:'core',team,x:spawn.x+(team? -4:4),z:spawn.z+(team?4:-4),hp:4600,maxHp:4600,radius:2.8,attackAt:0,angle:0,contributors:{}});
   for(const def of MAP.structures.filter(p=>p.team===team)){
    const hp=def.kind==='inhibitor'?2400:2200+def.tier*350;
    this.units.push({...def,hp,maxHp:hp,radius:def.kind==='inhibitor'?1.8:1.5,attackAt:0,angle:0,focus:null,ramp:0,respawnAt:0,contributors:{}});
   }
  }
  for(const camp of MAP.camps)this.units.push({id:camp.id,kind:'monster',species:camp.kind,team:2,x:camp.x,z:camp.z,home:{x:camp.x,z:camp.z},hp:camp.hp,maxHp:camp.hp,radius:['crab','archive'].includes(camp.kind)?1.7:.9,gold:camp.gold,attackAt:0,focus:null,respawnAt:0,path:[],angle:0,contributors:{},spawnAt:camp.spawnAt??(['crab','archive'].includes(camp.kind)?180:45)});
 }
 static validate(s){
  if(!s||s.schema!=='office99-moba-1'||s.version!==VERSION||!finite(s.time)||s.time<0||!Number.isSafeInteger(s.tick)||s.tick<0||!['running','finished'].includes(s.phase)||![null,0,1].includes(s.winner))throw Error('对局快照无效');
  let nodes=0;const visit=(v,depth=0)=>{if(++nodes>70000||depth>12)throw Error('对局快照结构过大');if(typeof v==='number'&&!finite(v))throw Error('对局快照数值无效');if(v&&typeof v==='object')for(const key of Object.keys(v)){if(['__proto__','constructor','prototype'].includes(key))throw Error('对局快照字段无效');visit(v[key],depth+1);}};visit(s);
  for(const k of ['serial','eventSeq','wave'])if(!Number.isSafeInteger(s[k])||s[k]<0)throw Error('对局序号无效');
  if(!finite(s.nextWave)||!finite(s.botAt)||!s.metrics||!finite(s.metrics.kills))throw Error('对局时钟无效');
  for(const [k,max]of [['heroes',10],['units',260],['projectiles',256],['zones',64],['casts',64]])if(!Array.isArray(s[k])||s[k].length>max)throw Error('对局快照超出容量');
  if(s.heroes.length!==10||new Set(s.heroes.map(h=>h.id)).size!==10)throw Error('对局席位无效');
  if(s.heroes.some(h=>!HERO_IDS.includes(h.heroId)||!Array.isArray(h.items)||h.items.some(id=>!Object.hasOwn(ITEMS,id))))throw Error('英雄或装备无效');
  for(let team=0;team<2;team++)if(new Set(s.heroes.filter(h=>h.team===team).map(h=>HEROES[h.heroId]?.roleId)).size!==5)throw Error('对局阵容无效');
  const entities=[...s.heroes,...s.units];if(new Set(entities.map(e=>e.id)).size!==entities.length)throw Error('对局实体编号重复');
  // Permanent map entities survive destruction and must survive host migration too.
  const permanent=[{id:'core-0',kind:'core',team:0},{id:'core-1',kind:'core',team:1},...MAP.structures,...MAP.camps.map(c=>({id:c.id,kind:'monster',team:2,species:c.kind}))];
  const required=new Map(permanent.map(e=>[e.id,e])),saved=new Map(s.units.map(e=>[e.id,e]));
  for(const def of permanent){const e=saved.get(def.id);if(!e||['kind','team','lane','tier','species'].some(k=>def[k]!==undefined&&e[k]!==def[k]))throw Error('地图永久实体缺失或不匹配');}
  for(const e of s.units){if(['core','tower','inhibitor','monster'].includes(e.kind)&&!required.has(e.id))throw Error('地图永久实体无效');if(e.kind==='monster'&&(!point(e.home)||!finite(e.spawnAt)||e.spawnAt<0||!finite(e.respawnAt)||e.respawnAt<0)||e.kind==='inhibitor'&&(!finite(e.respawnAt)||e.respawnAt<0))throw Error('地图刷新状态无效');}
  for(const e of entities)if(typeof e.id!=='string'||e.id.length>64||!point(e)||!finite(e.hp)||!finite(e.maxHp)||e.hp<0||e.hp>e.maxHp||e.maxHp>20000||![0,1,2].includes(e.team)||!['hero','tower','core','inhibitor','ward','monster','minion'].includes(e.kind)||!finite(e.radius)||e.radius<=0||e.radius>6)throw Error('对局实体无效');
  for(const h of s.heroes){if(h.kind!=='hero'||!HEROES[h.heroId]||!Array.isArray(h.items)||h.items.length>RULES.itemSlots||h.items.some(i=>!ITEMS[i])||new Set(h.items).size!==h.items.length||!finite(h.gold)||h.gold<0||!Number.isInteger(h.level)||h.level<1||h.level>RULES.maxLevel||!Array.isArray(h.path)||h.path.length>256||h.path.some(p=>!point(p))||!Number.isSafeInteger(h.lastSeq)||h.lastSeq< -1)throw Error('英雄数据无效');for(const key of ['mana','maxMana','respawnAt','recallAt','stunUntil','rootUntil','controlDeadline','controlGuardUntil','silenceUntil','guardUntil','attackAt','xp'])if(!finite(h[key])||h[key]<0)throw Error('英雄状态无效');for(const key of ['q','w','e','r'])if(!finite(h.cooldowns?.[key])||h.cooldowns[key]<0)throw Error('技能冷却无效');}
  for(const h of s.heroes){if(!h.skillRanks||Object.keys(h.skillRanks).length!==4||['q','w','e','r'].some(k=>!Number.isInteger(h.skillRanks[k])||h.skillRanks[k]<0||h.skillRanks[k]>(k==='r'?3:5))||Object.values(h.skillRanks).reduce((a,b)=>a+b,0)>h.level||['q','w','e'].some(k=>h.skillRanks[k]>Math.ceil(h.level/2))||h.skillRanks.r>Math.max(0,Math.min(3,1+Math.floor((h.level-6)/5)))||!h.summoners||['d','f'].some(k=>!finite(h.summoners[k])||h.summoners[k]<0)||!finite(h.wardAt)||h.wardAt<0)throw Error('英雄成长数据无效');}
  for(const h of s.heroes)if(h.itemRanks&&Object.entries(h.itemRanks).some(([id,rank])=>!h.items.includes(id)||![0,1].includes(rank)))throw Error('装备强化数据无效');
  for(const h of s.heroes){
   if(!Number.isSafeInteger(h.cs)||h.cs<0||h.cs>1000000||['totalGold','supportGold','supportCredit','supportCreditAt','supportProcAt'].some(k=>!finite(h[k]))||h.totalGold<0||h.totalGold>1e9||h.supportGold<0||h.supportGold>h.totalGold||h.supportCredit<0||h.supportCredit>SUPPORT_INCOME.capacity||h.supportCreditAt<0||h.supportCreditAt>s.time||h.supportProcAt>s.time)throw Error('经济记录无效');
   if(!Array.isArray(h.recentDamage)||h.recentDamage.length>24||!Array.isArray(h.recentControls)||h.recentControls.length>16)throw Error('战斗记录无效');
   const validText=(text,max)=>typeof text==='string'&&text.length<=max;
   const validDamage=e=>e&&finite(e.at)&&e.at>=0&&e.at<=s.time&&finite(e.amount)&&e.amount>=0&&e.amount<=20000&&['physical','magic','true'].includes(e.type)&&validText(e.source,64)&&validText(e.name,48)&&validText(e.kind,32)&&(e.heroId===null||HERO_IDS.includes(e.heroId));
   const validControl=e=>e&&finite(e.at)&&e.at>=0&&e.at<=s.time&&finite(e.duration)&&e.duration>=0&&e.duration<=10&&validText(e.source,64)&&validText(e.name,48)&&['root','stun','silence','pull','knockback'].includes(e.type);
   if(h.recentDamage.some(e=>!validDamage(e)))throw Error('伤害记录无效');
   if(h.recentControls.some(e=>!validControl(e)))throw Error('控制记录无效');
   const p=h.pendingCast;if(p!=null&&(!['q','w','e','r'].includes(p.skill)||typeof p.target!=='string'||p.target.length>64||!finite(p.expiresAt)||p.expiresAt<0))throw Error('追踪施法无效');
   const recap=h.deathRecap;if(recap!=null&&(!finite(recap.at)||recap.at<0||recap.at>s.time||!Array.isArray(recap.damage)||recap.damage.length>24||recap.damage.some(e=>!validDamage(e))||!Array.isArray(recap.controls)||recap.controls.length>16||recap.controls.some(e=>!validControl(e))||!finite(recap.total)||recap.total<0||recap.total>480000||!recap.killer||!validText(recap.killer.id,64)||!validText(recap.killer.name,48)||!validText(recap.killer.kind,16)||(recap.killer.heroId!==null&&!HERO_IDS.includes(recap.killer.heroId))))throw Error('死亡摘要无效');
  }
  for(const h of s.heroes){
   const q=h.queuedOrder;if(q!=null&&(!q||typeof q!=='object'||Array.isArray(q)||!['move','attack_move','attack'].includes(q.type)||Object.keys(q).some(k=>!['type','x','z','target'].includes(k))||(q.type==='attack'?(Object.keys(q).length!==2||typeof q.target!=='string'||q.target.length>64):(Object.keys(q).length!==3||!point(q)))))throw Error('待执行指令无效');
  }
  for(const p of s.projectiles)if(!finite(p.speed)||p.speed<=0||p.speed>200||(p.bornAt!==undefined&&(!finite(p.bornAt)||p.bornAt<0||p.bornAt>s.time)))throw Error('飞行物时序无效');
  if(s.phase==='finished'&&(s.winner===null||!s.units.some(e=>e.kind==='core'&&e.team===1-s.winner&&e.hp===0))||s.phase==='running'&&s.winner!==null)throw Error('终局状态无效');
  return true;
 }
 serialize(){const s={schema:'office99-moba-1',version:VERSION};for(const key of ['time','tick','serial','phase','winner','eventSeq','wave','nextWave','heroes','units','projectiles','zones','casts','botAt','metrics'])s[key]=copy(this[key]);return s;}
 entity(id){return this.heroes.find(h=>h.id===id)??this.units.find(e=>e.id===id);}
 all(){return[...this.heroes,...this.units];}
 active(e){return alive(e)&&(!(e.kind==='monster')||this.time>=e.spawnAt);}
 canControl(e){return this.active(e)&&!e.returning&&!['tower','core','inhibitor'].includes(e.kind)&&!(e.kind==='hero'&&distance(e,MAP.spawn[e.team])<5);}
 enemy(a,b){return a.team!==b.team&&a.id!==b.id;}
 brush(e){return MAP.brush.findIndex(b=>distance(b,e)<=b.r);}
 visible(team,e){
  if(e.team===team||e.kind==='tower'||e.kind==='core')return true;
  const brush=this.brush(e);return this.all().some(a=>a.team===team&&this.active(a)&&distance(a,e)<(a.kind==='hero'?RULES.vision:a.kind==='tower'?22:a.kind==='ward'?20:14)&&(brush<0||(e.revealUntil??0)>this.time||this.brush(a)===brush||distance(a,e)<RULES.brushVision)&&clearLine(a,e,.1));
 }
 emit(kind,data={}){const source=this.entity(data.source),target=this.entity(data.target),p=data.at??source??target;const teams=[0,1].filter(t=>source?.team===t||target?.team===t||p&&this.visible(t,p));this.events.push({id:++this.eventSeq,time:this.time,kind,...copy(data),teams});if(this.events.length>160)this.events.shift();}
 action(h,name){h.action=name;h.actionAt=this.time;h.actionSeq++;}
 command(id,m){
  const h=this.heroes.find(p=>p.id===id);if(!h||!m||!Number.isSafeInteger(m.seq)||m.seq<=h.lastSeq)return{ok:false,code:'STALE_INPUT'};
  h.lastSeq=m.seq;return this.input(h,m);
 }
 input(h,m){
  if(this.phase!=='running')return{ok:false,code:'MATCH_ENDED'};
  if(m.type==='learn'){if(!skillPoints(h))return{ok:false,code:'NO_SKILL_POINT'};if(!canLearn(h,m.skill))return{ok:false,code:'INVALID_SKILL_RANK'};h.skillRanks[m.skill]++;return{ok:true};}
  if(m.type==='buy')return this.buy(h,m.item);
  if(m.type==='upgrade')return this.upgrade(h,m.item);
  if(m.type==='sell')return this.sell(h,m.item);
  if(!alive(h))return{ok:false,code:'RESPAWNING'};
  // Stop/hold edit player intent even while stunned; step still blocks actions until recovery.
  if(m.type==='stop'){this.cancelCast(h);h.order=null;h.path=[];h.recallAt=0;return{ok:true};}
  if(m.type==='hold'){this.resetInput(h);h.order={type:'hold'};return{ok:true};}
  if(h.stunUntil>this.time)return{ok:false,code:'CONTROLLED'};
  if(m.type==='summoner')return this.summoner(h,m);
  if(m.type==='ward')return this.placeWard(h,m);
  if(m.type==='move'||m.type==='attack_move'){
   if(h.rootUntil>this.time)return{ok:false,code:'ROOTED'};
   if(!point(m))return{ok:false,code:'INVALID_POINT'};const route=this.route(h,m);if(!route.length)return{ok:false,code:'BLOCKED'};
   if(h.castUntil>this.time){h.queuedOrder={type:m.type,x:m.x,z:m.z};return{ok:true,queued:true};}
   this.cancelCast(h);h.recallAt=0;h.path=route;h.order={type:m.type,x:m.x,z:m.z};return{ok:true};
  }
  if(m.type==='recall'){h.order=null;h.path=[];this.cancelCast(h);h.recallAt=this.time+RULES.recallSeconds;this.action(h,'recall');return{ok:true};}
  if(m.type==='attack'){
   const target=this.entity(m.target);if(!this.active(target)||!this.enemy(h,target)||!this.visible(h.team,target))return{ok:false,code:'INVALID_TARGET'};
   if(h.castUntil>this.time){h.queuedOrder={type:'attack',target:target.id};return{ok:true,queued:true};}
   if(h.order?.type==='attack'&&h.order.target===target.id)return{ok:true};
   this.cancelCast(h);h.recallAt=0;h.order={type:'attack',target:target.id};h.path=[];return{ok:true};
  }
  if(m.type==='cast')return this.cast(h,m.skill,m);
  return{ok:false,code:'UNKNOWN_COMMAND'};
 }
 cancelCast(h,skillsOnly=false){
  // Cancelling a pending targeted cast must also cancel its approach movement.
  // Ordinary move paths are independent and remain intact.
  if(h.pendingCast)h.path=[];
  const cancelled=this.casts.filter(c=>c.source===h.id&&(!skillsOnly||!c.auto));
  if(cancelled.length||h.castUntil>this.time)this.action(h,'idle');
  // Only an attack still in windup refunds its cycle; launched projectiles remain authoritative.
  if(cancelled.some(c=>c.auto))h.attackAt=Math.min(h.attackAt,this.time);
  this.casts=this.casts.filter(c=>c.source!==h.id||skillsOnly&&c.auto);h.castUntil=0;h.queuedOrder=null;h.pendingCast=null;
 }
 resetInput(h){this.cancelCast(h);h.order=null;h.path=[];h.recallAt=0;}
 finishCast(h,c){
  h.castUntil=0;const order=h.queuedOrder??c.resumeOrder;h.queuedOrder=null;
  if(order&&alive(h)&&h.stunUntil<=this.time)this.input(h,order);
 }
 upgrade(h,id){
  if(!Object.hasOwn(ITEMS,id)||!h.items.includes(id))return{ok:false,code:'INVALID_ITEM'};
  if(alive(h)&&distance(h,MAP.spawn[h.team])>7)return{ok:false,code:'SHOP_AT_BASE'};
  if(h.itemRanks?.[id]===1)return{ok:false,code:'MAX_UPGRADE'};
  if(h.gold<upgradePrice(id))return{ok:false,code:'NO_GOLD'};
  h.gold-=upgradePrice(id);h.itemRanks??={};h.itemRanks[id]=1;this.refreshStats(h);this.emit('purchase',{source:h.id,item:id,upgrade:true});return{ok:true};
 }
 sell(h,id){
  if(!Object.hasOwn(ITEMS,id)||!h.items.includes(id))return{ok:false,code:'INVALID_ITEM'};
  if(alive(h)&&distance(h,MAP.spawn[h.team])>7)return{ok:false,code:'SHOP_AT_BASE'};
  h.gold+=Math.floor((ITEMS[id].price+(h.itemRanks?.[id]===1?upgradePrice(id):0))*.7);
  h.items=h.items.filter(v=>v!==id);if(h.itemRanks)delete h.itemRanks[id];this.refreshStats(h);return{ok:true};
 }
 refreshStats(h){const s=stats(h);h.maxHp=s.hp;h.maxMana=s.mana;h.hp=Math.min(h.hp,h.maxHp);h.mana=Math.min(h.mana,h.maxMana);}
 buy(h,id){
  if(!Object.hasOwn(ITEMS,id))return{ok:false,code:'INVALID_ITEM'};const item=ITEMS[id];
  if(alive(h)&&distance(h,MAP.spawn[h.team])>7)return{ok:false,code:'SHOP_AT_BASE'};
  if(h.items.length>=RULES.itemSlots||h.items.includes(id))return{ok:false,code:'SLOTS_FULL'};
  if(h.gold<item.price)return{ok:false,code:'NO_GOLD'};
  h.gold-=item.price;h.items.push(id);const s=stats(h);h.maxHp=s.hp;h.maxMana=s.mana;this.emit('purchase',{source:h.id,item:id});return{ok:true};
 }
 summoner(h,m){
  if(!['d','f'].includes(m.skill))return{ok:false,code:'INVALID_SKILL'};
  if(h.summoners[m.skill]>this.time)return{ok:false,code:'COOLDOWN'};
  if(h.castUntil>this.time)return{ok:false,code:'CASTING'};
  if(m.skill==='d'){
   if(h.rootUntil>this.time)return{ok:false,code:'ROOTED'};
   if(!point(m))return{ok:false,code:'INVALID_POINT'};
   const from={x:h.x,z:h.z},d=vector(h,m),length=Math.min(8,distance(h,m)),to=nearestOpen({x:h.x+d.x*length,z:h.z+d.z*length},h.radius);
   if(!to||distance(h,to)>8.2||this.structureBlocked(h,to))return{ok:false,code:'BLOCKED'};
   this.resetInput(h);Object.assign(h,to);h.separationUntil=this.time+.25;h.summoners.d=this.time+300;this.emit('blink',{source:h.id,at:from,to});return{ok:true};
  }
  if(HEROES[h.heroId].roleId==='jungle'){
   const target=this.entity(m.target);if(!this.active(target)||target.kind!=='monster'||distance(h,target)>10||!this.visible(h.team,target))return{ok:false,code:'INVALID_TARGET'};
   h.summoners.f=this.time+75;this.damage(h,target,600+h.level*30,'smite');this.heal(h,h,100);this.emit('smite',{source:h.id,target:target.id,at:{x:target.x,z:target.z}});return{ok:true};
  }
  h.summoners.f=this.time+180;this.heal(h,h,100+h.level*15);const ally=this.heroes.filter(a=>a!==h&&a.team===h.team&&alive(a)&&distance(h,a)<8).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];if(ally)this.heal(h,ally,100+h.level*15);h.hasteUntil=this.time+1;return{ok:true};
 }
 placeWard(h,m){
  if(h.wardAt>this.time)return{ok:false,code:'WARD_COOLDOWN'};
  if(!point(m)||distance(h,m)>12||blocked(m.x,m.z,.3))return{ok:false,code:'INVALID_POINT'};
  const wards=this.units.filter(e=>e.kind==='ward'&&e.owner===h.id&&alive(e));if(wards.length>=3)wards.sort((a,b)=>a.endAt-b.endAt)[0].hp=0;
  this.units.push({id:'ward-'+(++this.serial),kind:'ward',owner:h.id,team:h.team,x:m.x,z:m.z,hp:120,maxHp:120,radius:.35,endAt:this.time+90,contributors:{}});
  h.wardAt=this.time+90;this.visionCache.clear();this.emit('ward',{source:h.id,at:{x:m.x,z:m.z}});return{ok:true};
 }
 cast(h,key,m){
  if(!['q','w','e','r'].includes(key))return{ok:false,code:'INVALID_SKILL'};
  const def=HEROES[h.heroId].skills[key];if(h.silenceUntil>this.time)return{ok:false,code:'SILENCED'};if(h.rootUntil>this.time&&((h.heroId==='archer'&&key==='e')||(h.heroId==='courier'&&['q','r'].includes(key))||(h.heroId==='guardian'&&key==='q')))return{ok:false,code:'ROOTED'};if(!def)return{ok:false,code:'INVALID_SKILL'};
  const rank=skillRank(h,key);if(!rank)return{ok:false,code:'LEVEL_REQUIRED'};
  if(h.cooldowns[key]>this.time)return{ok:false,code:'COOLDOWN'};
  if(h.mana<def.mana)return{ok:false,code:'NO_MANA'};
  if(h.castUntil>this.time)return{ok:false,code:'CASTING'};
  const target=this.entity(m.target);
  if(target&&this.enemy(h,target)&&!this.visible(h.team,target))return{ok:false,code:'INVALID_TARGET'};
  const aim=['enemy','ally'].includes(def.target)&&target?{x:target.x,z:target.z}:point(m)?{x:m.x,z:m.z}:target?{x:target.x,z:target.z}:{x:h.x,z:h.z};
  if(def.target==='enemy'&&(!this.active(target)||target.kind!=='hero'||!this.enemy(h,target)||!this.visible(h.team,target)))return{ok:false,code:'INVALID_TARGET'};
  if(def.target==='ally'&&target&&(!this.active(target)||target.team!==h.team||target.kind!=='hero'))return{ok:false,code:'INVALID_TARGET'};
  if(['enemy','ally'].includes(def.target)&&target&&(distance(h,target)>def.range||!clearLine(h,target,.1))){
   if(h.rootUntil>this.time)return{ok:false,code:'ROOTED'};
   const route=this.route(h,target);if(!route.length)return{ok:false,code:'BLOCKED'};
   this.resetInput(h);h.pendingCast={skill:key,target:target.id,expiresAt:this.time+12};h.path=route;
   return{ok:true,approaching:true};
  }
  const resumeOrder=copy(h.order);
  h.recallAt=0;this.cancelCast(h);h.mana-=def.mana;h.cooldowns[key]=this.time+def.cooldown*(1-stats(h).haste);h.revealUntil=this.time+2;
  const windup=def.windup??.16;
  h.castWindup=windup;h.castUntil=this.time+windup;h.path=[];h.order=null;const d=vector(h,aim);h.angle=Math.atan2(-d.x,-d.z);this.action(h,'cast_'+key);
  const cast={source:h.id,hero:h.heroId,key,rank,resumeOrder,target:target?.id??null,origin:{x:h.x,z:h.z},aim,at:this.time+windup};this.casts.push(cast);
  this.emit('cast',{source:h.id,hero:h.heroId,skill:key,at:{x:h.x,z:h.z},to:aim,windup,radius:def.radius,targetMode:def.target});return{ok:true};
 }
 projectile(h,aim,{damage,speed=28,width=.6,pierce=false,kind='bolt',target=null,slow=0,stun=0,pull=false}={}){
  const d=vector(h,aim),range=distance(h,aim);if(range<.01)return;
  const p={id:'p'+(++this.serial),source:h.id,team:h.team,x:h.x,z:h.z,dx:d.x,dz:d.z,remaining:range+1,speed,width,damage,pierce,kind,target,slow,stun,pull,hit:[],bornAt:this.time,endAt:this.time+3};
  this.projectiles.push(p);
  // Birth survives even when a nearby hit destroys the projectile between two snapshots.
  this.emit('projectile_spawn',{source:h.id,target,projectileId:p.id,projectileKind:kind,team:h.team,at:{x:p.x,z:p.z},to:{x:aim.x,z:aim.z},dx:p.dx,dz:p.dz,speed,width,bornAt:p.bornAt,range:range+1});
 }
 endProjectile(p,from){this.emit('projectile_end',{source:p.source,projectileId:p.id,projectileKind:p.kind,from,at:{x:p.x,z:p.z}});}
 dash(h,aim,length,damage=0,stun=0){
  h.separationUntil=this.time+.25;
  const from={x:h.x,z:h.z},d=vector(h,aim),n=Math.ceil(Math.min(length,distance(h,aim))/.3);let hitHero=false;
  for(let i=0;i<n;i++){const p={x:h.x+d.x*.3,z:h.z+d.z*.3};if(blocked(p.x,p.z,h.radius)||this.structureBlocked(h,p))break;h.x=p.x;h.z=p.z;
   if(stun)for(const e of this.heroes)if(this.canControl(e)&&this.enemy(h,e)&&distance(h,e)<1.5){this.damage(h,e,damage,'dash');this.control(h,e,'stun',stun);hitHero=true;break;}if(hitHero)break;
  }
  if(!stun&&damage)for(const e of this.all())if(this.active(e)&&this.enemy(h,e)&&!['tower','core','inhibitor'].includes(e.kind)&&segmentDistance(e,from,h)<1.25)this.damage(h,e,damage,'dash');
  this.emit('dash',{source:h.id,at:from,to:{x:h.x,z:h.z},hero:h.heroId});
 }
 resolveCast(c){
  const h=this.entity(c.source);if(!alive(h)||h.stunUntil>this.time)return;
  if(h.silenceUntil>this.time)return;
  if(h.rootUntil>this.time&&((h.heroId==='archer'&&c.key==='e')||(h.heroId==='courier'&&['q','r'].includes(c.key))||(h.heroId==='guardian'&&c.key==='q')))return;
  const s=stats(h),scale=c.rank-1,origin={x:h.x,z:h.z},dir=vector(origin,c.aim),def=HEROES[h.heroId].skills[c.key];
  const aim={x:origin.x+dir.x*Math.min(distance(origin,c.aim),def.range),z:origin.z+dir.z*Math.min(distance(origin,c.aim),def.range)};
  const hit=(e,n,kind='spell')=>{this.damage(h,e,n,kind);this.inkHit(h,e);};
  const enemies=(p,r)=>this.all().filter(e=>this.canControl(e)&&this.enemy(h,e)&&distance(p,e)<=r&&clearLine(p,e,.1));
  const zone=(kind,p,r,seconds,damage=0,slow=0)=>this.zones.push({id:'z'+(++this.serial),kind,source:h.id,team:h.team,...p,radius:r,endAt:this.time+seconds,nextAt:this.time,damage,slow});
  const effect=(shape,p=origin,radius=def.radius)=>this.emit('ability',{source:h.id,hero:h.heroId,skill:c.key,shape,at:p,to:def.range===0?c.aim:aim,radius});
  if(c.key==='w'){
   switch(h.heroId){
    case 'stapler': h.empowered=this.time+5;h.attackAt=this.time;effect('overload');break;
    case 'archer': for(const a of [-.20,0,.20]){const x=dir.x*Math.cos(a)-dir.z*Math.sin(a),z=dir.x*Math.sin(a)+dir.z*Math.cos(a);this.projectile(h,{x:h.x+x*12,z:h.z+z*12},{damage:55+scale*18+s.attack*.25,kind:'arrow',width:.45,speed:30,slow:.3});}break;
    case 'courier': h.hasteUntil=this.time+3;this.shield(h,h,70+scale*25,2);effect('haste');break;
    case 'mechanic': this.shield(h,h,120+scale*35,3);h.empowered=this.time+5;effect('guard');break;
    case 'printer': for(const e of enemies(origin,3.8)){hit(e,70+scale*20+s.power*.3,'ink_wave');e.slow=.35;e.slowUntil=this.time+1.5;}effect('light',origin,3.8);break;
    case 'lecturer': case 'broadcaster': {const chosen=this.entity(c.target),ally=alive(chosen)&&chosen.team===h.team&&distance(h,chosen)<=10?chosen:h;this.shield(h,ally,100+scale*25+s.power*.35,2.5);effect('guard',{x:ally.x,z:ally.z},1.3);break;}
    case 'guardian': for(const e of enemies(origin,3.8)){hit(e,65+scale*20,'slam');e.slow=.3;e.slowUntil=this.time+1.5;}effect('wrench',origin,3.8);break;
    case 'custodian': zone('wet_floor',aim,3,4,0,.4);effect('tape',aim,3);break;
    case 'barista': this.projectile(h,{x:h.x+dir.x*12,z:h.z+dir.z*12},{damage:65+scale*18+s.power*.35,kind:'coffee_bolt',speed:27,width:.65,slow:.35});break;
   }
   this.finishCast(h,c);return;
  }
  if(h.heroId==='stapler'){
   if(c.key==='q')this.projectile(h,{x:h.x+dir.x*15,z:h.z+dir.z*15},{damage:95+scale*24+s.attack*.45,pierce:true,kind:'staple',width:.85});
   if(c.key==='e'){zone('tape',aim,2.5,3,0,.4);effect('tape',aim,2.5);}
   if(c.key==='r'){h.ultUntil=this.time+6;this.emit('overdrive',{source:h.id,at:origin,duration:6});}
  }else if(h.heroId==='archer'){
   if(c.key==='q')this.projectile(h,{x:h.x+dir.x*15,z:h.z+dir.z*15},{damage:85+scale*22+s.attack*.4,pierce:true,kind:'arrow',width:.6,speed:30});
   if(c.key==='e')this.dash(h,aim,4.5);
   if(c.key==='r')this.projectile(h,{x:h.x+dir.x*19,z:h.z+dir.z*19},{damage:200+scale*60+s.attack*.8,pierce:true,kind:'great_arrow',width:1,speed:30});
   h.empowered=this.time+5;
  }else if(h.heroId==='courier'){
   if(c.key==='q')this.dash(h,aim,7,85+scale*22+s.attack*.5);
   if(c.key==='e')this.projectile(h,{x:h.x+dir.x*12,z:h.z+dir.z*12},{damage:60+scale*16,kind:'hook',width:.65,speed:24,pull:true,slow:.35});
   if(c.key==='r'){const target=this.entity(c.target);if(this.active(target)&&distance(h,target)<=10&&this.visible(h.team,target)&&clearLine(h,target,.1)){this.dash(h,target,Math.max(0,distance(h,target)-1.5));if(distance(h,target)<3){this.damage(h,target,150+scale*60+Math.min(220,(target.maxHp-target.hp)*.25),'execute');this.emit('execute',{source:h.id,target:target.id,at:{x:target.x,z:target.z}});}}}
  }else if(h.heroId==='mechanic'){
   if(c.key==='q'){for(const e of enemies(origin,3.2))hit(e,80+scale*22+s.attack*.55,'sweep');effect('wrench',origin,3.2);}
   if(c.key==='e'){h.hasteUntil=this.time+3;effect('haste');}
   if(c.key==='r'){h.ultUntil=this.time+6;effect('overload');}
   h.empowered=this.time+5;
  }else if(h.heroId==='printer'){
   if(c.key==='q')this.projectile(h,{x:h.x+dir.x*13,z:h.z+dir.z*13},{damage:125+scale*30+s.power*.7,kind:'stamp',width:.65,speed:25});
   const target=this.entity(c.target);
   if(['e','r'].includes(c.key)&&this.active(target)&&distance(h,target)<=def.range&&this.visible(h.team,target)&&clearLine(h,target,.1)){
    hit(target,c.key==='e'?55+scale*15+s.power*.2:250+scale*75+s.power*1.15,c.key==='e'?'bind':'stamp_drop');
    if(c.key==='e')this.control(h,target,'root',1.25);
    effect(c.key==='e'?'bind':'stamp_drop',{x:target.x,z:target.z},1);
   }
  }else if(h.heroId==='lecturer'){
   if(c.key==='q'){for(const e of enemies(aim,2.7)){hit(e,85+scale*22+s.power*.4,'light');e.slow=.35;e.slowUntil=this.time+2;}effect('light',aim,2.7);}
   if(c.key==='e'){for(const e of enemies(aim,2.5)){hit(e,45+scale*15+s.power*.2,'frame');this.control(h,e,'root',1.4);}effect('frame',aim,2.5);}
   if(c.key==='r'){zone('projection',aim,4.5,5,85+scale*25+s.power*.35,.3);effect('projection',aim,4.5);}
  }else if(h.heroId==='guardian'){
   if(c.key==='q')this.dash(h,aim,7,90+scale*24,.65);
   if(c.key==='e'){
    const allies=this.heroes.filter(a=>a!==h&&a.team===h.team&&alive(a)&&distance(h,a)<=4.5);
    const shared=(100+scale*25)*2/Math.max(2,allies.length);
    this.shield(h,h,180+scale*40,3);
    for(const ally of allies)this.shield(h,ally,shared,3);
   }
   if(c.key==='r'){for(const e of enemies(origin,5)){this.damage(h,e,150+scale*65,'slam');const duration=this.control(h,e,'stun',.9);if(duration>0)e.airborneUntil=this.time+Math.min(.65,duration);}this.emit('slam',{source:h.id,at:origin,radius:5});}
  }else if(h.heroId==='custodian'){
   if(c.key==='e'){h.guardUntil=this.time+3;effect('guard');}
   else{const radius=c.key==='r'?7:4;for(const e of enemies(origin,radius)){const v=vector(h,e);if(v.x*dir.x+v.z*dir.z<.5)continue;hit(e,c.key==='r'?130+scale*50:65+scale*20,'clean');this.pushAway(h,e,c.key==='r'?3:2);if(c.key==='r')this.control(h,e,'stun',.75);}effect('clean',origin,radius);}
  }else if(h.heroId==='barista'){
   if(c.key==='q'){let a=this.entity(c.target);if(!alive(a)||a.team!==h.team||a.kind!=='hero'||distance(h,a)>10||!clearLine(h,a,.1))a=h;this.heal(h,a,120+scale*30+s.power*.6);}
   if(c.key==='e'){
    const allies=this.heroes.filter(a=>alive(a)&&a.team===h.team&&distance(h,a)<=5);
    const shared=(100+scale*25+s.power*.3)*3/Math.max(3,allies.length);
    for(const ally of allies)this.shield(h,ally,shared,3);
    this.emit('rally',{source:h.id,at:origin,radius:5});
   }
   if(c.key==='r'){this.zones.push({id:'z'+(++this.serial),kind:'tea',source:h.id,team:h.team,...aim,radius:5,endAt:this.time+5,nextAt:this.time,heal:70+scale*25+s.power*.25});this.emit('tea',{source:h.id,at:aim,radius:5});}
  }else if(h.heroId==='broadcaster'){
   if(c.key==='q')this.projectile(h,{x:h.x+dir.x*13,z:h.z+dir.z*13},{damage:70+scale*20+s.power*.4,kind:'sound',width:.8,speed:22,slow:.4});
   if(c.key==='e'){for(const a of this.heroes)if(alive(a)&&a.team===h.team&&distance(h,a)<=5){a.hasteUntil=this.time+3;a.slowUntil=0;a.slow=0;this.support(h,a);}effect('rally',origin,5);}
   if(c.key==='r'){for(const e of enemies(origin,8)){const v=vector(h,e);if(v.x*dir.x+v.z*dir.z>=.5){hit(e,90+scale*35+s.power*.35,'sound');this.control(h,e,'silence',1.5);}}effect('sound',origin,8);}
  }
  this.finishCast(h,c);
 }
 control(source,target,type,seconds){
  if(!this.canControl(target))return 0;
  let until=this.time+seconds;
  if(target.kind==='hero'&&(type==='root'||type==='stun')){
   const previousEnd=Math.max(target.rootUntil,target.stunUntil);
   if(target.controlGuardUntil>this.time && this.time>=target.controlDeadline)return 0;
   if(!target.controlDeadline || this.time>=previousEnd+controlLinkGap)
    target.controlDeadline=this.time+controlLimit;
   until=Math.min(until,target.controlDeadline);
   if(until>=target.controlDeadline)target.controlGuardUntil=target.controlDeadline+controlRecovery;
   if(until<=this.time)return 0;
  }
  const key=type+'Until';target[key]=Math.max(target[key]??0,until);target.recallAt=0;
  if(target.kind==='hero'){this.recordControl(source,target,type,until-this.time);target.contributors[source.id]=this.time;target.queuedOrder=null;if(type==='stun'||type==='silence')this.cancelCast(target,type==='silence');}
  return until-this.time;
 }
 support(source,target){if(source.id===target.id)return;target.supportedBy??={};target.supportedBy[source.id]=this.time;}
 pushAway(source,target,length){if(!this.canControl(target))return;this.recordControl(source,target,'knockback',.25);const d=vector(source,target);for(let i=0;i<length/.2;i++){const p={x:target.x+d.x*.2,z:target.z+d.z*.2};if(blocked(p.x,p.z,target.radius)||this.structureBlocked(target,p))break;Object.assign(target,p);}target.path=[];target.separationUntil=this.time+.25;}
 shield(source,target,amount,duration){
  if(source.buffUntil>this.time)amount*=1.15;
  if(target.shieldUntil>this.time&&target.shield>amount)return;
  const until=this.time+duration;
  target.shieldUntil=target.shield===amount?Math.max(target.shieldUntil,until):until;
  target.shield=amount;target.shieldSource=source.id;
  this.support(source,target);this.emit('shield',{source:source.id,target:target.id,amount});
 }
 heal(source,target,amount){amount*=(source.heroId==='barista'&&target.hp<target.maxHp*.5?1.15:1)*(1+stats(source).healing)*(source.buffUntil>this.time?1.15:1);const actual=Math.min(amount,target.maxHp-target.hp);target.hp+=actual;source.healing+=actual;if(actual>0){this.support(source,target);if(target.lastFight>this.time-6)this.grantSupport(source,target,'combat');}this.emit('heal',{source:source.id,target:target.id,amount:Math.round(actual)});}
 inkHit(source,target){
  if(source.heroId!=='printer'||target.kind!=='hero'||!this.canControl(target))return;
  const ink=source.ink[target.id]??{count:0,until:0};
  ink.count=ink.until>this.time?ink.count+1:1;ink.until=this.time+8;
  if(ink.count>=3){
   ink.count=0;
   // Strip shield first; unused shield damage never spills into health.
   if(target.shieldUntil>this.time)target.shield=Math.max(0,target.shield-(90+source.level*10));
   this.damage(source,target,65+source.level*8,'ink_pop');
  }
  source.ink[target.id]=ink;
 }
 coveredByBoard(target,source){
  if(target.kind!=='hero'||source.kind!=='hero')return false;
  return this.heroes.some(guard=>{
   if(guard.heroId!=='custodian'||guard.team!==target.team||guard===target||!alive(guard)||guard.guardUntil<=this.time)return false;
   const dx=target.x-guard.x,dz=target.z-guard.z,fx=-Math.sin(guard.angle),fz=-Math.cos(guard.angle);
   const behind=-(dx*fx+dz*fz);
   if(behind<=0||behind>3.5||Math.abs(dx*fz-dz*fx)>1.4)return false;
   const direction=vector(guard,source);
   return direction.x*fx+direction.z*fz>.25&&clearLine(guard,target,.1);
  });
 }
 sourceInfo(source){return{id:source.id,name:source.name??HEROES[source.heroId]?.name??({tower:'防御塔',minion:'小兵',monster:'野怪',core:'基地'})[source.kind]??'敌人',heroId:source.heroId??null,kind:source.kind};}
 recordControl(source,target,type,duration){
  if(target.kind!=='hero'||duration<=0)return;
  const info=this.sourceInfo(source);target.recentControls.push({source:info.id,name:info.name,type,duration,at:this.time});
  target.recentControls=target.recentControls.filter(e=>e.at>=this.time-8).slice(-16);
 }
 refreshSupport(h){
  if(!supportRole(h))return;
  h.supportCredit=Math.min(SUPPORT_INCOME.capacity,h.supportCredit+Math.max(0,this.time-h.supportCreditAt)*SUPPORT_INCOME.perMinute/60);h.supportCreditAt=this.time;
 }
 grantSupport(h,partner,reason){
  if(!h||!partner||partner.kind!=='hero'||!supportRole(h)||supportRole(partner)||h===partner||!alive(h)||!alive(partner)||h.team!==partner.team||distance(h,partner)>SUPPORT_INCOME.radius||!clearLine(h,partner,.1))return 0;
  this.refreshSupport(h);
  if(reason==='combat'&&h.supportProcAt>this.time-SUPPORT_INCOME.combatCooldown)return 0;
  const amount=SUPPORT_INCOME[reason==='lastHit'?'lastHit':'combat'];if(h.supportCredit+1e-6<amount)return 0;
  h.supportCredit=Math.max(0,h.supportCredit-amount);if(reason==='combat')h.supportProcAt=this.time;
  h.supportGold+=amount;this.reward(h,amount,0);this.emit('income',{source:h.id,reason:'support',amount,partner:partner.id});return amount;
 }
 damage(source,target,raw,kind='attack'){
  if(!this.active(target)||!source||!this.enemy(source,target)||this.phase!=='running')return 0;
  if(target.kind==='monster'&&target.returning)return 0;
  if(['tower','core','inhibitor'].includes(target.kind)&&!this.attackableStructure(target))return 0;
  if(target.kind==='hero'&&distance(target,MAP.spawn[target.team])<5)return 0;
  if(HEROES[source.heroId]?.roleId==='jungle'&&target.kind==='monster'&&kind!=='smite')raw*=1.3;
  if(source.heroId==='lecturer'&&kind!=='attack'&&(target.rootUntil>this.time||target.stunUntil>this.time||target.slowUntil>this.time))raw*=1.15;
  if(target.heroId==='custodian'){if(this.heroes.some(a=>a.id!==target.id&&a.team===target.team&&alive(a)&&distance(a,target)<6))raw*=.9;if(target.guardUntil>this.time){const d=vector(target,source);if(d.x*-Math.sin(target.angle)+d.z*-Math.cos(target.angle)>.25)raw*=.45;}}
  if(kind==='attack'&&this.coveredByBoard(target,source))raw*=.65;
  if(['tower','core','inhibitor'].includes(target.kind)){
   if(kind!=='attack'&&kind!=='tower')return 0;
   const escorted=this.units.some(u=>u.kind==='minion'&&u.team===source.team&&alive(u)&&distance(u,target)<13);if(!escorted)raw*=.2;
  }
  if(source.buffUntil>this.time&&kind!=='attack'&&kind!=='smite')raw*=1.15;
  if(source.kind==='minion'&&this.heroes.some(h=>h.team===source.team&&alive(h)&&h.siegeUntil>this.time&&distance(h,source)<18))raw*=1.45;
  if(target.kind==='minion'&&this.heroes.some(h=>h.team===target.team&&alive(h)&&h.siegeUntil>this.time&&distance(h,target)<18))raw*=.65;
  const type=damageTypeFor(source.heroId,kind),defense=type==='true'?0:target.kind==='hero'?stats(target)[type==='magic'?'magicResist':'armor']:target.kind==='tower'?30:8;
  let amount=raw*100/(100+defense);
  if(target.kind==='hero'&&target.shieldUntil>this.time){const absorbed=Math.min(target.shield,amount);target.shield-=absorbed;amount-=absorbed;if(absorbed>0&&source.kind==='hero')this.grantSupport(this.entity(target.shieldSource),target,'combat');}
  amount=Math.min(target.hp,amount);target.hp-=amount;target.lastHit=this.time;target.revealUntil=this.time+2;target.lastHurt=this.time;target.recallAt=0;
  if(target.kind==='monster'&&source.kind==='hero'&&distance(target.home,source)<15)target.focus=source.id;
  if(source.kind==='hero'){source.damage+=amount;source.lastFight=this.time;target.contributors??={};target.contributors[source.id]=this.time;for(const [id,at]of Object.entries(source.supportedBy??{}))if(at>this.time-6)target.contributors[id]=this.time;}
  if(target.kind==='hero'){
   const info=this.sourceInfo(source);target.recentDamage.push({source:info.id,name:info.name,heroId:info.heroId,kind,type,amount:Math.round(amount*10)/10,at:this.time});target.recentDamage=target.recentDamage.filter(e=>e.at>=this.time-8).slice(-24);
   if(source.kind==='hero'){target.lastFight=this.time;const partner=this.heroes.filter(h=>h!==source&&h.team===source.team&&!supportRole(h)&&alive(h)&&distance(h,target)<16&&distance(h,source)<16&&this.visible(h.team,target)).sort((a,b)=>distance(a,target)-distance(b,target))[0];if(partner)this.grantSupport(source,partner,'combat');}
  }
  if(target.kind==='hero'&&source.kind==='hero')for(const tower of this.units)if(tower.kind==='tower'&&tower.team===target.team&&alive(tower)&&distance(tower,source)<=13){if(tower.focus!==source.id)tower.ramp=0;tower.focus=source.id;tower.aggroUntil=this.time+3;}
  if(target.kind==='hero'&&target.heroId==='guardian'&&target.passiveAt<=this.time&&alive(target)){target.passiveAt=this.time+8;this.shield(target,target,70+target.level*10,2.5);}
  this.emit('hit',{source:source.id,target:target.id,amount:Math.round(amount),style:kind,damageType:type,hero:source.heroId??'',at:{x:target.x,z:target.z}});
  if(target.hp<=0)this.kill(source,target);
  return amount;
 }
 reward(h,gold,xp){h.gold+=gold;h.totalGold+=Math.max(0,gold);h.xp+=xp;while(h.level<RULES.maxLevel&&h.xp>=h.level*135){h.xp-=h.level*135;h.level++;const s=stats(h);h.maxHp=s.hp;h.maxMana=s.mana;if(alive(h))h.hp=Math.min(h.hp+70,h.maxHp);h.mana=Math.min(h.mana+22,h.maxMana);this.emit('level',{source:h.id,level:h.level});}}
 kill(source,target){
  if(target.deathSettled)return;target.deathSettled=true;target.hp=0;target.path=[];target.focus=null;
  if(target.kind==='hero'){
   const damage=target.recentDamage.filter(e=>e.at>=this.time-8),controls=target.recentControls.filter(e=>e.at>=this.time-8);
   target.deathRecap={at:this.time,killer:this.sourceInfo(source),damage:copy(damage),controls:copy(controls),total:Math.round(damage.reduce((n,e)=>n+e.amount,0))};
   target.deaths++;target.respawnAt=this.time+8+target.level*1.5+Math.min(15,this.time/90);target.shield=0;target.order=null;this.cancelCast(target);this.metrics.kills++;
   if(source.kind==='hero'){source.kills++;this.reward(source,180,130);}
   for(const h of this.heroes)if(h.id!==source.id&&h.team===source.team&&alive(h)&&(this.time-(target.contributors?.[h.id]??-99)<8||distance(h,target)<10&&supportRole(h))){h.assists++;this.reward(h,70,90);this.grantSupport(h,source,'combat');}
  }else if(target.kind==='minion'){
   const nearby=this.heroes.filter(h=>alive(h)&&h.team===source.team&&distance(h,target)<16);
   const reward=MINION_REWARDS[target.super?'super':target.siege?'siege':target.ranged?'ranged':'melee'];
   if(source.kind==='hero'){
    source.cs++;this.reward(source,reward.gold,0);this.emit('income',{source:source.id,reason:'lastHit',amount:reward.gold,at:{x:target.x,z:target.z}});
    if(!supportRole(source))for(const h of nearby)this.grantSupport(h,source,'lastHit');
   }
   for(const h of nearby)this.reward(h,0,reward.xp/Math.max(1,Math.sqrt(nearby.length)));
  }else if(target.kind==='monster'){
   target.respawnAt=this.time+(['crab','archive'].includes(target.species)?300:120);
   if(target.species==='crab'){for(const h of this.heroes)if(h.team===source.team){this.reward(h,180,140);h.buffUntil=this.time+65;}this.emit('objective',{source:source.id,team:source.team,name:'加单巨蟹',at:{x:target.x,z:target.z}});}
   else if(target.species==='archive'){for(const h of this.heroes)if(h.team===source.team){this.reward(h,220,180);h.siegeUntil=this.time+120;}this.emit('objective',{source:source.id,team:source.team,name:'档案巨像 · 强化身边兵线',at:{x:target.x,z:target.z}});}
   else if(source.kind==='hero'){this.reward(source,target.gold,110);if(target.species==='printer'){source.buffUntil=this.time+40;source.mana=Math.min(source.maxMana,source.mana+150);}}
  }else if(target.kind==='inhibitor'){target.respawnAt=this.time+300;for(const h of this.heroes)if(h.team===source.team)this.reward(h,75,30);this.emit('inhibitor_down',{team:source.team,lane:target.lane,at:{x:target.x,z:target.z}});
  }else if(target.kind==='tower'){if(source.kind==='hero')source.towers=(source.towers??0)+1;for(const h of this.heroes)if(h.team===source.team)this.reward(h,100,50);}
  else if(target.kind==='core'){this.phase='finished';this.winner=source.team;this.projectiles=[];this.casts=[];this.zones=[];this.emit('victory',{team:this.winner,at:{x:target.x,z:target.z}});}
  this.emit('death',{source:source.id,target:target.id,kindOf:target.kind,at:{x:target.x,z:target.z}});
 }
 route(h,to){return findPath(h,to,h.radius??.65,this.units.filter(u=>['tower','core','inhibitor'].includes(u.kind)&&alive(u)));}
 structureBlocked(h,p){return this.units.some(u=>['tower','core','inhibitor'].includes(u.kind)&&alive(u)&&distance(u,p)<u.radius+h.radius&&distance(u,p)<distance(u,h)-.01);}
 move(h,dt,speed){
  if(h.rootUntil>this.time)return;
  if(h.kind!=='hero'&&h.slowUntil>this.time)speed*=1-h.slow;
  if(!h.path?.length)return;let remaining=speed*dt;
  while(remaining>0&&h.path.length){const next=h.path[0],d=distance(h,next);if(d<.12){h.path.shift();continue;}const amount=Math.min(remaining,d),v=vector(h,next),p={x:h.x+v.x*amount,z:h.z+v.z*amount};
   if(blocked(p.x,p.z,h.radius)){h.path=[];break;}
   if(this.structureBlocked(h,p)){const side=[{x:h.x-v.z*amount,z:h.z+v.x*amount},{x:h.x+v.z*amount,z:h.z-v.x*amount}].find(q=>!blocked(q.x,q.z,h.radius)&&!this.structureBlocked(h,q));if(side){h.x=side.x;h.z=side.z;}break;}
   h.x=p.x;h.z=p.z;h.angle=Math.atan2(-v.x,-v.z);remaining-=amount;if(d<=amount+.01)h.path.shift();
  }
 }
 approachCast(h,dt,speed){
  const pending=h.pendingCast;if(!pending)return false;
  const target=this.entity(pending.target),def=HEROES[h.heroId].skills[pending.skill];
  if(!this.active(target)||pending.expiresAt<=this.time||h.silenceUntil>this.time||target.team!==h.team&&!this.visible(h.team,target)||h.cooldowns[pending.skill]>this.time||h.mana<def.mana){h.pendingCast=null;h.path=[];return true;}
  if(distance(h,target)<=def.range&&clearLine(h,target,.1)){h.pendingCast=null;h.path=[];this.cast(h,pending.skill,{target:target.id});return true;}
  if(h.rootUntil>this.time)return true;
  if(!h.path.length||this.tick%8===0)h.path=this.route(h,target);
  if(!h.path.length){h.pendingCast=null;return true;}this.move(h,dt,speed);return true;
 }
 separateUnits(dt){
  // Spatial buckets cap work even when many waves meet. No dynamic A* rebuilds.
  const units=this.all().filter(e=>this.active(e)&&['hero','minion','monster'].includes(e.kind)&&!(e.separationUntil>this.time)),cell=4,buckets=new Map();
  for(let i=0;i<units.length;i++){const e=units[i],key=Math.floor(e.x/cell)+','+Math.floor(e.z/cell);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);}
  const pushes=units.map(()=>({x:0,z:0})),counts=new Uint8Array(units.length);let checks=0;
  const weight=e=>e.stunUntil>this.time||e.rootUntil>this.time||e.castUntil>this.time||e.recallAt>this.time||e.order?.type==='hold'||e.kind==='hero'&&distance(e,MAP.spawn[e.team])<5?0:e.kind==='hero'?.3:1;
  for(let i=0;i<units.length;i++){
   const a=units[i],bx=Math.floor(a.x/cell),bz=Math.floor(a.z/cell);
   for(let x=bx-1;x<=bx+1;x++)for(let z=bz-1;z<=bz+1;z++)for(const j of buckets.get(x+','+z)??[]){
    if(j<=i||counts[i]>=24||counts[j]>=24)continue;counts[i]++;counts[j]++;checks++;
    const b=units[j],d=distance(a,b),desired=(a.radius+b.radius)*.88;if(d>=desired)continue;
    const wa=weight(a),wb=weight(b),total=wa+wb;if(!total)continue;
    const angle=((i*37+j*17)%360)*Math.PI/180,dx=d>.001?(a.x-b.x)/d:Math.cos(angle),dz=d>.001?(a.z-b.z)/d:Math.sin(angle),shift=Math.min(desired-d,dt*5);
    pushes[i].x+=dx*shift*wa/total;pushes[i].z+=dz*shift*wa/total;pushes[j].x-=dx*shift*wb/total;pushes[j].z-=dz*shift*wb/total;
   }
  }
  for(let i=0;i<units.length;i++){
   const e=units[i],p=pushes[i],d=Math.hypot(p.x,p.z),scale=Math.min(1,dt*3/(d||1));if(d<1e-6)continue;
   const q={x:e.x+p.x*scale,z:e.z+p.z*scale};
   if(!blocked(q.x,q.z,e.radius)&&clearLine(e,q,e.radius)&&!this.structureBlocked(e,q))Object.assign(e,q);
  }
  this.metrics.separationChecks=checks;this.metrics.separationMaxBucket=Math.max(0,...[...buckets.values()].map(b=>b.length));
 }
 attack(h,target){
  if(h.attackAt>this.time||!this.active(target)||!clearLine(h,target,.1))return;
  const s=h.kind==='hero'?stats(h):null,interval=s?s.interval*(h.ultUntil>this.time&&['stapler','mechanic'].includes(h.heroId)?.62:1):h.kind==='tower'?1.15:['crab','archive'].includes(h.species)?1.5:1.1;
  h.attackAt=this.time+interval;h.revealUntil=this.time+2;const d=vector(h,target);h.angle=Math.atan2(-d.x,-d.z);h.action='attack';h.actionAt=this.time;h.actionSeq=(h.actionSeq??0)+1;if(h.kind==='tower'&&(h.focus!==target.id||target.kind!=='hero'))h.ramp=0;
  let damage=s?s.attack:h.kind==='tower'?150*(1+.18*(h.ramp??0)):h.kind==='minion'?h.super?95:h.siege?48:h.ranged?24:18:h.species==='archive'?105:h.species==='crab'?95:35;
  if(h.kind==='tower'){h.ramp=target.kind==='hero'&&h.focus===target.id?Math.min(5,(h.ramp??0)+1):0;h.focus=target.id;}
  this.casts.push({source:h.id,target:target.id,auto:true,damage,at:this.time+(h.kind==='tower'?.18:.16)});
  this.emit('attack',{source:h.id,target:target.id,at:{x:h.x,z:h.z},to:{x:target.x,z:target.z},weapon:h.heroId?HEROES[h.heroId].weapon:h.kind});
 }
 resolveAuto(c){const h=this.entity(c.source),target=this.entity(c.target);if(!this.active(h)||!this.active(target)||(h.stunUntil??0)>this.time)return;const range=h.kind==='hero'?stats(h).range+(h.heroId==='stapler'&&h.ultUntil>this.time?2:0):h.kind==='tower'?13:h.kind==='minion'?h.ranged?7:2:h.species==='archive'?12:3.2;
  if(distance(h,target)>range+target.radius+1||!clearLine(h,target,.1))return;
  let damage=c.damage;
  if(h.kind==='hero'){
   if(h.heroId==='stapler'){h.attackCount=h.lastAttackTarget===target.id?h.attackCount+1:1;h.lastAttackTarget=target.id;if(h.attackCount%3===0)damage+=25+h.level*3;if(h.empowered>this.time){damage+=55+h.level*5;h.empowered=0;}}
   if(h.heroId==='archer'&&h.empowered>this.time){damage+=55+h.level*5;h.empowered=0;}
   if(h.heroId==='courier'&&this.time-h.lastFight>4)damage+=45+h.level*4;
   if(h.buffUntil>this.time)damage*=1.15;
  }
  const recover=h.heroId==='mechanic'&&h.empowered>this.time;if(recover)h.empowered=0;
  if(range<4){const actual=this.damage(h,target,damage);if(recover&&actual>0&&alive(h))this.heal(h,h,55+h.level*7);}
  else this.projectile(h,target,{damage,speed:h.kind==='tower'?25:38,width:.3,kind:h.kind==='tower'?'tower':({stapler:'staple',archer:'arrow',printer:'stamp_bolt',lecturer:'light_bolt',barista:'coffee_bolt',broadcaster:'sound'})[h.heroId]??'bullet',target:target.id});
 }
 spawnWave(){
  this.wave++;this.metrics.waves++;this.nextWave+=RULES.waveSeconds;
  let available=RULES.maxUnits-this.units.filter(e=>e.kind==='minion'&&alive(e)).length;
  for(let lane=0;lane<3;lane++)for(let n=0;n<6+(this.wave%3===0?1:0);n++){
   if(available<2)return;available-=2;
   for(let team=0;team<2;team++){
   const route=copy(team===0?MAP.lanes[lane]:[...MAP.lanes[lane]].reverse()),p=route[0],scale=1+Math.floor(this.time/180)*.14,superMinion=!alive(this.entity('inhibitor-'+(1-team)+'-'+lane))&&n===0;
   this.units.push({id:'minion-'+(++this.serial),kind:'minion',team,lane,ranged:n>=3&&n<6,siege:n===6,super:superMinion,x:p.x+(n%2)*1.05,z:p.z+Math.floor(n/2)*1.05,hp:(superMinion?1300:n===6?500:n>=3?190:290)*scale,maxHp:(superMinion?1300:n===6?500:n>=3?190:290)*scale,radius:superMinion?.85:n===6?.7:.48,route,waypoint:1,path:[],attackAt:0,angle:0,contributors:{}});
   }
  }
 }
 // A defensive cast should respond to a threat the team can actually see.
 botCounterMove(h,targets){
  const threats=targets.filter(e=>e.kind==='hero');
  if(!threats.length)return null;
  const cast=(skill,point)=>({type:'cast',skill,x:point.x,z:point.z,target:point.id});
  if(h.heroId==='archer'){
   const close=threats.find(e=>distance(h,e)<5);
   if(!close||h.cooldowns.e>this.time)return null;
   const away=vector(close,h);
   const end={x:h.x+away.x*4.5,z:h.z+away.z*4.5};
   return clearLine(h,end,h.radius)?cast('e',end):null;
  }
  if(h.heroId!=='custodian'&&h.heroId!=='broadcaster')return null;
  const friends=this.heroes.filter(a=>a!==h&&a.team===h.team&&alive(a)&&distance(a,h)<=10);
  if(h.heroId==='broadcaster'){
   const slowed=friends.some(a=>distance(a,h)<=5&&a.slowUntil>this.time);
   const retreat=friends.some(a=>distance(a,h)<=5&&a.hp<a.maxHp*.55&&threats.some(e=>distance(a,e)<8));
   const pursuit=friends.some(a=>distance(a,h)<=5)&&threats.some(e=>e.hp<e.maxHp*.45&&distance(h,e)>6);
   if(h.cooldowns.e<=this.time&&(slowed||retreat||pursuit))return cast('e',h);
   const caster=threats.find(e=>e.castUntil>this.time&&distance(e,h)<=8);
   if(caster&&h.level>=6&&h.cooldowns.r<=this.time)return cast('r',caster);
   return null;
  }
  const carry=friends.find(a=>HEROES[a.heroId].roleId==='marksman')??friends.find(a=>HEROES[a.heroId].roleId==='mage');
  if(!carry)return null;
  const diver=threats.find(e=>distance(e,carry)<=7&&clearLine(carry,e,.1));
  if(!diver)return null;
  const front=vector(carry,diver),push=vector(h,diver),range=distance(h,diver);
  if(front.x*push.x+front.z*push.z>.4){
   if(range<=4&&h.cooldowns.q<=this.time)return cast('q',diver);
   if(range<=7&&distance(carry,diver)<5&&h.level>=6&&h.cooldowns.r<=this.time)return cast('r',diver);
  }
  const spot={x:carry.x+front.x*1.6,z:carry.z+front.z*1.6};
  if(distance(h,spot)>1.25&&clearLine(h,spot,h.radius))return {type:'move',...spot};
  if(h.cooldowns.e<=this.time)return cast('e',diver);
  return null;
 }
 botItems(h){
  const recent=h.recentDamage.filter(e=>e.at>this.time-60),magic=recent.reduce((n,e)=>n+(e.type==='magic'?e.amount:0),0),physical=recent.reduce((n,e)=>n+(e.type==='physical'?e.amount:0),0),defense=magic>physical?'flask':'vest';
  const role=HEROES[h.heroId].roleId,output=role==='mage'?['battery','timer']:role==='support'?['badge','timer']:['stapler','belt'];
  return [...new Set([...RECOMMENDED[h.heroId],defense,...output,'boots',defense==='vest'?'flask':'vest'])];
 }
 towerRisk(h,p){
  return this.units.filter(t=>t.kind==='tower'&&t.team!==h.team&&alive(t)&&distance(t,p)<14).find(t=>{
   const escort=this.units.filter(u=>u.kind==='minion'&&u.team===h.team&&alive(u)&&distance(u,t)<13).length;
   return t.focus===h.id&&t.aggroUntil>this.time||escort<2||h.hp<h.maxHp*.45;
  });
 }
 botLastHit(h,minions){
  const s=stats(h),damage=s.attack*100/108;
  return minions.filter(m=>{
   const delay=.16+Math.max(0,distance(h,m)-(s.range<4?3:0))/(s.range<4?100:38);
   const incoming=this.casts.filter(c=>c.auto&&c.target===m.id&&c.at<=this.time+delay&&this.entity(c.source)?.team===h.team).reduce((n,c)=>n+c.damage*100/108,0)+this.projectiles.filter(p=>p.target===m.id&&p.team===h.team&&distance(p,m)/p.speed<=delay).reduce((n,p)=>n+p.damage*100/108,0);
   const predicted=m.hp-incoming;return distance(h,m)<=s.range+m.radius+2&&predicted>0&&predicted<=damage;
  }).sort((a,b)=>(b.siege?1:0)-(a.siege?1:0)||a.hp-b.hp)[0];
 }
 botObjective(h){
  const friends=this.heroes.filter(a=>a.team===h.team&&alive(a)),role=HEROES[h.heroId].roleId;
  // Enemy positions are consulted only after visibility; own structures and lanes are public.
  const threats=this.units.filter(e=>['tower','core','inhibitor'].includes(e.kind)&&e.team===h.team&&alive(e)&&this.all().some(v=>v.team!==2&&this.enemy(h,v)&&this.active(v)&&this.visible(h.team,v)&&distance(e,v)<14));
  threats.sort((a,b)=>(a.kind==='core'?-1000:0)+distance(h,a)-((b.kind==='core'?-1000:0)+distance(h,b)));
  for(const goal of threats){const assigned=friends.slice().sort((a,b)=>distance(a,goal)-distance(b,goal)).slice(0,goal.kind==='core'?5:2);if(assigned.includes(h))return{...goal,kind:'defend'};}
  if(this.time<180)return null;
  const epicOrder=this.time>=600?['epic-archive','crab']:['crab'];
  for(const id of epicOrder){const goal=this.entity(id);if(this.time<goal.spawnAt||!alive(goal)||friends.length<3)continue;
   // Objective availability is public in the HUD; never use hidden enemy locations.
   const ready=friends.filter(a=>a.level>=(id==='crab'?6:10)&&a.hp>a.maxHp*.65).sort((a,b)=>(HEROES[a.heroId].roleId==='jungle'?-60:0)+distance(a,goal)-((HEROES[b.heroId].roleId==='jungle'?-60:0)+distance(b,goal))).slice(0,3);
   if(ready.length>=3&&ready.includes(h)&&ready.some(a=>HEROES[a.heroId].roleId==='jungle'))return{...goal,kind:'epic'};
  }
  if(this.time>=480&&role!=='jungle'){
   const lanes=[0,1,2].map(lane=>{const buildings=this.units.filter(u=>u.team!==h.team&&['tower','inhibitor'].includes(u.kind)&&u.lane===lane&&alive(u)&&this.attackableStructure(u));return{lane,goal:buildings[0],removed:this.units.filter(u=>u.team!==h.team&&u.lane===lane&&!alive(u)).length};}).filter(v=>v.goal).sort((a,b)=>b.removed-a.removed||a.lane-b.lane);
   const lane=lanes[0];if(lane&&friends.filter(a=>distance(a,MAP.spawn[h.team])>15).length>=3)return{...lane.goal,kind:'push'};
  }
  return null;
 }
 bot(h){
  while(skillPoints(h)>0){const key=(canLearn(h,'r')?['r']:['q','e','w'].some(k=>skillRank(h,k)===0)?['q','e','w'].filter(k=>skillRank(h,k)===0):['q','e','w']).find(k=>canLearn(h,k));if(!key)break;h.skillRanks[key]++;}
  if(!alive(h))return;
  const command=m=>this.command(h.id,{seq:h.lastSeq+1,...m});
  const inBase=distance(h,MAP.spawn[h.team])<7,items=this.botItems(h);
  if(inBase){for(const item of items)if(!h.items.includes(item)&&h.items.length<RULES.itemSlots&&h.gold>=ITEMS[item].price)this.buy(h,item);for(const item of h.items)if(h.gold>=upgradePrice(item)&&h.itemRanks?.[item]!==1)this.upgrade(h,item);if(h.hp<h.maxHp*.85||h.mana<h.maxMana*.7)return;}
  const visibleEnemies=this.heroes.filter(e=>this.enemy(h,e)&&alive(e)&&this.visible(h.team,e)),nearEnemies=visibleEnemies.filter(e=>distance(h,e)<18);
  if(h.summoners.f<=this.time&&!(h.castUntil>this.time)&&HEROES[h.heroId].roleId!=='jungle'&&(h.hp<h.maxHp*.45||this.heroes.some(a=>a.team===h.team&&alive(a)&&distance(h,a)<8&&a.hp<a.maxHp*.35&&a.lastFight>this.time-5))){if(command({type:'summoner',skill:'f'}).ok)return;}
  const danger=this.towerRisk(h,h);
  if((h.hp<h.maxHp*.3&&nearEnemies.some(e=>distance(h,e)<8))||danger){
   const away=danger?vector(danger,h):vector(nearEnemies[0],h),retreat=nearestOpen({x:h.x+away.x*10,z:h.z+away.z*10},h.radius);
   if(retreat){if(h.hp<h.maxHp*.35&&h.summoners.d<=this.time&&command({type:'summoner',skill:'d',...retreat}).ok)return;if(command({type:'move',...retreat}).ok)return;}
  }
  if(!inBase&&h.lastFight<this.time-6&&!nearEnemies.length&&(h.mana<h.maxMana*.18||h.gold>=1000&&(items.some(i=>!h.items.includes(i)&&h.items.length<RULES.itemSlots&&h.gold>=ITEMS[i].price)||h.items.some(i=>h.itemRanks[i]!==1&&h.gold>=upgradePrice(i))))){if(!h.recallAt)command({type:'recall'});return;}
  if(h.hp<h.maxHp*.24){if(distance(h,MAP.spawn[h.team])<7)return;if(h.lastHurt<this.time-3){if(!h.recallAt)command({type:'recall'});return;}command({type:'move',...MAP.spawn[h.team]});return;}
  if(h.recallAt||h.castUntil>this.time||h.pendingCast)return;
  if(h.wardAt<=this.time&&this.time>=60&&!inBase&&!nearEnemies.length&&h.lastFight<this.time-3&&!this.units.some(u=>u.kind==='monster'&&this.active(u)&&distance(h,u)<10&&this.visible(h.team,u))){const spot=MAP.brush.filter(p=>distance(h,p)<11&&!this.units.some(w=>w.kind==='ward'&&w.team===h.team&&alive(w)&&distance(w,p)<14)).sort((a,b)=>distance(h,a)-distance(h,b))[0];if(spot&&command({type:'ward',x:spot.x,z:spot.z}).ok)return;}
  const targets=this.all().filter(e=>this.active(e)&&!e.returning&&this.enemy(h,e)&&this.visible(h.team,e)&&distance(h,e)<17&&this.attackableStructure(e));
  targets.sort((a,b)=>(a.kind==='hero'? -4:0)+distance(h,a)-((b.kind==='hero'? -4:0)+distance(h,b)));
  const counter=this.botCounterMove(h,targets);
  if(counter&&command(counter).ok)return;
  const role=HEROES[h.heroId].roleId,creeps=targets.filter(e=>e.kind==='minion'),lastHit=this.botLastHit(h,creeps),partner=this.heroes.filter(a=>a!==h&&a.team===h.team&&alive(a)&&!supportRole(a)&&distance(a,h)<16).sort((a,b)=>(HEROES[a.heroId].roleId==='marksman'?-20:0)+distance(h,a)-((HEROES[b.heroId].roleId==='marksman'?-20:0)+distance(h,b)))[0];
  let target=(lastHit&&(!supportRole(h)||!partner)?lastHit:null)??targets.find(e=>e.kind==='hero'&&distance(h,e)<=stats(h).range+3&&!this.towerRisk(h,e))??targets.find(e=>['tower','inhibitor','core'].includes(e.kind)&&!this.towerRisk(h,e))??(role==='jungle'?targets.find(e=>e.kind==='monster'):null);
  if(role==='jungle'&&h.summoners.f<=this.time){const smite=targets.find(e=>e.kind==='monster'&&distance(h,e)<=10&&e.hp<=600+h.level*30);if(smite&&command({type:'summoner',skill:'f',target:smite.id}).ok)return;}
  if(!target&&creeps.length){
   const ranged=stats(h).range>=5,safe=creeps.filter(e=>!this.towerRisk(h,e));
   if(!nearEnemies.length&&!supportRole(h))target=safe.sort((a,b)=>a.hp-b.hp)[0];
   else if(supportRole(h)&&partner)target=safe.find(e=>e.hp>stats(h).attack*3);
   if(!target){if(h.order?.type==='attack')command({type:'stop'});const front=safe[0];if(front&&distance(h,front)>stats(h).range+1){const back=vector(front,MAP.spawn[h.team]);command({type:'move',x:front.x+back.x*(ranged?stats(h).range:3),z:front.z+back.z*(ranged?stats(h).range:3)});}return;}
  }
  if(h.heroId==='barista'){
   const ally=this.heroes.filter(a=>a.team===h.team&&alive(a)&&distance(h,a)<10&&a.hp<a.maxHp*.75).sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp)[0];
   if(ally&&h.cooldowns.q<=this.time&&command({type:'cast',skill:'q',target:ally.id,x:ally.x,z:ally.z}).ok)return;
   if(ally&&h.level>=6&&h.cooldowns.r<=this.time&&command({type:'cast',skill:'r',x:ally.x,z:ally.z}).ok)return;
  }
  if(target){
   if(h.heroId==='mechanic'&&h.empowered>this.time&&distance(h,target)<4){if(h.order?.target!==target.id)command({type:'attack',target:target.id});return;}
   if(target.kind==='hero'||target.kind==='monster'){
    const d=distance(h,target);for(const key of (h.heroId==='printer'?['e','q','w','r']:h.heroId==='mechanic'?['e','r','q','w']:['r','q','w','e'])){const def=HEROES[h.heroId].skills[key];if(!skillRank(h,key)||h.cooldowns[key]>this.time||h.mana<def.mana||h.heroId==='barista'&&key==='q'||def.target==='enemy'&&target.kind!=='hero')continue;
     if(h.heroId==='archer'&&key==='e'||h.heroId==='broadcaster'&&key==='e')continue;
     if(h.heroId==='broadcaster'&&key==='r'&&targets.filter(e=>e.kind==='hero'&&distance(h,e)<=8).length<2)continue;
     if((def.range>0&&d<=def.range)||def.target==='self'&&d<(def.radius||8)||h.heroId==='custodian'&&key==='e'&&d<10)if(command({type:'cast',skill:key,target:target.id,x:target.x,z:target.z}).ok)return;
    }
   }
   if(h.order?.target!==target.id)command({type:'attack',target:target.id});return;
  }
  const objective=this.botObjective(h);h.botGoal=objective?{kind:objective.kind,id:objective.id}:null;
  if(objective){
   if(objective.kind==='epic'&&this.visible(h.team,objective)&&this.heroes.filter(a=>a.team===h.team&&alive(a)&&distance(a,objective)<24).length>=2)command({type:'attack',target:objective.id});
   else if(!h.path.length||h.order?.type!=='move'&&h.order?.type!=='attack_move'||distance(h.order,objective)>3)command({type:objective.kind==='epic'?'move':'attack_move',x:objective.x,z:objective.z});
   return;
  }
  if(HEROES[h.heroId].roleId==='jungle'){
   const camps=MAP.camps.filter(c=>!['crab','archive'].includes(c.kind)&&(h.level>=6||c.id.startsWith('camp-'+h.team))),memory=h.campMemory??={};
   for(let i=0;i<camps.length;i++){
    const slot=(h.campCursor??0)%camps.length,camp=camps[slot],unit=this.entity(camp.id),seen=this.visible(h.team,unit);
    if(seen&&!alive(unit))memory[camp.id]=unit.respawnAt;
    if((memory[camp.id]??0)>this.time||seen&&unit.returning){h.campCursor=slot+1;continue;}
    if(seen&&this.active(unit))command({type:'attack',target:unit.id});else if(!h.path.length||h.order?.type!=='move')command({type:'move',x:camp.x,z:camp.z});return;
   }
  }
  if(supportRole(h)&&partner){if(distance(h,partner)>5){const back=vector(partner,MAP.spawn[h.team]);command({type:'move',x:partner.x+back.x*2,z:partner.z+back.z*2});}return;}
  const lane=Math.max(0,HEROES[h.heroId].lane),route=h.team===0?MAP.lanes[lane]:[...MAP.lanes[lane]].reverse();
  if(!h.path.length||h.order?.type==='attack_move'&&distance(h,h.order)<2){let closest=0;for(let i=1;i<route.length;i++)if(distance(h,route[i])<distance(h,route[closest]))closest=i;const next=closest+(distance(h,route[closest])<6?1:0),goal=route[next]??this.entity('core-'+(1-h.team));command({type:'attack_move',x:goal.x,z:goal.z});}
 }
 attackableStructure(e){
  if(e.kind==='tower'&&e.tier===3)return this.units.some(t=>t.kind==='inhibitor'&&t.team===e.team&&!alive(t));
  if(e.kind==='tower'&&e.tier>0)return!this.units.some(t=>t.kind==='tower'&&t.team===e.team&&t.lane===e.lane&&t.tier===e.tier-1&&alive(t));
  if(e.kind==='inhibitor')return!this.units.some(t=>t.kind==='tower'&&t.team===e.team&&t.lane===e.lane&&t.tier===2&&alive(t));
  if(e.kind==='core')return this.units.some(t=>t.kind==='inhibitor'&&t.team===e.team&&!alive(t))&&!this.units.some(t=>t.kind==='tower'&&t.team===e.team&&t.tier===3&&alive(t));
  return true;
 }
 step(dt=1/RULES.hz){
  if(this.phase!=='running')return;dt=clamp(dt,0,.1);this.time+=dt;this.tick++;
  for(const u of this.units)if(u.kind==='inhibitor'&&!alive(u)&&u.respawnAt<=this.time){u.hp=u.maxHp;u.deathSettled=false;this.emit('inhibitor_restored',{team:u.team,lane:u.lane,at:{x:u.x,z:u.z}});}
  if(this.time>=this.nextWave)this.spawnWave();
  const ready=this.casts.filter(c=>c.at<=this.time);this.casts=this.casts.filter(c=>c.at>this.time);for(const c of ready)c.auto?this.resolveAuto(c):this.resolveCast(c);
  for(const h of this.heroes){
   const s=stats(h);this.reward(h,RULES.passiveGold*dt,0);this.refreshSupport(h);if(h.shieldUntil<=this.time)h.shield=0;
   if(!alive(h)){if(h.respawnAt<=this.time){Object.assign(h,{...MAP.spawn[h.team],hp:h.maxHp,mana:h.maxMana,order:null,path:[],recallAt:0,stunUntil:0,rootUntil:0,controlDeadline:0,controlGuardUntil:0,silenceUntil:0,guardUntil:0,hasteUntil:0,empowered:0,ultUntil:0,slowUntil:0,shield:0,supportedBy:{},contributors:{},pendingCast:null,recentDamage:[],recentControls:[],deathSettled:false,separationUntil:this.time+.25});this.emit('respawn',{source:h.id});}continue;}
   const atBase=distance(h,MAP.spawn[h.team])<7;h.hp=Math.min(h.maxHp,h.hp+dt*(atBase?h.maxHp*.18:s.regen));h.mana=Math.min(h.maxMana,h.mana+dt*(atBase?h.maxMana*.22:4));
   if(h.recallAt){if(h.recallAt<=this.time){Object.assign(h,MAP.spawn[h.team]);h.recallAt=0;h.separationUntil=this.time+.25;this.emit('recall',{source:h.id});}continue;}
   if(h.stunUntil>this.time||h.castUntil>this.time)continue;
   if(this.approachCast(h,dt,s.speed*(h.slowUntil>this.time?1-h.slow:1)*(h.hasteUntil>this.time?1.2:1)))continue;
   let target=h.order?.type==='attack'?this.entity(h.order.target):null;
   if(['attack_move','hold'].includes(h.order?.type))target=this.all().filter(e=>this.active(e)&&this.enemy(h,e)&&e.team!==2&&distance(h,e)<s.range+1&&this.visible(h.team,e)&&this.attackableStructure(e)).sort((a,b)=>distance(h.order.type==='attack_move'?h.order:h,a)-distance(h.order.type==='attack_move'?h.order:h,b))[0];
   if(target&&(!this.active(target)||!this.visible(h.team,target))){h.order=null;h.path=[];target=null;}
   if(target){const range=s.range+(h.heroId==='stapler'&&h.ultUntil>this.time?2:0)+target.radius;if(distance(h,target)<=range&&clearLine(h,target,.1)){h.path=[];this.attack(h,target);continue;}if(h.order?.type!=='hold'&&(!h.path.length||this.tick%15===0))h.path=this.route(h,target);}
   if(h.rootUntil>this.time||h.order?.type==='hold')continue;this.move(h,dt,s.speed*(h.slowUntil>this.time?1-h.slow:1)*(h.hasteUntil>this.time?1.2:1));
  }
  for(const u of this.units){
   if(u.kind==='inhibitor')continue;
   if(u.kind==='ward'){if(u.endAt<=this.time)u.hp=0;continue;}
   if(u.kind==='core')continue;
   if(u.kind==='monster'&&!alive(u)&&u.respawnAt<=this.time){u.hp=u.maxHp;Object.assign(u,u.home);u.contributors={};u.deathSettled=false;}
   if(!this.active(u)||u.stunUntil>this.time)continue;
   const range=u.kind==='tower'?13:u.kind==='minion'?u.ranged?7:2:u.species==='archive'?12:u.species==='crab'?3.7:2.4;
   if(u.kind==='monster'){
    const prior=this.entity(u.focus);
    if(!u.returning&&(distance(u,u.home)>14||prior&&distance(prior,u.home)>15)){
     u.returning=true;u.focus=null;u.path=[];u.slamAt=0;u.contributors={};this.casts=this.casts.filter(c=>c.source!==u.id);
    }
    if(u.returning){
     if(distance(u,u.home)<.6){Object.assign(u,u.home);u.returning=false;u.hp=u.maxHp;u.path=[];}
     else{if(!u.path.length)u.path=this.route(u,u.home);this.move(u,dt,7);u.hp=Math.min(u.maxHp,u.hp+dt*u.maxHp*.2);}
     continue;
    }
    let target=this.entity(u.focus);if(!alive(target)||distance(u.home,target)>15||distance(u,target)>18){target=this.heroes.filter(h=>alive(h)&&distance(h,u.home)<=15&&distance(h,u)<(u.species==='crab'?5:4)).sort((a,b)=>distance(u,a)-distance(u,b))[0];u.focus=target?.id;}
    if(!target){u.beamAt=0;if(distance(u,u.home)>.5){if(!u.path.length)u.path=this.route(u,u.home);this.move(u,dt,5);}u.hp=Math.min(u.maxHp,u.hp+dt*u.maxHp*.08);continue;}
    if(u.species==='archive'&&this.time>=(u.specialAt??0)&&!u.beamAt){u.specialAt=this.time+5;u.beamAt=this.time+.55;u.beamTo={x:target.x,z:target.z};this.emit('archive_prepare',{source:u.id,at:{x:u.x,z:u.z},to:u.beamTo});}
    if(u.beamAt&&u.beamAt<=this.time){for(const h of this.heroes)if(alive(h)&&segmentDistance(h,u,u.beamTo)<1.8&&clearLine(u,h,.1))this.damage(u,h,170,'archive_beam');this.emit('archive_beam',{source:u.id,at:{x:u.x,z:u.z},to:u.beamTo});u.beamAt=0;}
    if(distance(u,target)<=range){this.attack(u,target);if(u.species==='crab'&&u.attackAt>this.time+.9&&!u.slamAt){u.slamAt=this.time+.65;this.emit('crab_prepare',{source:u.id,at:{x:u.x,z:u.z},radius:4.5});}}else {if(!u.path.length||this.tick%15===0)u.path=this.route(u,target);this.move(u,dt,u.species==='crab'?3.2:4.3);}
    if(u.slamAt&&u.slamAt<=this.time){for(const h of this.heroes)if(alive(h)&&distance(u,h)<4.5)this.damage(u,h,110,'crab_slam');this.emit('slam',{source:u.id,at:{x:u.x,z:u.z},radius:4.5});u.slamAt=0;}continue;
   }
   let targets=this.all().filter(e=>this.active(e)&&e.team!==2&&this.enemy(u,e)&&distance(u,e)<(u.kind==='tower'?range+e.radius:9)&&this.visible(u.team,e)&&this.attackableStructure(e));
   targets.sort((a,b)=>(a.kind==='minion'?-3:0)+distance(u,a)-((b.kind==='minion'?-3:0)+distance(u,b)));
   let target;
   if(u.kind==='tower'){
    const inRange=targets.filter(e=>distance(u,e)<=range+e.radius&&clearLine(u,e,.1));
    const focused=inRange.find(e=>e.id===u.focus),minions=inRange.filter(e=>e.kind==='minion');
    target=(u.aggroUntil>this.time&&focused?.kind==='hero'?focused:null)??
      (minions.length?(focused?.kind==='minion'?focused:minions[0]):focused??inRange[0]);
    if(!target){u.focus=null;u.ramp=0;}
   }else target=targets[0];
   if(target&&distance(u,target)<=range+target.radius&&clearLine(u,target,.1)){this.attack(u,target);continue;}
   if(u.kind==='tower')continue;
   const goal=target??u.route[u.waypoint]??MAP.spawn[1-u.team];if(distance(u,goal)<1.5&&!target)u.waypoint++;
   if(!u.path.length||this.tick%20===0)u.path=this.route(u,goal);this.move(u,dt,4.4);
  }
  for(const p of this.projectiles){
   if(p.dead)continue;const source=this.entity(p.source);if(!source){p.dead=true;continue;}const from={x:p.x,z:p.z};
   if(p.target){const t=this.entity(p.target);if(!this.active(t)){p.dead=true;continue;}const d=vector(p,t);p.dx=d.x;p.dz=d.z;}
   const travel=Math.min(p.speed*dt,Math.max(0,p.remaining));
   const end={x:from.x+p.dx*travel,z:from.z+p.dz*travel};let wallHit=false;
   // The wall clips this sweep; entities before that wall can still be hit.
   if(!clearLine(from,end,.1)){
    wallHit=true;let lo=0,hi=1;
    for(let i=0;i<12;i++){const t=(lo+hi)/2,q={x:from.x+(end.x-from.x)*t,z:from.z+(end.z-from.z)*t};if(clearLine(from,q,.1))lo=t;else hi=t;}
    end.x=from.x+(end.x-from.x)*lo;end.z=from.z+(end.z-from.z)*lo;
   }
   const dx=end.x-from.x,dz=end.z-from.z,length=Math.hypot(dx,dz),ux=dx/(length||1),uz=dz/(length||1);
   p.x=end.x;p.z=end.z;p.remaining=Math.max(0,p.remaining-length);
   const hits=this.all().filter(e=>this.active(e)&&!e.returning&&this.enemy(source,e)&&!p.hit.includes(e.id)&&(!p.target||e.id===p.target)&&segmentDistance(e,from,end)<=e.radius+p.width).map(target=>{
    const tx=target.x-from.x,tz=target.z-from.z,projection=tx*ux+tz*uz,side2=tx*tx+tz*tz-projection*projection;
    const entry=clamp(projection-Math.sqrt(Math.max(0,(target.radius+p.width)**2-side2)),0,length);
    return{target,entry,impact:{x:from.x+ux*entry,z:from.z+uz*entry}};
   }).sort((a,b)=>a.entry-b.entry||a.target.id.localeCompare(b.target.id));
   for(const {target,impact} of hits){
    if(!p.target&&['tower','core','inhibitor'].includes(target.kind))continue;
    // Freeze impact before damage, knockback or hook changes target coordinates.
    p.hit.push(target.id);this.damage(source,target,p.damage,p.target?'attack':p.kind);
    if(p.slow&&this.canControl(target)){target.slow=p.slow;target.slowUntil=this.time+1.5;}
    if(p.stun)this.control(source,target,'stun',p.stun);
    if(p.pull&&this.canControl(target)){this.recordControl(source,target,'pull',.25);const d=vector(target,source),length=Math.min(3,distance(source,target)-2);for(let i=0;i<length/.25;i++){const q={x:target.x+d.x*.25,z:target.z+d.z*.25};if(blocked(q.x,q.z,target.radius)||this.structureBlocked(target,q))break;Object.assign(target,q);}target.separationUntil=this.time+.25;this.emit('hook',{source:source.id,target:target.id,at:{x:source.x,z:source.z},to:{x:target.x,z:target.z}});}
    if(!p.target)this.inkHit(source,target);
    if(!p.pierce){Object.assign(p,impact);p.dead=true;break;}
   }
   if(wallHit||p.remaining<=0||p.endAt<=this.time)p.dead=true;
   if(p.dead)this.endProjectile(p,from);
  }
  this.projectiles=this.projectiles.filter(p=>!p.dead).slice(-256);
  for(const z of this.zones){
   if(z.nextAt>this.time||z.endAt<=this.time)continue;
   z.nextAt=this.time+.5;const source=this.entity(z.source);if(!source)continue;
   if(z.kind==='tea'){
    const wounded=this.heroes.filter(a=>alive(a)&&a.team===z.team&&a.hp<a.maxHp&&distance(z,a)<=z.radius&&clearLine(z,a,.1));
    wounded.sort((a,b)=>a.hp/a.maxHp-b.hp/b.maxHp || distance(z,a)-distance(z,b) || a.id.localeCompare(b.id));
    for(const a of wounded.slice(0,3))this.heal(source,a,z.heal*.5);
    continue;
   }
   for(const e of this.all()){
    if(!this.canControl(e)||e.team===z.team)continue;
    const offset=distance(z,e);
    if(offset>z.radius||!clearLine(z,e,.1))continue;
    const outer=z.kind==='projection'&&offset>z.radius*.6;
    if(z.damage>0)this.damage(source,e,z.damage*.5*(outer ? .65 : 1),z.kind);
    if(z.slow){e.slow=z.slow;e.slowUntil=this.time+.65;}
   }
  }
  this.zones=this.zones.filter(z=>z.endAt>this.time);this.units=this.units.filter(u=>!['minion','ward'].includes(u.kind)||alive(u));
  this.separateUnits(dt);
  this.metrics.maxUnits=Math.max(this.metrics.maxUnits,this.units.length+10);
  if(this.time>=this.botAt){this.botAt=this.time+.25;for(const h of this.heroes)if(h.bot||!h.connected)this.bot(h);}
 }
 playerState(selfId){const self=this.heroes.find(h=>h.id===selfId);return self?{id:self.id,heroId:self.heroId,hp:self.hp,maxHp:self.maxHp,mana:self.mana,maxMana:self.maxMana,gold:Math.floor(self.gold),level:self.level,xp:self.xp,nextXp:self.level*135,items:[...self.items],itemRanks:{...self.itemRanks},cooldowns:{...self.cooldowns},skills:Object.fromEntries(['q','w','e','r'].map(k=>[k,skillRank(self,k)])),skillPoints:skillPoints(self),learnable:['q','w','e','r'].filter(k=>canLearn(self,k)),summoners:{...self.summoners},wardAt:self.wardAt,respawnAt:self.respawnAt,recallAt:self.recallAt,silenced:self.silenceUntil>this.time,rooted:self.rootUntil>this.time,lastSeq:self.lastSeq,stats:stats(self),cs:self.cs,totalGold:Math.floor(self.totalGold),supportGold:self.supportGold,supportIncome:supportRole(self)?{gold:self.supportGold,available:Math.floor(self.supportCredit),capacity:SUPPORT_INCOME.capacity,perMinute:SUPPORT_INCOME.perMinute}:null,deathRecap:copy(self.deathRecap),pendingCast:self.pendingCast?{skill:self.pendingCast.skill,target:self.pendingCast.target}:null}:null;}
 scoreState(h,team){return{id:h.id,name:h.name,team:h.team,heroId:h.heroId,kills:h.kills,deaths:h.deaths,assists:h.assists,level:h.level,connected:h.connected,bot:h.bot,cs:h.cs,...(h.team===team||this.phase==='finished'?{totalGold:Math.floor(h.totalGold),supportGold:h.supportGold,items:[...h.items],itemRanks:{...h.itemRanks}}:{}),...(this.phase==='finished'?{damage:Math.round(h.damage),healing:Math.round(h.healing),towers:h.towers??0}:{})};}
 snapshots(seats){const teams=new Map();return seats.map(seat=>{let base=teams.get(seat.team);if(!base){base=this.snapshot(seat.team,seat.id);teams.set(seat.team,base);}return{seat,state:{...base,selfId:seat.id,self:this.playerState(seat.id)}};});}
 motion(e){
  if(!e.path?.length||e.stunUntil>this.time||e.rootUntil>this.time||e.castUntil>this.time||e.hp<=0)return{x:0,z:0};
  const d=vector(e,e.path[0]),speed=e.kind==='hero'?stats(e).speed*(e.slowUntil>this.time?1-e.slow:1)*(e.hasteUntil>this.time?1.2:1):e.kind==='minion'?4.4:4.3;
  const amount=Math.min(speed,distance(e,e.path[0])*20);return{x:d.x*amount,z:d.z*amount};
 }
 vision(team){
  const at=Math.floor(this.tick/6),cached=this.visionCache.get(team);if(cached?.at===at)return cached.value;
  const cell=4,size=Math.ceil(MAP.size/cell),cells=Array(size*size).fill('0'),half=MAP.size/2;
  for(const e of this.all().filter(e=>e.team===team&&this.active(e))){
   const radius=e.kind==='hero'?RULES.vision:e.kind==='tower'?22:e.kind==='ward'?20:14;
   const x0=Math.max(0,Math.floor((e.x-radius+half)/cell)),x1=Math.min(size-1,Math.ceil((e.x+radius+half)/cell));
   const z0=Math.max(0,Math.floor((e.z-radius+half)/cell)),z1=Math.min(size-1,Math.ceil((e.z+radius+half)/cell));
   for(let z=z0;z<=z1;z++)for(let x=x0;x<=x1;x++){const i=z*size+x;if(cells[i]==='1')continue;const p={x:-half+(x+.5)*cell,z:-half+(z+.5)*cell};if(distance(e,p)<radius&&clearLine(e,p,.1))cells[i]='1';}
  }
  const value={size,cells:cells.join('')};this.visionCache.set(team,{at,value});return value;
 }
 snapshot(team,selfId){
  const visible=this.all().filter(e=>this.visible(team,e)&&(!(e.kind==='monster')||this.time>=e.spawnAt));
  const ids=new Set(visible.map(e=>e.id));
  const entities=visible.map(e=>({id:e.id,kind:e.kind,team:e.team,heroId:e.heroId,species:e.species,lane:e.lane,tier:e.tier,role:e.role,ranged:e.ranged,siege:e.siege,super:e.super,name:e.name,x:e.x,z:e.z,vx:this.motion(e).x,vz:this.motion(e).z,lift:e.airborneUntil>this.time?Math.sin(clamp((.65-e.airborneUntil+this.time)/.65,0,1)*Math.PI)*1.5:0,angle:e.angle??0,hp:e.hp,maxHp:e.maxHp,radius:e.radius,shield:e.shield??0,action:e.action??'idle',actionAt:e.actionAt??0,actionSeq:e.actionSeq??0,castWindup:e.castWindup??.16,recalling:!!(e.recallAt>this.time),attackStacks:e.heroId==='stapler'?e.attackCount%3:0,inkStacks:Math.max(0,...this.heroes.filter(h=>h.heroId==='printer').map(h=>h.ink?.[e.id]?.until>this.time?h.ink[e.id].count:0)),returning:!!e.returning,level:e.level,respawnAt:e.team===team?e.respawnAt:undefined,connected:e.kind==='hero'?e.connected:undefined,bot:e.bot,buff:!!(e.buffUntil>this.time),empowered:!!(e.empowered>this.time),ult:!!(e.ultUntil>this.time),steady:!!(e.controlGuardUntil>this.time&&e.controlDeadline<=this.time),stunned:!!(e.stunUntil>this.time),rooted:!!(e.rootUntil>this.time),silenced:!!(e.silenceUntil>this.time),guarding:!!(e.guardUntil>this.time),hasted:!!(e.hasteUntil>this.time),protected:['tower','core','inhibitor'].includes(e.kind)&&!this.attackableStructure(e)}));
  const events=this.events.filter(e=>e.teams.includes(team)&&e.time>this.time-1.5).map(e=>{const r={...e};delete r.teams;if(r.source&&!ids.has(r.source))delete r.source;if(r.target&&!ids.has(r.target))delete r.target;return r;});
  return{type:'state',version:VERSION,phase:this.phase,winner:this.winner,time:this.time,tick:this.tick,team,selfId,vision:this.vision(team),objective:{alive:this.entity('crab').hp>0&&this.time>=this.entity('crab').spawnAt,nextAt:this.time<this.entity('crab').spawnAt?this.entity('crab').spawnAt:this.entity('crab').respawnAt},objectives:['crab','epic-archive'].map(id=>{const e=this.entity(id);return{id,name:id==='crab'?'巨蟹':'巨像',alive:alive(e)&&this.time>=e.spawnAt,nextAt:this.time<e.spawnAt?e.spawnAt:e.respawnAt};}),entities,projectiles:this.projectiles.filter(p=>this.visible(team,p)).map(p=>({id:p.id,source:p.source,x:p.x,z:p.z,dx:p.dx,dz:p.dz,kind:p.kind,team:p.team,width:p.width,speed:p.speed,bornAt:p.bornAt??this.time,remaining:p.remaining})),zones:this.zones.filter(z=>this.visible(team,z)).map(z=>({id:z.id,kind:z.kind,x:z.x,z:z.z,team:z.team,radius:z.radius,endAt:z.endAt})),events,score:this.heroes.map(h=>this.scoreState(h,team)),self:this.playerState(selfId)};
 }
}
