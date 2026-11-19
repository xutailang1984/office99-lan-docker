// In-memory fixtures. No service, real accounts, persistence or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,command,put,base,restored,advance} from './director-helpers.mjs';
import {effectiveWeapon,gearAfterShot} from '../gear-growth.mjs';
import {effectiveRod} from '../crafting-config.mjs';
import {ASSEMBLY_PARTS,ASSEMBLY_ATTACHMENTS,validAttachment} from '../assembly-config.mjs';
import {beginReeling,updateWaiting,updateReeling} from '../fishing-experience.mjs';
import {extractCareerCapsule,importCareerCapsule,validateCareerCapsule} from '../career-state.mjs';
const at=(w,p,id)=>{const t=w.staticWorld().terminals.find(t=>t.id===id);put(p,w,t.x,t.z+1);};
const clear=(w,p)=>{for(const id of [...w.bag(p).itemIds])w.removeItem(w.s.items[id]);};
const accepted=r=>(assert.equal(r.ok,true,r.code),r);
const action=(w,p,name,item,payload={})=>w.command(p,{requestId:p.requestHighWater+1,command:name,payload:{itemId:item.id,stationId:'upgrade',...payload},expectedRevision:item.revision});
const snapshot=w=>structuredClone({items:w.s.items,containers:w.s.containers});
const grant=(w,p,rows)=>rows.forEach(r=>w.addItems(w.bag(p),r.definitionId,r.quantity));

for(const fitting of ASSEMBLY_ATTACHMENTS)test(fitting.id+' installs once, rejects wrong kind and preserves the other fitting',()=>{
 const {w,p}=fixture();clear(w,p);const item=w.createItem(fitting.kind==='weapon'?'dmr':'rod_net',1,w.bag(p),{moduleId:fitting.kind==='weapon'?'dmr_rhythm':'net_quick',magazineAmmo:fitting.kind==='weapon'?3:0});
 grant(w,p,fitting.ingredients);at(w,p,'upgrade');const message={requestId:p.requestHighWater+1,command:'FitAttachment',payload:{itemId:item.id,attachmentId:fitting.id,stationId:'upgrade'},expectedRevision:item.revision};
 accepted(w.command(p,message));const once=snapshot(w);accepted(w.command(p,message));assert.deepEqual(snapshot(w),once);assert(item.moduleId);assert.equal(item.attachmentId,fitting.id);
 assert.equal(action(w,p,'FitAttachment',item,{attachmentId:fitting.id}).code,'ALREADY_MODDED');
 accepted(action(w,p,'RemoveAttachment',item));assert.equal(item.attachmentId,undefined);assert(item.moduleId);assert.equal(item.magazineAmmo,fitting.kind==='weapon'?3:0);w.assertInvariants();
 assert.equal(validAttachment({...item,definitionId:fitting.kind==='weapon'?'rod_net':'dmr',attachmentId:fitting.id}),false);
});

test('replacement needs confirmation and all ingredients before mutation, while other slot and ammunition survive',()=>{
 const {w,p}=fixture();clear(w,p);const item=w.createItem('dmr',1,w.bag(p),{moduleId:'dmr_rhythm',attachmentId:'gun_grip',magazineAmmo:4});at(w,p,'upgrade');
 const before=snapshot(w);assert.equal(action(w,p,'ModGear',item,{moduleId:'dmr_mobile'}).code,'CONFIRM_REPLACE');assert.deepEqual(snapshot(w),before);
 assert.equal(action(w,p,'ModGear',item,{moduleId:'dmr_mobile',replace:true}).code,'NO_MATERIALS');assert.deepEqual(snapshot(w),before);
 grant(w,p,w.c.crafting.modules.find(m=>m.id==='dmr_mobile').ingredients);accepted(action(w,p,'ModGear',item,{moduleId:'dmr_mobile',replace:true}));assert.equal(item.attachmentId,'gun_grip');assert.equal(item.magazineAmmo,4);
});

test('material craft merges into a partial stack in a full bag; a full output stack rejects atomically',()=>{
 for(const quantity of [1,5]){const {w,p}=fixture();clear(w,p);w.addItems(w.bag(p),'trigger_unit',quantity);w.addItems(w.bag(p),'scrap',10);w.addItems(w.bag(p),'spring_parts',4);while(w.bag(p).itemIds.length<w.bag(p).slotLimit)w.createItem('coffee_coupon',1,w.bag(p));at(w,p,'craft');const before=snapshot(w),r=command(w,p,'Craft',{recipeId:'trigger_unit',stationId:'craft'});if(quantity===1){accepted(r);assert.equal(w.count(p,'trigger_unit'),2);assert.equal(w.bag(p).itemIds.length,w.bag(p).slotLimit);}else{assert.equal(r.code,'NO_CAPACITY');assert.deepEqual(snapshot(w),before);}w.assertInvariants();}
});

