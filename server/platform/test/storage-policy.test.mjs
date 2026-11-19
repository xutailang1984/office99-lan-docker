import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {createStoragePolicy,validateStorageLimits,DEFAULT_STORAGE_LIMITS} from '../storage-policy.mjs';

const day=86400000,GiB=1024**3;
const small={maxUsageBytes:1000,saveReserveBytes:100,minFreeCreateBytes:50,minFreeSaveBytes:10,warnFreeBytes:1000};
const code=name=>error=>error?.code===name;
async function fixture(t,{limits={},files={},free=20*GiB,at=100*day,...options}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'office-storage-policy-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  for(const part of ['index','adventures','deleted-adventures'])await fs.mkdir(path.join(directory,part));
  for(const [name,data]of Object.entries(files)){await fs.mkdir(path.dirname(path.join(directory,name)),{recursive:true});await fs.writeFile(path.join(directory,name),data);}
  const clock={at},disk={free};
  const policy=await createStoragePolicy({directory,limits,now:()=>clock.at,
    statfs:async()=>({bsize:1n,bavail:BigInt(disk.free)}),...options});
  return {directory,policy,clock,disk};
}
async function put(f,name,bytes,{kind='save',accountId='owner',getAdventures=()=>[],before,after}={}){
  return f.policy.withWrite({kind,accountId,getAdventures,files:[{path:name,bytes}]},async()=>{
    await before?.();const target=path.join(f.directory,name);await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target+'.tmp',Buffer.alloc(bytes));await fs.rename(target+'.tmp',target);await after?.();return 'saved';
  });
}
async function marker(f,id,deletedAt=f.clock.at-30*day){
  const value={id,deletedAt};
  await fs.writeFile(path.join(f.directory,'deleted-adventures',id+'.json'),JSON.stringify({schema:1,value,
    checksum:createHash('sha256').update(JSON.stringify(value)).digest('hex')}));
}
async function adventure(f,id,names={'snapshot-0.json':'old zero','snapshot-1.json':'old one'}){
  const target=path.join(f.directory,'adventures',id);await fs.mkdir(target);
  for(const [name,value]of Object.entries(names))await fs.writeFile(path.join(target,name),value);
}
const cleanup=f=>f.policy.cleanupDeleted({activeAdventureIds:()=>new Set()});

test('defaults and strict limits preserve five total progresses, save reserve and 30-day retention',()=>{
  assert.equal(DEFAULT_STORAGE_LIMITS.adventuresPerAccount,5);assert.equal(DEFAULT_STORAGE_LIMITS.maxAdventures,500);
  assert.equal(DEFAULT_STORAGE_LIMITS.maxUsageBytes,2*GiB);assert.equal(DEFAULT_STORAGE_LIMITS.saveReserveBytes,64*1024**2);
  assert.equal(DEFAULT_STORAGE_LIMITS.retentionDays,30);assert.equal(DEFAULT_STORAGE_LIMITS.cleanupBatchSize,20);
  assert(Object.isFrozen(validateStorageLimits()));
  for(const limits of [{extra:1},{maxUsageBytes:NaN},{maxAdventures:0},{saveReserveBytes:2*GiB},{retentionDays:29},
    {cleanupBatchSize:21},{adventuresPerAccount:501},{minFreeSaveBytes:6*GiB},{warnUsageRatio:1},{maxAdventures:'500'}])
    assert.throws(()=>validateStorageLimits(limits),code('STORAGE_CONFIG'));
});

test('inventory counts all regular platform files using metadata, and can reconcile out-of-band changes',async t=>{
  const f=await fixture(t,{files:{'index/snapshot-0.json':'not parsed','gm-resources.json':'not parsed either','empty':Buffer.alloc(0)}});
  assert.equal((await f.policy.inventory()).usageBytes,27);assert.equal((await f.policy.status()).fileCount,3);
  await fs.writeFile(path.join(f.directory,'external-backup'),Buffer.alloc(12));
  assert.equal((await f.policy.inventory()).usageBytes,39);
  await fs.unlink(path.join(f.directory,'external-backup'));assert.equal((await f.policy.inventory()).usageBytes,27);
});

test('existing oversized directory is retained, same-size or shrinking save allowed, growth refused',async t=>{
  const f=await fixture(t,{limits:small,files:{'index/snapshot-0.json':Buffer.alloc(1100)}});
  assert.equal((await f.policy.status()).usageBytes,1100);
  assert.equal(await put(f,'index/snapshot-0.json',1100),'saved');await put(f,'index/snapshot-0.json',1080);
  await assert.rejects(put(f,'index/snapshot-0.json',1081),code('STORAGE_LIMIT'));
  assert.equal((await fs.stat(path.join(f.directory,'index/snapshot-0.json'))).size,1080);
});

