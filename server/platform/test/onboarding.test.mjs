import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request as httpRequest} from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {createPlatformService} from '../service.mjs';
import {CheckedStore} from '../checked-store.mjs';
import {ONBOARDING_STEPS,ONBOARDING_CHECKS,onboardingOf,newOnboarding,changeOnboarding} from '../onboarding.mjs';

// Real HTTP and checked account storage, exclusively in this fixture's directory.
// Disk-space injection is a storage-admission fixture, not a production override.
const initial=()=>({version:2,status:'pending',step:0,revision:0,checks:[]});
const legacy=initial;
const expectedChecks=[['move','look'],['rod','melee','quick'],['inventory'],['landed'],['hit','pickup'],['store','storage','upgrade','recycle'],['rewards'],['building']];

async function fixture(t) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'office-onboarding-test-'));
  const disk={free:20*1024**3};let clock=1000000,service,server;
  t.after(async()=>{
    try {
      if(service){await service.stop();assert.equal(service.status().ready,false);assert.equal(service.status().rooms,0);assert.equal(service.status().online,0);}
    } finally {
      if(server?.listening)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
      assert(!server?.listening,'owned HTTP listener closed');
      const target=path.resolve(directory),parent=path.resolve(os.tmpdir());
      assert.equal(path.dirname(target),parent);assert(path.basename(target).startsWith('office-onboarding-test-'));
      assert.equal(await fs.realpath(target),target,'cleanup cannot follow a replaced directory');
      await fs.rm(target,{recursive:true,force:true});
      await assert.rejects(fs.stat(target),{code:'ENOENT'});
    }
  });
  const start=()=>createPlatformService({dataDir:directory,manualClock:true,now:()=>clock,
    statfs:async()=>({bsize:1n,bavail:BigInt(disk.free)})});
  service=await start();
  server=createServer((req,res)=>void service.handleRequest(req,res).then(handled=>{
    if(!handled){res.statusCode=404;res.end('{}');}
  }).catch(()=>{res.statusCode=500;res.end('{"error":{"code":"TEST_HANDLER_ERROR"}}');}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port;
  async function api(method,route,body,account,{requestOrigin=origin}={}) {
    const encoded=body===undefined?'':JSON.stringify(body);
    return new Promise((resolve,reject)=>{
      const req=httpRequest(origin+'/api/platform'+route,{method,agent:false,headers:{
        ...(requestOrigin===null?{}:{Origin:requestOrigin}),...(account?.cookie?{Cookie:account.cookie}:{}),
        ...(encoded?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(encoded)}:{})
      }},res=>{
        let raw='';res.setEncoding('utf8');res.on('data',part=>raw+=part);
        res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(raw),cookie:res.headers['set-cookie']?.[0]?.split(';')[0]});}
          catch{reject(Error('Non-JSON synthetic platform response'));}});
      });
      req.setTimeout(5000,()=>req.destroy(Error('Synthetic HTTP request timeout')));
      req.on('error',reject);req.end(encoded);
    });
  }
  async function account() {
    const username='guide_'+randomBytes(5).toString('hex'),password=randomBytes(20).toString('base64url');
    const response=await api('POST','/register',{username,password,name:'引导测试员'});
    assert.equal(response.status,201);
    return {id:response.body.account.id,username,password,cookie:response.cookie,onboarding:response.body.account.onboarding};
  }
  async function login(account) {
    const response=await api('POST','/login',{username:account.username,password:account.password});
    assert.equal(response.status,200);account.cookie=response.cookie;return response.body.account.onboarding;
  }
  async function read(account) {
    const response=await api('GET','/onboarding',undefined,account);assert.equal(response.status,200);return response.body.onboarding;
  }
  async function change(account,input) {
    const response=await api('POST','/onboarding',input,account);assert.equal(response.status,200);return response.body.onboarding;
  }
  async function hashes() {
    const result={};
    for(const name of (await fs.readdir(path.join(directory,'index'))).filter(name=>/^snapshot-[01]\.json$/.test(name)).sort())
      result[name]=createHash('sha256').update(await fs.readFile(path.join(directory,'index',name))).digest('hex');
    return result;
  }
  async function diskGuide(account) {
    const value=await new CheckedStore(path.join(directory,'index')).load();
    return onboardingOf(value.accounts.find(row=>row.id===account.id));
  }
  return {directory,disk,api,account,login,read,change,hashes,diskGuide,
    async restart(editSyntheticIndex) {
      await service.stop();assert.equal(service.status().ready,false);
      if(editSyntheticIndex){const store=new CheckedStore(path.join(directory,'index')),value=await store.load();editSyntheticIndex(value);await store.save(value);}
      service=await start();
    },advanceClock(ms){clock+=ms;}};
}