test('assembled instances survive death and reload; vault preserves fittings while the carried instance drops',()=>{
 const {w,p}=fixture();clear(w,p);const carried=w.createItem('doublebarrel',1,w.bag(p),{moduleId:'doublebarrel_pair',attachmentId:'gun_brake',magazineAmmo:2});const vault=w.createContainer('personal_storage',32,{ownerSlotId:p.slotId});p.vaultId=vault.id;const insured=w.createItem('rod_net',1,vault,{moduleId:'net_wide',attachmentId:'rod_keeper'});w.die(p);assert.equal(w.s.containers[carried.containerId].type,'corpse');assert.equal(insured.containerId,vault.id);const copy=restored(w);for(const id of [carried.id,insured.id]){assert.equal(copy.s.items[id].moduleId,w.s.items[id].moduleId);assert.equal(copy.s.items[id].attachmentId,w.s.items[id].attachmentId);}copy.assertInvariants();
});

test('career transfer preserves fitting ownership; malformed or wrong-kind fittings are rejected',()=>{
 const {w,p}=fixture();p.tokenHash='account:synthetic-assembly';clear(w,p);const item=w.createItem('dmr',1,w.bag(p),{moduleId:'dmr_mobile',attachmentId:'gun_grip',magazineAmmo:5});const capsule=extractCareerCapsule(w.s,'synthetic-assembly');const next=fixture();importCareerCapsule(next.w,next.p,{capsule,revision:3});assert.equal(next.w.s.items[item.id].attachmentId,'gun_grip');assert.equal(next.w.s.items[item.id].moduleId,'dmr_mobile');
 for(const bad of ['rod_marker','fake',false,'']){const invalid=structuredClone(capsule);invalid.backpack[0].attachmentId=bad;assert.throws(()=>validateCareerCapsule(invalid,base));}
});

test('grip helps a moving sight on all eight guns and does not worsen stationary spread; brake trades recoil for reload time',()=>{
 for(const def of base.weapons){const plain=effectiveWeapon(def,{definitionId:def.id},null,0),grip=effectiveWeapon(def,{definitionId:def.id,attachmentId:'gun_grip'},null,0),brake=effectiveWeapon(def,{definitionId:def.id,attachmentId:'gun_brake'},null,0);assert.equal(grip.ads_spread_deg,plain.ads_spread_deg);assert((grip.ads_spread_deg+(grip.move_spread_deg??0))*grip.moving_spread_multiplier<plain.ads_spread_deg+(plain.move_spread_deg??0));assert(grip.ads_seconds>plain.ads_seconds);assert(brake.recoil_pitch_deg<plain.recoil_pitch_deg);assert(brake.reload_seconds>plain.reload_seconds);}
});

test('double barrel switches from two distinct clicks to held paired shots; DMR rewards a deliberate pause',()=>{
 const double=base.weapons.find(d=>d.id==='doublebarrel');assert.equal(double.magazine,2);assert.equal(double.fire_mode,'semi');assert.equal(effectiveWeapon(double,{moduleId:'doublebarrel_pair'},null).fire_mode,'auto');
 const dmr=base.weapons.find(d=>d.id==='dmr'),item={moduleId:'dmr_rhythm'},p={gearLastShotAt:1};assert(effectiveWeapon(dmr,item,p,1.6).ads_spread_deg<effectiveWeapon(dmr,item,p,1.1).ads_spread_deg);assert.equal(dmr.ammo,base.weapons.find(d=>d.id==='rifle').ammo);
});

test('heat core enforces the twelve-round pause; matching new guns have real public presentation stats',()=>{
 const {w,p}=fixture(),item={id:'synthetic-lmg',definitionId:'lmg',moduleId:'lmg_heat'};for(let i=0;i<12;i++)gearAfterShot(w,p,item,effectiveWeapon(base.weapons.find(d=>d.id==='lmg'),item,p,w.s.time));assert.equal(p.fireAt,w.s.time+1);assert.equal(p.gearHeatShots,0);
 const gun=w.equipped(p,'weapon');gun.attachmentId='gun_brake';const exposed=w.publicState().players.find(x=>x.id===p.id);assert(exposed.weaponStats.recoil_pitch_deg<w.defs.weapons[gun.definitionId].recoil_pitch_deg);assert.equal(exposed.heldAttachmentId,'gun_brake');
});