test('new creation and new participation preserve the save reserve; existing saves may use it',async t=>{
  const f=await fixture(t,{limits:small,files:{'index/snapshot-0.json':Buffer.alloc(850)}});
  await assert.rejects(put(f,'index/snapshot-0.json',901,{kind:'create'}),code('STORAGE_LIMIT'));
  await assert.rejects(put(f,'index/snapshot-0.json',901,{kind:'join'}),code('STORAGE_LIMIT'));
  await put(f,'index/snapshot-0.json',950);assert.equal((await f.policy.status()).usageBytes,950);
});

test('low-disk thresholds account for temporary write peak and fail before mutation',async t=>{
  const f=await fixture(t,{limits:small,free:55});let wrote=false;
  await assert.rejects(put(f,'index/snapshot-0.json',6,{kind:'create',before:()=>{wrote=true;}}),code('DISK_SPACE_LOW'));
  await assert.rejects(put(f,'index/snapshot-0.json',6,{kind:'join'}),code('DISK_SPACE_LOW'));
  assert.equal(wrote,false);await put(f,'index/snapshot-0.json',45);
  f.disk.free=9;await assert.rejects(put(f,'index/snapshot-0.json',1),code('DISK_SPACE_LOW'));
});

test('disk/statfs failure and invalid values refuse writes without exposing paths',async t=>{
  for(const statfs of [async()=>{throw Error('private path');},async()=>({bsize:0,bavail:10}),async()=>({bsize:1,bavail:-1})]){
    const f=await fixture(t,{statfs});let wrote=false;
    await assert.rejects(put(f,'index/snapshot-0.json',1,{before:()=>{wrote=true;}}),e=>e.code==='STORAGE_UNAVAILABLE'&&!e.message.includes('private'));
    assert.equal(wrote,false);
  }
});

test('status reports usage and low-free warnings at the configured thresholds',async t=>{
  const f=await fixture(t,{limits:small,files:{'index/snapshot-0.json':Buffer.alloc(800)},free:1000});
  assert.deepEqual((await f.policy.status()).warnings,[]);
  await put(f,'index/snapshot-0.json',801);f.disk.free=999;
  assert.deepEqual((await f.policy.status()).warnings,['DISK_SPACE_LOW','STORAGE_USAGE_HIGH']);
});

test('creation quota counts ownership or membership once per adventure, without discarding old over-limit records',async t=>{
  const f=await fixture(t);const entries=Array.from({length:5},(_,i)=>({id:String(i),ownerId:i<2?'owner':'other',members:['owner']}));
  await assert.rejects(put(f,'index/snapshot-0.json',2,{kind:'create',getAdventures:()=>entries}),code('ACCOUNT_ADVENTURE_LIMIT'));
  await assert.rejects(put(f,'index/snapshot-0.json',2,{kind:'join',getAdventures:()=>entries}),code('ACCOUNT_ADVENTURE_LIMIT'));
  await put(f,'index/snapshot-0.json',2,{kind:'metadata',getAdventures:()=>entries});
  assert.equal(entries.length,5);
  await put(f,'index/snapshot-0.json',3,{kind:'create',getAdventures:()=>entries.slice(0,4)});
});

test('site quota rejects only new adventures; joining an existing adventure at 500 remains allowed',async t=>{
  const f=await fixture(t);const entries=Array.from({length:500},(_,i)=>({id:String(i),ownerId:'other',members:[]}));
  await assert.rejects(put(f,'index/snapshot-0.json',1,{kind:'create',getAdventures:()=>entries}),code('ADVENTURE_LIMIT'));
  await put(f,'index/snapshot-0.json',1,{kind:'join',getAdventures:()=>entries});assert.equal(entries.length,500);
});

test('concurrent creation observes current count inside the admission lock',async t=>{
  const f=await fixture(t,{limits:{adventuresPerAccount:1}});let entries=[],calls=0;
  const create=()=>put(f,'index/snapshot-0.json',10,{kind:'create',getAdventures:()=>entries,after:()=>{entries=[...entries,{id:randomUUID(),ownerId:'owner'}];calls++;}});
  const results=await Promise.allSettled([create(),create()]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.find(x=>x.status==='rejected').reason.code,'ACCOUNT_ADVENTURE_LIMIT');assert.equal(calls,1);
});

