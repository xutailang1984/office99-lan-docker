import {promises as fs} from 'node:fs';
import path from 'node:path';
import {CheckedStore} from './checked-store.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const valid=value=>value?.schema===1&&value.records&&typeof value.records==='object'&&!Array.isArray(value.records)
 &&Object.entries(value.records).every(([id,r])=>uuid.test(id)&&Number.isSafeInteger(r?.generation)&&r.generation>0&&Number.isFinite(r.at)&&r.at>=0);

// A small durable tombstone fences both index rollback and old host snapshots.
export class MemberRecords {
 constructor(directory,options){this.directory=directory;this.options=options;this.stores=new Map();}
 async load(){
  await fs.mkdir(this.directory,{recursive:true});
  for(const entry of await fs.readdir(this.directory,{withFileTypes:true})){
   if(!entry.isDirectory()||!uuid.test(entry.name))throw Error('Invalid member record directory');
   const store=new CheckedStore(path.join(this.directory,entry.name),this.options),value=await store.load();
   // Both copies must contain the committed deletion generation. A missing
   // latest slot must never silently lower it like an ordinary world rollback.
   if(value){
    const signatures=await store.signatures();
    if(store.fallback||!valid(value)||signatures.some(slot=>!slot))throw Error('Invalid member deletion record; originals retained');
    const copies=await Promise.all([0,1].map(slot=>fs.readFile(path.join(store.directory,`snapshot-${slot}.json`),'utf8').then(JSON.parse)));
    if(copies.some(envelope=>JSON.stringify(envelope.value)!==JSON.stringify(value)))throw Error('Incomplete member deletion record; originals retained');
   }
   this.stores.set(entry.name,store);
  }return this;
 }
 generation(adventureId,accountId){return this.stores.get(adventureId)?.current?.records?.[accountId]?.generation??0;}
 entries(a){return Object.entries(this.stores.get(a.id)?.current?.records??{}).map(([accountId,r])=>({accountId,generation:r.generation,active:a.members.includes(accountId)&&(a.memberGenerations?.[accountId]??0)>=r.generation}));}
 project(a){return {...a,members:a.members.filter(id=>id===a.ownerId||(a.memberGenerations?.[id]??0)>=this.generation(a.id,id))};}
 async mark(adventureId,accountId,at){
  if(!uuid.test(adventureId)||!uuid.test(accountId)||!Number.isFinite(at)||at<0)throw Error('Invalid member deletion request');
  let store=this.stores.get(adventureId);if(!store){store=new CheckedStore(path.join(this.directory,adventureId),this.options);await store.load();this.stores.set(adventureId,store);}
  const next=structuredClone(store.current??{schema:1,records:{}}),generation=(next.records[accountId]?.generation??0)+1;
  if(!Number.isSafeInteger(generation))throw Error('Member generation exhausted');
  next.records[accountId]={generation,at};
  // Acknowledgment follows both durable copies; either earlier generation
  // left by a partial write is detected when loading this authority again.
  await store.save(next,{kind:'control'});await store.save(next,{kind:'control'});return generation;
 }
}
