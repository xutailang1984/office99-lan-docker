import path from 'node:path';
import {mergeCollection} from '../survival/social-config.mjs';
import {CheckedStore} from './checked-store.mjs';
import {createCareerCapsule,validateCareerCapsule} from '../survival/career-state.mjs';

const copy=value=>structuredClone(value);
export class CareerError extends Error {
 constructor(code,message,status=409){super(message);this.code=code;this.status=status;}
}
const need=(condition,code,message)=>{if(!condition)throw new CareerError(code,message);};

// An account has one durable character and at most one world holding it. A
// checked intent commits a complete world plus the affected character rows;
// recovery finishes the same intent before admitting another mutation. This
// is a room-bound transfer log, not a ledger for shots or individual pickups.
export class Careers {
 constructor({directory,storeOptions,config,getWorldStore,now=Date.now}) {
  this.store=new CheckedStore(path.join(directory,'careers-v1'),storeOptions);
  this.config=config;this.getWorldStore=getWorldStore;this.now=now;this.data=null;
 }
 async load(){
  this.data=await this.store.load();
  need(!this.store.fallback,'CAREER_INVALID','个人资产存档需要检查，已暂停交接');
  if(!this.data){this.data={schema:1,profiles:{},epochs:{},receipts:{},pending:null};await this.store.save(this.data);}
  need(this.data.schema===1&&this.data.profiles&&this.data.epochs&&this.data.receipts,'CAREER_INVALID','个人存档无法读取');
  await this.recover();return this;
 }
 async write(next){await this.store.save(next,{kind:'save'});this.data=next;}
 async recover(){
  const pending=this.data?.pending;if(!pending)return;
  if(pending.snapshot){
   const store=this.getWorldStore(pending.adventureId);need(store,'CAREER_PENDING','个人进度交接尚未完成');
   const current=await store.load();
   need(!current||current.revision<=pending.snapshot.revision,'CAREER_PENDING','个人进度交接版本不一致');
   if(current?.revision===pending.snapshot.revision)need(current.checksum===pending.snapshot.checksum,'CAREER_PENDING','个人进度交接版本不一致');
   else await store.save(pending.snapshot,{kind:'save'});
  }
  const next=copy(this.data);
  for(const row of pending.profiles)next.profiles[row.accountId]=row;
  next.epochs[pending.adventureId]=pending.economyEpoch;
  if(pending.receipt){const list=next.receipts[pending.adventureId]??[];next.receipts[pending.adventureId]=[...list.filter(r=>r.id!==pending.receipt.id),pending.receipt].slice(-8);}
  next.pending=null;await this.write(next);
 }
 epoch(adventureId){return this.data.epochs[adventureId]??0;}
 row(accountId){return this.data.profiles[accountId]??null;}
 publicRow(accountId){const row=this.row(accountId);return row?copy({accountId:row.accountId,revision:row.revision,capsule:row.capsule,holding:row.holding}):null;}
 async ensure(accountId){
  if(this.row(accountId))return this.publicRow(accountId);
  const capsule=createCareerCapsule(this.config);validateCareerCapsule(capsule,this.config);
  const next=copy(this.data);next.profiles[accountId]={accountId,revision:1,capsule,holding:null,updatedAt:this.now()};await this.write(next);return this.publicRow(accountId);
 }
 async claim(accountId,adventureId){
  await this.ensure(accountId);const row=this.row(accountId);
  need(!row.holding||row.holding.adventureId===adventureId,'CAREER_HELD','装备还在另一份冒险里，请先回去归存或放弃携带物');
  if(!row.holding){const next=copy(this.data),target=next.profiles[accountId];target.revision++;target.holding={adventureId,since:this.now()};target.updatedAt=this.now();await this.write(next);}
  return this.publicRow(accountId);
 }
 binding(accountId,adventureId){const row=this.row(accountId);return row?.holding?.adventureId===adventureId?this.publicRow(accountId):null;}
 checkBinding(accountId,adventureId,revision){const row=this.row(accountId);need(row?.holding?.adventureId===adventureId&&row.revision===revision,'CAREER_CHANGED','个人装备已更新，请重新进入房间');return row;}
 checkpoint(accountId,adventureId,revision,capsule){
  validateCareerCapsule(capsule,this.config);const row=copy(this.checkBinding(accountId,adventureId,revision));
  // Carried gear remains held by the world. Abandon can only recover these
  // last confirmed protected fields, never the original departure backpack.
  row.capsule=copy(capsule);row.capsule.collection=mergeCollection(this.row(accountId).capsule.collection,capsule.collection);row.holding.materialized=true;row.updatedAt=this.now();return row;
 }
 settled(accountId,adventureId,revision,capsule){validateCareerCapsule(capsule,this.config);const row=copy(this.checkBinding(accountId,adventureId,revision));row.capsule=copy(capsule);row.capsule.collection=mergeCollection(this.row(accountId).capsule.collection,capsule.collection);row.revision++;row.holding=null;row.updatedAt=this.now();return row;}
 abandoned(accountId){const source=this.row(accountId);need(source?.holding,'CAREER_NOT_HELD','没有需要取回的个人进度');const row=copy(source);row.capsule.backpack=[];row.capsule.equipment={weapon:[],rod:[],melee:[]};row.capsule.quickItemDefinitionId=null;row.revision++;row.holding=null;row.updatedAt=this.now();return row;}
 receipt(adventureId,id){return this.data.receipts[adventureId]?.find(r=>r.id===id)??null;}
 async commit({adventureId,snapshot=null,profiles=[],economyEpoch=this.epoch(adventureId),receipt=null}){
  await this.recover();const next=copy(this.data);next.pending={adventureId,snapshot:copy(snapshot),profiles:copy(profiles),economyEpoch,receipt:copy(receipt)};
  await this.write(next);await this.recover();
 }
}