test('concurrent writes cannot both cross the total budget and a rejection does not poison the queue',async t=>{
  const f=await fixture(t,{limits:small});
  const results=await Promise.allSettled([put(f,'index/snapshot-0.json',600),put(f,'index/snapshot-1.json',600)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.find(x=>x.status==='rejected').reason.code,'STORAGE_LIMIT');
  await put(f,'index/snapshot-1.json',300);assert.equal((await f.policy.status()).usageBytes,900);
});

test('successful replacement, multi-file summary and failure remnants maintain incremental accounting',async t=>{
  const f=await fixture(t);await put(f,'index/snapshot-0.json',80);await put(f,'index/snapshot-0.json',50);
  assert.equal((await f.policy.status()).usageBytes,50);
  await f.policy.withWrite({kind:'save',files:[{path:'index/snapshot-0.json',bytes:25},{path:'index/summary.json',bytes:10}]},async()=>{
    await fs.writeFile(path.join(f.directory,'index/snapshot-0.json'),Buffer.alloc(25));
    await fs.writeFile(path.join(f.directory,'index/summary.json'),Buffer.alloc(10));
  });
  await assert.rejects(f.policy.withWrite({kind:'save',files:[{path:'index/snapshot-1.json',bytes:40}]},async()=>{
    await fs.writeFile(path.join(f.directory,'index/snapshot-1.json.tmp'),Buffer.alloc(40));throw Error('synthetic write failure');
  }),/synthetic write failure/);
  assert.equal((await f.policy.status()).usageBytes,75);assert.equal((await f.policy.inventory()).usageBytes,75);
});

test('a durable write followed by an error is counted, and incorrect declared byte sizes are detected',async t=>{
  const f=await fixture(t);
  await assert.rejects(put(f,'index/snapshot-0.json',80,{after:()=>{throw Error('synthetic failure after rename');}}),/synthetic failure/);
  assert.equal((await f.policy.status()).usageBytes,80);
  await assert.rejects(f.policy.withWrite({kind:'save',files:[{path:'index/snapshot-0.json',bytes:20}]},
    ()=>fs.writeFile(path.join(f.directory,'index/snapshot-0.json'),Buffer.alloc(21))),code('STORAGE_WRITE_MISMATCH'));
  assert.equal((await f.policy.status()).usageBytes,21);
});

test('retry replaces an already-budgeted temporary file instead of charging its bytes twice',async t=>{
  const f=await fixture(t,{limits:small,files:{'index/snapshot-0.json.tmp':Buffer.alloc(700)}});
  await put(f,'index/snapshot-0.json',700);assert.equal((await f.policy.status()).usageBytes,700);
  assert.deepEqual(await fs.readdir(path.join(f.directory,'index')),['snapshot-0.json']);
});

test('declared zero-byte files still must exist and a reported success cannot retain a .tmp file',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.policy.withWrite({kind:'metadata',files:[{path:'index/empty',bytes:0}]},async()=>{}),code('STORAGE_WRITE_MISMATCH'));
  await assert.rejects(f.policy.withWrite({kind:'metadata',files:[{path:'index/empty',bytes:0}]},async()=>{
    await fs.writeFile(path.join(f.directory,'index/empty'),'');await fs.writeFile(path.join(f.directory,'index/empty.tmp'),'a');
  }),code('STORAGE_WRITE_MISMATCH'));
  assert.equal((await f.policy.status()).usageBytes,1);
});

test('small deletion and member-reset records can use the reserved control budget when ordinary quota is full',async t=>{
  const f=await fixture(t,{limits:small,files:{'index/snapshot-0.json':Buffer.alloc(1000)}}),id=randomUUID();
  await assert.rejects(put(f,'index/summary.json',10,{kind:'metadata'}),code('STORAGE_LIMIT'));
  await put(f,'deleted-adventures/'+id+'.json',128,{kind:'control'});
  await put(f,'member-resets/'+id+'/snapshot-0.json',256,{kind:'control'});
  assert.equal((await f.policy.status()).usageBytes,1384);
  // Replacing metadata must not turn an over-quota state into permission to grow.
  await assert.rejects(put(f,'index/snapshot-0.json',1001,{kind:'metadata'}),code('STORAGE_LIMIT'));
});

test('control cannot write arbitrary files, wrong directory depth, invalid IDs or more than 256 KiB',async t=>{
  const f=await fixture(t),id=randomUUID();let writes=0;
  for(const name of ['index/snapshot-0.json','adventures/'+id+'/snapshot-0.json','deleted-adventures/arbitrary.json',
    'member-resets/'+id+'/summary.json','member-resets/'+id+'/nested/snapshot-0.json'])
    await assert.rejects(put(f,name,20,{kind:'control',before:()=>{writes++;}}),code('STORAGE_REQUEST'));
  await assert.rejects(put(f,'deleted-adventures/'+id+'.json',256*1024+1,{kind:'control'}),code('STORAGE_REQUEST'));
  await assert.rejects(f.policy.withWrite({kind:'control',files:[{path:'member-resets/'+id+'/snapshot-0.json',bytes:140*1024},
    {path:'member-resets/'+id+'/snapshot-1.json',bytes:140*1024}]},()=>{writes++;}),code('STORAGE_REQUEST'));
  assert.equal(writes,0);
});