test('onboarding declares eight bounded checkpoints and defensively copies account progress',()=>{
  assert.equal(ONBOARDING_STEPS,8);assert.deepEqual(ONBOARDING_CHECKS,expectedChecks);
  assert.deepEqual(newOnboarding(),initial());assert.deepEqual(onboardingOf({}),legacy());
  const account={onboarding:{version:2,status:'active',step:5,revision:7,checks:['store']}};
  const publicValue=onboardingOf(account);publicValue.checks.push('storage');assert.deepEqual(account.onboarding.checks,['store']);
  const before=structuredClone(account),next=changeOnboarding(account,{version:2,action:'check',revision:7,checks:['storage']});
  assert.deepEqual(account,before);assert.deepEqual(next.checks,['store','storage']);assert.equal(next.revision,8);
});

test('invalid persisted records fail closed rather than restarting or completing the guide',()=>{
  assert.deepEqual(onboardingOf({onboarding:null}),legacy());
  for(const value of [[],{},true,false,0,'','active'])assert.throws(()=>onboardingOf({onboarding:value}),/Invalid onboarding record/);
  const invalid=[{version:3},{status:'unknown'},{revision:-1},{revision:1.5},{step:-1},{step:9},
    {status:'done',step:7},{status:'active',step:8},{checks:['move','move']},{checks:['store']},{checks:['move','look','a','b','c']}];
  for(const patch of invalid) {
    assert.throws(()=>onboardingOf({onboarding:{...initial(),...patch}}),/Invalid onboarding record/);
  }
});

test('guide HTTP requires authentication and same-origin writes; foreign account parameters are rejected',async t=>{
  const f=await fixture(t),a=await f.account(),b=await f.account();
  assert.equal((await f.api('GET','/onboarding')).status,401);
  assert.equal((await f.api('POST','/onboarding',{version:2,action:'begin',revision:0})).status,401);
  for(const requestOrigin of [null,'http://example.invalid']) {
    const r=await f.api('POST','/onboarding',{version:2,action:'begin',revision:0},a,{requestOrigin});
    assert.equal(r.status,403);assert.equal(r.body.error.code,'ORIGIN_REJECTED');
  }
  for(const extra of [{accountId:b.id},{username:b.username},{status:'done'},{resources:{credits:100}},{onboarding:{step:8}}]) {
    const r=await f.api('POST','/onboarding',{version:2,action:'begin',revision:0,...extra},a);
    assert.equal(r.status,400);assert.equal(r.body.error.code,'INVALID_GUIDE');
  }
  assert.deepEqual(await f.read(a),initial());assert.deepEqual(await f.read(b),initial());
  const active=await f.change(a,{version:2,action:'begin',revision:0});assert.equal(active.status,'active');
  const own=await f.api('GET','/onboarding?accountId='+b.id,undefined,a);assert.deepEqual(own.body.onboarding,active);
  assert.deepEqual(await f.read(b),initial());
  assert.equal((await f.api('POST','/logout',{},a)).status,200);
  assert.equal((await f.api('POST','/onboarding',{version:2,action:'pause',revision:1},a)).status,401);
});

test('new registration remains pending through login and reads; account progress survives a service restart',async t=>{
  const f=await fixture(t),a=await f.account();assert.deepEqual(a.onboarding,initial());
  const before=await f.hashes();assert.deepEqual(await f.read(a),initial());
  assert.deepEqual((await f.api('GET','/me',undefined,a)).body.account.onboarding,initial());
  assert.deepEqual(await f.login(a),initial());assert.deepEqual(await f.hashes(),before,'reads/login do not activate or save the guide');
  let value=await f.change(a,{version:2,action:'begin',revision:0});
  value=await f.change(a,{version:2,action:'check',revision:value.revision,checks:['move']});
  await f.restart();assert.equal((await f.api('GET','/onboarding',undefined,a)).status,401);
  assert.deepEqual(await f.login(a),value);assert.deepEqual(await f.read(a),value);assert.deepEqual(await f.diskGuide(a),value);
});

