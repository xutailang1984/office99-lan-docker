import test from 'node:test';
import assert from 'node:assert/strict';
import {createOnboardingChannel} from '../../../client/platform/onboarding-client.mjs';

// No browser, renderer or server: controlled promises model the private iframe
// bridge while the companion HTTP suite verifies authentication and durability.
const progress=(revision=0,extra={})=>({version:2,status:revision?'active':'pending',step:0,revision,checks:[],...extra});
const raw=(extra={})=>JSON.stringify({version:2,action:'begin',revision:0,...extra});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(handler=async()=>({onboarding:progress(1)})) {
  let account={id:'synthetic-account-a',onboarding:progress()},currentFrame='frame-a',roomPresent=true;
  const capturedFrame=currentFrame,calls=[],messages=[];
  const channel=createOnboardingChannel({
    api:async(route,options)=>{calls.push({route,options});return handler(route,options);},
    currentAccount:()=>account,isCurrent:()=>roomPresent&&currentFrame===capturedFrame,
    deliver:value=>messages.push(structuredClone(value))
  });
  return {channel,calls,messages,get account(){return account;},setAccount:value=>account=value,
    retireFrame:()=>{currentFrame='frame-b';},leaveRoom:()=>{roomPresent=false;}};
}

test('channel exposes only serialized onboarding and reads the currently signed-in account',()=>{
  const f=fixture();assert.deepEqual(JSON.parse(f.channel.state()),progress());
  f.setAccount({id:'synthetic-account-b',onboarding:progress(4,{step:2})});
  assert.deepEqual(JSON.parse(f.channel.state()),progress(4,{step:2}));
  f.setAccount({id:'synthetic-legacy'});const old=JSON.parse(f.channel.state());
  assert.equal(old.status,'pending');assert.equal(old.step,0);assert.equal(old.revision,0);
  assert(!Object.hasOwn(old,'id'),'no account identity is included in the game progress payload');
});

test('normal update waits for confirmed account data and sends one private state message',async()=>{
  const response=deferred(),f=fixture(()=>response.promise),operation=f.channel.update(raw());
  assert.equal(f.calls.length,1);assert.deepEqual(f.account.onboarding,progress());assert.equal(f.messages.length,0);
  assert.deepEqual(f.calls[0],{route:'onboarding',options:{method:'POST',body:{version:2,action:'begin',revision:0}}});
  response.resolve({onboarding:progress(1)});await operation;
  assert.deepEqual(f.account.onboarding,progress(1));
  assert.deepEqual(f.messages,[{type:'onboarding_state',onboarding:progress(1),error:''}]);
});

test('lost POST acknowledgement is reconciled by GET without posting another mutation',async()=>{
  const saved=progress(1),f=fixture(async(route,options)=>{
    if(options?.method==='POST')throw Error('synthetic lost response');return {onboarding:saved};
  });
  await f.channel.update(raw());assert.equal(f.calls.length,2);
  assert.deepEqual(f.calls[1],{route:'onboarding',options:undefined});
  assert.deepEqual(f.account.onboarding,saved);assert.equal(f.messages[0].error,'');
  assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,1);
});

test('failed save and unchanged GET retain old progress and report a retry without leaking the API error',async()=>{
  const f=fixture(async(route,options)=>{if(options)throw Error('PRIVATE_TEST_BACKEND_DETAIL');return {onboarding:progress()};});
  await f.channel.update(raw());assert.deepEqual(f.account.onboarding,progress());
  assert.equal(f.messages[0].error,'引导未保存，正在重试');
  assert(!JSON.stringify(f.messages).includes('PRIVATE_TEST_BACKEND_DETAIL'));
});

test('failed POST and failed readback never optimistically mark the guide saved; explicit retry remains possible',async()=>{
  let recover=false;
  const f=fixture(async()=>{if(!recover)throw Error('PRIVATE_TEST_READ_FAILURE');return {onboarding:progress(1)};});
  await f.channel.update(raw());assert.equal(f.calls.length,2);assert.deepEqual(f.account.onboarding,progress());
  assert.equal(f.messages[0].error,'引导未保存，正在重试');
  recover=true;await f.channel.update(raw());assert.equal(f.calls.length,3);
  assert.deepEqual(f.account.onboarding,progress(1));assert.equal(f.messages[1].error,'');
});

test('duplicate in-flight requests are coalesced without dropping the pending guard during GET recovery',async()=>{
  const readback=deferred(),reading=deferred();
  const f=fixture(async(route,options)=>{if(options)throw Error('lost acknowledgement');reading.resolve();return readback.promise;});
  const first=f.channel.update(raw());await reading.promise;
  await Promise.all([f.channel.update(raw()),f.channel.update(raw({version:2,action:'skip'}))]);
  assert.equal(f.calls.length,2);assert.equal(f.messages.length,0);
  readback.resolve({onboarding:progress(1)});await first;
  assert.equal(f.calls.length,2);assert.equal(f.messages.length,1);
});

