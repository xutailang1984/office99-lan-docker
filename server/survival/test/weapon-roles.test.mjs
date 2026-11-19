// Synthetic worlds only: no account store, HTTP endpoint or live save writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SurvivalWorld} from '../world.mjs';
import {fixture,command,base} from './director-helpers.mjs';
const equip=(w,p,id)=>{const old=w.equipped(p,'weapon');if(old)w.removeItem(old);const item=w.createItem(id,1,w.s.containers[p.equipment.weapon]);item.magazineAmmo=w.defs.weapons[id].magazine;p.heldSlot='weapon';return item;};
const input=(w,p,ads)=>w.input(p,{seq:p.inputAck+1,dx:0,dz:0,yaw:0,pitch:0,ads});
test('six roles retain three ammo types and every legacy full magazine restores',()=>{
 assert.deepEqual(base.items.filter(x=>x.kind==='ammo').map(x=>x.id).sort(),['ammo_heavy','ammo_light','ammo_shell']);
 assert.equal(new Set(base.weapons.map(w=>w.ammo)).size,3);
 for(const [id,capacity] of Object.entries({carbine:20,shotgun:6,rifle:5,pistol:10,smg:30,lmg:60})){
  const {w,p}=fixture();const item=equip(w,p,id);assert.equal(item.magazineAmmo,capacity);
  const saved=new SurvivalWorld(w.c,w.serialize(),{onlineRoster:true});saved.assertInvariants();assert.equal(saved.s.items[item.id].magazineAmmo,capacity);
 }
});
for(const id of ['carbine','shotgun','rifle','pistol','smg','lmg'])test(id+' uses actual equip delay and ADS dwell, including release/repress',()=>{
 const {w,p}=fixture();const item=equip(w,p,id),def=w.defs.weapons[id];
 assert.equal(command(w,p,'SwitchEquip',{slot:'weapon'}).ok,true);
 assert(Math.abs(p.equipUntil-w.s.time-def.equip_seconds)<1e-9);
 assert.equal(command(w,p,'Fire',{yaw:0,pitch:0}).code,'BUSY');
 w.s.time=p.equipUntil+.0001;input(w,p,true);
 w.s.time+=def.ads_seconds-.001;assert.equal(w.publicState().players[0].ads,false);
 w.s.time+=.002;assert.equal(w.publicState().players[0].ads,true);
 assert.equal(command(w,p,'Fire',{yaw:0,pitch:0,ads:true}).ok,true);assert.equal(item.magazineAmmo,def.magazine-1);
 input(w,p,false);assert.equal(w.publicState().players[0].ads,false);input(w,p,true);assert.equal(w.publicState().players[0].ads,false);
 w.s.time+=def.ads_seconds+.001;assert.equal(w.publicState().players[0].ads,true);
});
test('moving LMG actually scatters shots more than stationary ADS; other guns retain their spread',()=>{
 function shoot(id,speed,ads){const {w,p}=fixture();equip(w,p,id);w.s.enemies={};w.rayBlock=()=>null;w.rng=()=>.75;p.moveSpeed=speed;input(w,p,ads);w.s.time+=1;w.fire(p,0,0,ads);return w.drainEvents().find(e=>e.eventType==='Shot').payload.to.x-p.x;}
 const still=shoot('lmg',0,true),moving=shoot('lmg',4,true);assert(Math.abs(moving)>Math.abs(still)*5);
 assert.equal(shoot('carbine',0,true),shoot('carbine',4,true));
 assert(Math.abs(shoot('lmg',0,false))>Math.abs(moving));
});
test('automatic shot cadence distinguishes assault, SMG and LMG under normal 30 Hz stepping',()=>{
 const rates={};
 for(const id of ['carbine','smg','lmg']){const {w,p}=fixture();equip(w,p,id);w.rayBlock=()=>null;const times=[];for(let tick=0;tick<60;tick++){w.s.time=tick/30;try{w.fire(p,0,0);}catch(e){assert.equal(e.code,'BUSY');}for(const e of w.drainEvents())if(e.eventType==='Shot')times.push(w.s.time);}rates[id]=times.length;assert(times.length>1);for(let i=1;i<times.length;i++)assert(times[i]-times[i-1]+1e-9>=60/w.defs.weapons[id].rpm);}
 assert(rates.smg>rates.lmg&&rates.lmg>rates.carbine,JSON.stringify(rates));
});