test('legacy accounts are projected as newcomers without rewriting storage until they actually begin',async t=>{
  const f=await fixture(t),a=await f.account();
  // Deliberately model a pre-guide account only in the stopped synthetic store.
  await f.restart(index=>{delete index.accounts.find(row=>row.id===a.id).onboarding;});
  const before=await f.hashes();assert.deepEqual(await f.login(a),legacy());assert.deepEqual(await f.read(a),legacy());
  assert.deepEqual(await f.hashes(),before);
  const automatic=await f.api('POST','/onboarding',{version:2,action:'begin',revision:0},a);
  assert.equal(automatic.status,200);
  const active=automatic.body.onboarding;assert.equal(active.status,'active');assert.equal(active.step,0);
  await f.restart();assert.deepEqual(await f.login(a),active);
});

test('eight steps accept only their own checks and advance one step at a time; completion and restart are durable',async t=>{
  const f=await fixture(t),a=await f.account();let value=await f.change(a,{version:2,action:'begin',revision:0});
  for(let step=0;step<8;step++) {
    assert.equal(value.step,step);
    const denied=await f.api('POST','/onboarding',{version:2,action:'advance',revision:value.revision,step:step+2},a);
    assert.equal(denied.status,400);assert.equal(denied.body.error.code,'INVALID_GUIDE');
    const wrong=await f.api('POST','/onboarding',{version:2,action:'check',revision:value.revision,checks:['not_a_checkpoint']},a);
    assert.equal(wrong.status,400);
    value=await f.change(a,{version:2,action:'check',revision:value.revision,checks:expectedChecks[step]});
    assert.deepEqual(value.checks,expectedChecks[step]);
    value=await f.change(a,{version:2,action:'advance',revision:value.revision,step:step+1});assert.deepEqual(value.checks,[]);
  }
  assert.equal(value.status,'done');assert.equal(value.step,8);
  await f.restart();assert.deepEqual(await f.login(a),value);
  const tooFar=await f.api('POST','/onboarding',{version:2,action:'advance',revision:value.revision,step:9},a);assert.equal(tooFar.status,400);
  const replay=await f.change(a,{version:2,action:'restart',revision:value.revision});
  assert.deepEqual(replay,{version:2,status:'active',step:0,revision:value.revision+1,checks:[]});
});

test('station subchecks survive restart and a duplicate check changes neither revision nor disk bytes',async t=>{
  const f=await fixture(t),a=await f.account();let value=await f.change(a,{version:2,action:'begin',revision:0});
  // Complete prerequisite checkpoints through the authenticated learning API.
  for(let step=1;step<=5;step++){value=await f.change(a,{version:2,action:'check',revision:value.revision,checks:expectedChecks[step-1]});value=await f.change(a,{version:2,action:'advance',revision:value.revision,step});}
  value=await f.change(a,{version:2,action:'check',revision:value.revision,checks:['store','storage']});
  await f.restart();assert.deepEqual(await f.login(a),value);
  const before=await f.hashes(),duplicate=await f.change(a,{version:2,action:'check',revision:value.revision,checks:['storage','store','storage']});
  assert.deepEqual(duplicate,value);assert.deepEqual(await f.hashes(),before);
  const foreign=await f.api('POST','/onboarding',{version:2,action:'check',revision:value.revision,checks:['building']},a);assert.equal(foreign.status,400);
  value=await f.change(a,{version:2,action:'check',revision:value.revision,checks:['upgrade','recycle']});
  assert.deepEqual(value.checks,['store','storage','upgrade','recycle']);assert.deepEqual(await f.diskGuide(a),value);
});