test('malformed, oversized or non-object bridge inputs perform no HTTP work',async()=>{
  const f=fixture();
  for(const input of [undefined,null,42,{},'', 'bad json','null','[]','"begin"','false','0','x'.repeat(257)])await f.channel.update(input);
  assert.equal(f.calls.length,0);assert.equal(f.messages.length,0);assert.deepEqual(f.account.onboarding,progress());
});

test('retired iframe cannot submit a new update',async()=>{
  const f=fixture();f.retireFrame();await f.channel.update(raw());
  assert.equal(f.calls.length,0);assert.equal(f.messages.length,0);
});

test('an update confirmed after iframe replacement does not deliver to the retired game',async()=>{
  const response=deferred(),f=fixture(()=>response.promise),operation=f.channel.update(raw());
  f.retireFrame();response.resolve({onboarding:progress(1)});await operation;
  assert.equal(f.messages.length,0);assert.equal(f.calls.length,1);
  // The confirmed account preference may remain cached for this same account;
  // stale frame delivery and cross-account writes are forbidden separately.
  assert.deepEqual(f.account.onboarding,progress(1));
});

test('leaving the room blocks new updates and does not reopen or message an old game',async()=>{
  const response=deferred(),f=fixture(()=>response.promise),operation=f.channel.update(raw());
  f.leaveRoom();response.resolve({onboarding:progress(1)});await operation;
  await f.channel.update(raw({version:2,action:'advance',revision:1,step:1}));
  assert.equal(f.calls.length,1);assert.equal(f.messages.length,0);
});

test('a response from the previous signed-in account cannot alter the replacement account',async()=>{
  const response=deferred(),f=fixture(()=>response.promise),old=f.account,operation=f.channel.update(raw());
  const replacement={id:'synthetic-account-b',onboarding:progress(6,{step:3})};f.setAccount(replacement);
  response.resolve({onboarding:progress(1)});await operation;
  assert.deepEqual(old.onboarding,progress());assert.deepEqual(replacement.onboarding,progress(6,{step:3}));
  assert.equal(f.messages.length,0);
});

test('logout before acknowledgement cannot deliver progress and anonymous calls cannot submit',async()=>{
  const response=deferred(),f=fixture(()=>response.promise),operation=f.channel.update(raw());
  f.setAccount(null);response.resolve({onboarding:progress(1)});await operation;await f.channel.update(raw());
  assert.equal(f.calls.length,1);assert.equal(f.messages.length,0);assert.equal(f.account,null);
});

test('account switch during lost-ACK readback cannot apply the earlier account record',async()=>{
  const readback=deferred(),reading=deferred();
  const f=fixture(async(route,options)=>{if(options)throw Error('lost acknowledgement');reading.resolve();return readback.promise;});
  const operation=f.channel.update(raw());await reading.promise;
  f.setAccount({id:'synthetic-account-b',onboarding:progress()});readback.resolve({onboarding:progress(8,{step:4})});await operation;
  assert.deepEqual(f.account.onboarding,progress());assert.equal(f.messages.length,0);
});

test('late successful responses cannot roll the current account cache back to an older revision',async()=>{
  const response=deferred(),f=fixture(()=>response.promise),operation=f.channel.update(raw());
  const latest=progress(5,{step:2});f.account.onboarding=latest;
  response.resolve({onboarding:progress(1)});await operation;
  assert.deepEqual(f.account.onboarding,latest);assert.deepEqual(f.messages[0].onboarding,latest);
});

test('CAS conflict reads current durable progress instead of replaying or forcing an old action',async()=>{
  const latest=progress(3,{checks:['move','look']});
  const f=fixture(async(route,options)=>{if(options)throw Object.assign(Error('conflict'),{code:'GUIDE_CHANGED'});return {onboarding:latest};});
  await f.channel.update(raw());assert.deepEqual(f.account.onboarding,latest);
  assert.equal(f.messages.length,1);assert.deepEqual(f.messages[0].onboarding,latest);
  assert.equal(f.calls.filter(c=>c.options?.method==='POST').length,1);
});

test('duplicate already-saved checks can be acknowledged at the same revision',async()=>{
  const saved=progress(4,{step:5,checks:['store','storage']}),f=fixture(async()=>({onboarding:saved}));
  f.account.onboarding=structuredClone(saved);
  await f.channel.update(raw({version:2,action:'check',revision:4,checks:['storage']}));
  assert.deepEqual(f.account.onboarding,saved);assert.equal(f.messages[0].error,'');assert.equal(f.calls.length,1);
});

test('a new enrollment epoch replaces older high revisions and late old epochs cannot replace it',async()=>{
  const f=fixture(async()=>({onboarding:progress()}));f.account.onboarding={version:1,status:'done',step:8,revision:999,checks:[]};
  await f.channel.update(raw());assert.deepEqual(f.account.onboarding,progress());
  const response=deferred(),g=fixture(()=>response.promise),operation=g.channel.update(raw());
  response.resolve({onboarding:{version:1,status:'done',step:8,revision:1000,checks:[]}});await operation;
  assert.deepEqual(g.account.onboarding,progress());assert.deepEqual(g.messages[0].onboarding,progress());
});