test('control has a finite extra 8 MiB ceiling and still respects low free-disk protection',async t=>{
  const f=await fixture(t,{limits:small,files:{'index/snapshot-0.json':Buffer.alloc(1000+8*1024**2)}}),id=randomUUID();
  await assert.rejects(put(f,'deleted-adventures/'+id+'.json',1,{kind:'control'}),code('STORAGE_LIMIT'));
  const g=await fixture(t,{free:512*1024**2-1});
  await assert.rejects(put(g,'deleted-adventures/'+id+'.json',1,{kind:'control'}),code('DISK_SPACE_LOW'));
});

test('absolute paths, traversal, Windows aliases, duplicate targets and invalid byte values are refused',async t=>{
  const f=await fixture(t);let calls=0;
  for(const name of ['../outside','/outside','C:/outside','index\\file','index//file','index/./file','index/../file','index/file.','index/file ','index/a:stream'])
    await assert.rejects(put(f,name,1,{before:()=>{calls++;}}),code('STORAGE_PATH'));
  for(const bytes of [-1,NaN,Infinity,1.5,'1'])await assert.rejects(put(f,'index/a',bytes),code('STORAGE_REQUEST'));
  await assert.rejects(f.policy.withWrite({kind:'save',files:[{path:'index/a',bytes:1},{path:'index/a',bytes:1}]},()=>{calls++;}),code('STORAGE_REQUEST'));
  assert.equal(calls,0);
});