test('serialized concurrent requests use CAS and a stale retry cannot replace saved checks',async t=>{
  const f=await fixture(t),a=await f.account();
  const begin=await Promise.all([f.api('POST','/onboarding',{version:2,action:'begin',revision:0},a),f.api('POST','/onboarding',{version:2,action:'begin',revision:0},a)]);
  assert.deepEqual(begin.map(r=>r.status).sort(),[200,409]);assert.equal(begin.find(r=>r.status===409).body.error.code,'GUIDE_CHANGED');
  const checks=await Promise.all(['move','look'].map(check=>f.api('POST','/onboarding',{version:2,action:'check',revision:1,checks:[check]},a)));
  assert.deepEqual(checks.map(r=>r.status).sort(),[200,409]);
  let value=await f.read(a);assert.equal(value.revision,2);assert.equal(value.checks.length,1);
  const stale=await f.api('POST','/onboarding',{version:2,action:'pause',revision:1},a);assert.equal(stale.status,409);
  value=await f.change(a,{version:2,action:'check',revision:value.revision,checks:['move','look']});
  assert.deepEqual([...value.checks].sort(),['look','move']);assert.equal(value.revision,3);
  assert.deepEqual(await f.diskGuide(a),value);
});

test('onboarding does not consume, release or bypass the five-adventure quota',async t=>{
  const f=await fixture(t),a=await f.account();
  for(let i=0;i<5;i++)assert.equal((await f.api('POST','/adventures',{title:'引导隔离进度'},a)).status,201);
  const before=(await f.api('GET','/adventures',undefined,a)).body;
  assert.equal(before.capacity.progressUsed,5);assert.equal(before.capacity.progressLimit,5);
  let value=await f.change(a,{version:2,action:'begin',revision:0});
  value=await f.change(a,{version:2,action:'check',revision:value.revision,checks:['move']});
  value=await f.change(a,{version:2,action:'pause',revision:value.revision});assert.equal(value.status,'paused');
  value=await f.change(a,{version:2,action:'restart',revision:value.revision});assert.equal(value.status,'active');
  const after=(await f.api('GET','/adventures',undefined,a)).body;
  assert.deepEqual(after.adventures,before.adventures);assert.equal(after.capacity.progressUsed,5);
  const sixth=await f.api('POST','/adventures',{title:'超额引导测试'},a);
  assert.equal(sixth.status,409);assert.equal(sixth.body.error.code,'ACCOUNT_ADVENTURE_LIMIT');
  const fresh=await f.account();assert.equal((await f.api('GET','/adventures',undefined,fresh)).body.capacity.progressUsed,0);
  await f.change(fresh,{version:2,action:'pause',revision:0});assert.equal((await f.api('GET','/adventures',undefined,fresh)).body.capacity.progressUsed,0);
});

test('low disk cannot acknowledge unsaved progress; memory, disk and restart retain the last confirmation',async t=>{
  const f=await fixture(t),a=await f.account();let value=await f.change(a,{version:2,action:'begin',revision:0});
  value=await f.change(a,{version:2,action:'check',revision:value.revision,checks:['move']});
  const before=await f.hashes();f.disk.free=511*1024**2;
  const failed=await f.api('POST','/onboarding',{version:2,action:'check',revision:value.revision,checks:['look']},a);
  assert.equal(failed.status,507);assert.equal(failed.body.error.code,'DISK_SPACE_LOW');
  assert.deepEqual(await f.read(a),value);assert.deepEqual(await f.diskGuide(a),value);assert.deepEqual(await f.hashes(),before);
  const duplicate=await f.change(a,{version:2,action:'check',revision:value.revision,checks:['move']});
  assert.deepEqual(duplicate,value);assert.deepEqual(await f.hashes(),before,'idempotent check does not attempt a disk write');
  f.disk.free=20*1024**3;await f.restart();assert.deepEqual(await f.login(a),value);
  const retry=await f.change(a,{version:2,action:'check',revision:value.revision,checks:['look']});
  assert.equal(retry.revision,value.revision+1);assert.deepEqual(retry.checks,['move','look']);assert.deepEqual(await f.diskGuide(a),retry);
});