function netRun(core=null,attachment=null,holdForever=false){const item={definitionId:'rod_net',moduleId:core,attachmentId:attachment},def=effectiveRod(base.rods.find(d=>d.id==='rod_net'),item),p={x:0,z:0,input:{reel:false}},f={remaining:6,state:'WAIT',progress:0,tension:0,resistance:1};let closed=false;
 for(let i=0;i<1200;i++){const t=i/30;p.input.reel=closed?(holdForever||t%1.3<.7):t>=3.4;if(!closed){const wait=updateWaiting(f,p,def,1/30,base.fishing);if(wait.autoHook){closed=true;f.state='REEL';beginReeling(f,p,def);}}else{const rates=updateReeling(f,p,def,1/30,base.fishing);if(p.input.reel){f.progress+=rates.progressRate/30;f.tension+=rates.tensionRate/30;}else{f.progress-=rates.lossRate/30;f.tension=Math.max(0,f.tension-def.tension_fall/30);}if(f.progress>=100||f.tension>=100)return {f,seconds:t};}}return {f,seconds:40};}
for(const core of [null,'net_quick','net_wide'])for(const accessory of [null,'rod_marker','rod_keeper'])test('net '+core+'/'+accessory+' completes with pull/rest input and stays within two catches',()=>{const {f}=netRun(core,accessory);assert(f.progress>=100);assert(f.tension<100);assert.equal(f.netBatch,core==='net_quick'?1:2);});
test('net hard pulling fails; wide frame genuinely reduces strain at a slower pace, marker speeds gathering',()=>{
 assert(netRun(null,null,true).f.tension>=100);const plain=effectiveRod(base.rods.find(d=>d.id==='rod_net'),{definitionId:'rod_net'}),wide=effectiveRod(plain,{moduleId:'net_wide'}),keeper=effectiveRod(plain,{attachmentId:'rod_keeper'});assert(wide.tension_rise<plain.tension_rise&&wide.reel_power<plain.reel_power);assert(keeper.tension_rise<plain.tension_rise&&keeper.reel_power<plain.reel_power);
 const p={x:0,z:0,input:{reel:false}},f={remaining:6},other={remaining:6};for(let i=0;i<75;i++){updateWaiting(f,p,plain,1/30);updateWaiting(other,p,effectiveRod(plain,{attachmentId:'rod_marker'}),1/30);}assert(other.activity>f.activity&&other.cue==='net_ready');
});
test('finite field loot and targeted fish supply the six components without opening rerolls',()=>{
 const {w,p}=fixture();for(const [creature,part] of [['silverfish','float_unit'],['spring_shrimp','spool_unit']]){const e=w.spawnEnemy(creature,p.x,p.z-2,false);e.night=false;e.source='fishing';w.killEnemy(e,p.id);assert(Object.values(w.s.items).some(i=>i.definitionId===part));}assert.equal(ASSEMBLY_PARTS.length,6);w.assertInvariants();
});

for(const core of [null,'net_quick','net_wide'])test('actual world net cast lands bounded living catches with core '+core,()=>{
 const {w,p}=fixture();w.setPhase('DAY');w.s.enemies={};put(p,w,0,99);for(const id of [...w.s.containers[p.equipment.rod].itemIds])w.removeItem(w.s.items[id]);w.createItem('rod_net',1,w.s.containers[p.equipment.rod],{...(core?{moduleId:core}:{})});p.heldSlot='rod';p.equipUntil=0;
 accepted(command(w,p,'Cast',{x:0,z:105,power:1}));
 for(let i=0;i<1200&&p.fishing;i++){const f=p.fishing;advance(w,1/30,{reel:f.state==='WAIT'?f.activity>=.9:f.state==='REEL'&&i/30%1.3<.7});}
 const landed=Object.values(w.s.enemies).filter(e=>e.source==='fishing'&&e.ownerId===p.id);assert.equal(landed.length,core==='net_quick'?1:2);assert(landed.every(e=>e.hp>0));assert(w.drainEvents().filter(e=>e.eventType==='FishingChanged'&&e.payload.state==='LANDED').length>=1);w.assertInvariants();
});

test('spotter marking follows actual hits and expires without changing physical line blockers',()=>{
 const {w,p}=fixture();const e=w.spawnEnemy('crab',p.x,p.z-3,false);w.reactToHit(e,{actorId:p.id,weaponId:'rifle',moduleId:'rifle_spotter',damage:5,pelletHits:1}, {x:0,y:0,z:-1});assert.equal(e.markedUntil,w.s.time+6);assert(w.publicState().enemies.find(x=>x.id===e.id).markedRemaining>0);w.s.time+=7;assert.equal(w.publicState().enemies.find(x=>x.id===e.id).markedRemaining,0);
});