test('symbolic directory paths cannot escape admission or inventory scope',async t=>{
  const f=await fixture(t),outside=await fs.mkdtemp(path.join(os.tmpdir(),'office-storage-outside-'));
  t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.symlink(outside,path.join(f.directory,'linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(put(f,'linked/would-write',10),code('STORAGE_PATH'));
  await assert.rejects(f.policy.inventory(),code('STORAGE_PATH'));
  assert.deepEqual(await fs.readdir(outside),[]);
});

test('only validated deletion markers at the exact 30-day boundary authorize cleanup',async t=>{
  const f=await fixture(t),expired=randomUUID(),young=randomUUID(),live=randomUUID();
  for(const id of [expired,young,live])await adventure(f,id);
  await marker(f,expired);await marker(f,young,f.clock.at-30*day+1);await f.policy.inventory();
  const before=(await f.policy.status()).usageBytes,done=await cleanup(f);
  assert.equal(done.deletedCount,1);assert.equal(done.bytesFreed,15);assert.equal((await f.policy.status()).usageBytes,before-15);
  await assert.rejects(fs.stat(path.join(f.directory,'adventures',expired)),{code:'ENOENT'});
  assert((await fs.stat(path.join(f.directory,'adventures',young))).isDirectory());assert((await fs.stat(path.join(f.directory,'adventures',live))).isDirectory());
  assert((await fs.stat(path.join(f.directory,'deleted-adventures',expired+'.json'))).isFile());
  assert.equal((await cleanup(f)).deletedCount,0);f.clock.at++;assert.equal((await cleanup(f)).deletedCount,1);
});

test('corrupt, forged or future deletion records never remove adventure files',async t=>{
  const f=await fixture(t),ids=Array.from({length:3},()=>randomUUID());
  for(const id of ids)await adventure(f,id);
  await fs.writeFile(path.join(f.directory,'deleted-adventures',ids[0]+'.json'),'broken');
  await marker(f,ids[1]);const file=path.join(f.directory,'deleted-adventures',ids[1]+'.json');const entry=JSON.parse(await fs.readFile(file));entry.value.deletedAt=0;await fs.writeFile(file,JSON.stringify(entry));
  await marker(f,ids[2],f.clock.at+day);const result=await cleanup(f);
  assert.equal(result.deletedCount,0);assert.equal(result.blockedCount,2);
  for(const id of ids)assert.equal((await fs.readdir(path.join(f.directory,'adventures',id))).length,2);
});

test('unknown file blocks the whole deleted directory before any authorized file is removed',async t=>{
  const f=await fixture(t),id=randomUUID();await adventure(f,id,{'snapshot-0.json':'keep','unknown.txt':'keep too'});await marker(f,id);
  const result=await cleanup(f);assert.equal(result.deletedCount,0);assert.deepEqual(result.issues,['CLEANUP_UNKNOWN_FILE']);
  assert.equal((await fs.readdir(path.join(f.directory,'adventures',id))).length,2);
});

test('summary, temporary files and exact legacy corrupt copies may be cleaned, deletion markers persist',async t=>{
  const f=await fixture(t),id=randomUUID();
  await adventure(f,id,{'snapshot-0.json':'a','snapshot-1.json':'b','snapshot-0.json.tmp':'c','summary.json':'d','summary.json.tmp':'e',
    ['snapshot-0.json.corrupt-'+randomUUID()]:'f'});await marker(f,id);await f.policy.inventory();
  const result=await cleanup(f);assert.equal(result.deletedCount,1);assert.equal(result.bytesFreed,6);
  const again=await createStoragePolicy({directory:f.directory,now:()=>f.clock.at,statfs:async()=>({bsize:1,bavail:20*GiB})});
  assert.equal((await again.cleanupDeleted({activeAdventureIds:()=>new Set()})).deletedCount,0);
  assert((await fs.stat(path.join(f.directory,'deleted-adventures',id+'.json'))).isFile());
});

test('an active deleted-marked adventure is refused and the activity accessor is checked again before unlink',async t=>{
  const f=await fixture(t),id=randomUUID();await adventure(f,id);await marker(f,id);
  const first=await f.policy.cleanupDeleted({activeAdventureIds:()=>new Set([id])});assert.deepEqual(first.issues,['CLEANUP_ACTIVE']);
  let calls=0;const second=await f.policy.cleanupDeleted({activeAdventureIds:()=>new Set(++calls===2?[id]:[])});
  assert.equal(second.deletedCount,0);assert.deepEqual(second.issues,['CLEANUP_ACTIVE']);
  assert.equal((await fs.readdir(path.join(f.directory,'adventures',id))).length,2);
});

test('linked adventure or nested directory is retained without touching outside files',async t=>{
  const f=await fixture(t),id=randomUUID(),outside=await fs.mkdtemp(path.join(os.tmpdir(),'office-cleanup-outside-'));
  t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.writeFile(path.join(outside,'snapshot-0.json'),'keep');
  await fs.symlink(outside,path.join(f.directory,'adventures',id),process.platform==='win32'?'junction':'dir');await marker(f,id);
  const result=await cleanup(f);assert.equal(result.deletedCount,0);assert(result.issues.includes('STORAGE_PATH'));
  assert.equal(await fs.readFile(path.join(outside,'snapshot-0.json'),'utf8'),'keep');
  const nested=randomUUID();await adventure(f,nested);await marker(f,nested);await fs.mkdir(path.join(f.directory,'adventures',nested,'summary.json'));
  assert.equal((await cleanup(f)).deletedCount,0);
});

test('cleanup is bounded to 20 and rotates so a blocked prefix cannot starve later expired records',async t=>{
  const f=await fixture(t);const ids=Array.from({length:22},()=>randomUUID()).sort();
  for(let i=0;i<ids.length;i++){await adventure(f,ids[i],i===0?{'unknown.txt':'keep'}:undefined);await marker(f,ids[i]);}
  await f.policy.inventory();const first=await cleanup(f);assert.equal(first.examinedCount,20);assert.equal(first.deletedCount,19);assert.equal(first.hasMore,true);
  const second=await cleanup(f);assert.equal(second.deletedCount,2);assert(second.examinedCount<=20);
  assert.equal((await fs.readdir(path.join(f.directory,'deleted-adventures'))).length,22);
  assert.deepEqual(await fs.readdir(path.join(f.directory,'adventures')),[ids[0]]);
});

test('cleanup waits for an admitted save and retains a current active world',async t=>{
  const f=await fixture(t),id=randomUUID();await adventure(f,id);await marker(f,id);await f.policy.inventory();
  let open=false,release;const wait=new Promise(r=>{release=r;});
  const saving=put(f,'adventures/'+id+'/snapshot-0.json',10,{before:async()=>{open=true;await wait;}});
  // Yield to the admitted callback without consuming wall-clock test sleeps.
  while(!open)await new Promise(r=>setImmediate(r));
  const cleaning=f.policy.cleanupDeleted({activeAdventureIds:()=>new Set([id])});release();await saving;
  assert.deepEqual((await cleaning).issues,['CLEANUP_ACTIVE']);assert.equal((await fs.stat(path.join(f.directory,'adventures',id,'snapshot-0.json'))).size,10);
});