test('malformed requests do not modify a valid account checkpoint',async t=>{
  const f=await fixture(t),a=await f.account();const before=await f.hashes();
  for(const body of [null,[],{}, {version:2,action:'begin',revision:-1},{version:2,action:'begin',revision:0.5},
    {version:2,action:'begin',revision:'0'},{version:2,action:'unknown',revision:0},{version:2,action:'advance',revision:0,step:8}]) {
    const r=await f.api('POST','/onboarding',body,a);assert.equal(r.status,400);
  }
  assert.deepEqual(await f.read(a),initial());assert.deepEqual(await f.hashes(),before);
});

test('every previous enrollment resets once; confirmed v2 completion alone is retained',async t=>{
  const f=await fixture(t),a=await f.account();
  for(const status of ['pending','active','skipped','done']){
    await f.restart(index=>{index.accounts.find(row=>row.id===a.id).onboarding={version:1,status,step:status==='done'?8:3,revision:99,checks:[]};});
    const before=await f.hashes();assert.deepEqual(await f.login(a),initial());assert.deepEqual(await f.read(a),initial());assert.deepEqual(await f.hashes(),before);
    const next=await f.change(a,{version:2,action:'begin',revision:0});assert.equal(next.version,2);assert.equal(next.status,'active');assert.equal(next.step,0);
    await f.restart();assert.deepEqual(await f.login(a),next);
  }
});

test('old clients cannot complete or pause a new enrollment even when revisions match',async t=>{
  const f=await fixture(t),a=await f.account(),before=await f.hashes();
  for(const version of [undefined,1,3])for(const action of ['begin','restart','skip','advance','check']){
    const r=await f.api('POST','/onboarding',{version,action,revision:0,step:1,checks:['move','look']},a);
    assert.equal(r.status,400);assert.equal(r.body.error.code,'INVALID_GUIDE');
  }
  assert.deepEqual(await f.hashes(),before);assert.deepEqual(await f.read(a),initial());
});

test('every step requires all checkpoints; pause is not completion and resume retains partial work',async t=>{
  const f=await fixture(t),a=await f.account();let value=await f.change(a,{version:2,action:'begin',revision:0});
  for(let step=0;step<8;step++){
    const nextStep=()=>({version:2,action:'advance',revision:value.revision,step:step+1});
    assert.equal((await f.api('POST','/onboarding',nextStep(),a)).status,400);
    const checks=expectedChecks[step];
    if(checks.length>1){value=await f.change(a,{version:2,action:'check',revision:value.revision,checks:checks.slice(0,-1)});assert.equal((await f.api('POST','/onboarding',nextStep(),a)).status,400);}
    const partial=structuredClone(value);
    value=await f.change(a,{version:2,action:'pause',revision:value.revision});assert.equal(value.status,'paused');assert.equal(value.step,step);assert.deepEqual(value.checks,partial.checks);
    await f.restart();assert.deepEqual(await f.login(a),value);
    value=await f.change(a,{version:2,action:'begin',revision:value.revision});assert.equal(value.step,step);assert.deepEqual(value.checks,partial.checks);
    value=await f.change(a,{version:2,action:'check',revision:value.revision,checks});
    value=await f.change(a,nextStep());
  }
  assert.equal(value.status,'done');await f.restart();assert.deepEqual(await f.login(a),value);
});

test('first v2 enrollment transaction changes only the learning field and failed migration remains pending',async t=>{
  const f=await fixture(t),a=await f.account();await f.api('POST','/adventures',{title:'原冒险保留'},a);
  await f.restart(index=>{delete index.accounts.find(row=>row.id===a.id).onboarding;});await f.login(a);
  const readIndex=async()=>new CheckedStore(path.join(f.directory,'index')).load();
  const before=await readIndex(),hashes=await f.hashes();f.disk.free=511*1024**2;
  const denied=await f.api('POST','/onboarding',{version:2,action:'begin',revision:0},a);assert.equal(denied.status,507);
  assert.deepEqual(await f.hashes(),hashes);assert.deepEqual(await f.read(a),initial());
  f.disk.free=20*1024**3;
  const concurrent=await Promise.all([0,1].map(()=>f.api('POST','/onboarding',{version:2,action:'begin',revision:0},a)));
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const after=await readIndex();delete after.accounts.find(row=>row.id===a.id).onboarding;
  assert.deepEqual(after,before,'credentials, account fields, other members and adventures unchanged');
});
