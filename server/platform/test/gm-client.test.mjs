import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {chatSubmission,routeGmSignal} from '../../../client/platform/gm-client.mjs';
import {createGmGrantController} from '../../../client/platform/gm-worker.mjs';

const room = () => ({id:'test-room',epoch:3,ownerId:'test-owner',hostPeerId:'test-host',members:[{peerId:'test-host',accountId:'test-owner'}]});
const ticket = () => ({type:'gm_grant',roomId:'test-room',epoch:3,grantId:'test_grant_1'});
const grant = () => ({id:'test_grant_1',roomId:'test-room',epoch:3,hostPeerId:'test-host',peerId:'test-gm',accountId:'test-account',resources:{credits:20,materials:30}});
function deferred() {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function context(overrides={}) {
  const sent=[];return {sent,room:room(),accountId:'test-owner',selfPeerId:'test-host',worker:{postMessage:m=>sent.push(m)},...overrides};
}
function fixture({fetcher,apply}={}) {
  const calls=[],applied=[];
  let current={room:room(),stopping:false,applyGmGrant:async value=>{applied.push(value);calls.push('apply');return apply?await apply(value):{ok:true,receipt:{id:value.id},revision:2};}};
  const original=current;
  const controller=createGmGrantController({getRuntime:()=>current,fetcher:async(url,options)=>{
    const action=url.split('/').at(-1);calls.push(action);
    if(fetcher)return fetcher(action,options,url);
    return {ok:true,json:async()=>({grant:grant()})};
  }});
  return {controller,calls,applied,original,setRuntime:value=>current=value};
}

test('GM submissions use HTTP-compatible random values and preserve chat focus',()=>{
  const ids=new Set();
  for(const value of ['/gm','/GM help',' /gm\t资源 ']) {
    const result=chatSubmission(value,{getRandomValues:array=>webcrypto.getRandomValues(array)});
    assert.equal(result.keepOpen,true);assert.equal(result.message.type,'chat');
    assert.equal(result.message.text,value.trim());assert.match(result.message.gmRequestId,/^gm_[0-9a-f]{32}$/);
    ids.add(result.message.gmRequestId);
  }
  assert.equal(ids.size,3);
});
test('ordinary chat retains its original payload and blur behavior',()=>{
  for(const text of ['/gmx','/gmfoo','你好','请看 /gm'])assert.deepEqual(chatSubmission(text),{message:{type:'chat',text},keepOpen:false});
  assert.deepEqual(chatSubmission('  '),{message:null,keepOpen:false});
});
test('full-width GM input is recognized without changing the sent text',()=>{
  const text='／ｇｍ　资源　１００',result=chatSubmission(text,webcrypto);
  assert.equal(result.keepOpen,true);assert.equal(result.message.text,text);assert.match(result.message.gmRequestId,/^gm_[0-9a-f]{32}$/);
});
test('private notices use the GM label for every supported status',()=>{
  for(const status of ['pending','saved','error','help']) {
    const notices=[];
    assert.equal(routeGmSignal({type:'gm_notice',roomId:'test-room',epoch:3,status,text:'测试消息',from:{name:'other'}},context(),m=>notices.push(m)),true);
    assert.deepEqual(notices,[{from:{name:'GM'},text:'测试消息'}]);
  }
});
test('stale, logged-out, leaving and malformed notices are ignored',()=>{
  const valid={type:'gm_notice',roomId:'test-room',epoch:3,status:'saved',text:'测试消息'};
  const fail=()=>assert.fail('must not display stale notice');
  for(const change of [{roomId:'another'},{epoch:2},{status:'unknown'},{text:null}])assert.equal(routeGmSignal({...valid,...change},context(),fail),false);
  for(const change of [{room:null},{accountId:null},{leaving:true}])assert.equal(routeGmSignal(valid,context(change),fail),false);
});
test('only the current host forwards a canonical grant to its current worker',()=>{
  const c=context();
  assert.equal(routeGmSignal({...ticket(),resources:{credits:999},accountId:'other'},c,()=>assert.fail()),true);
  assert.deepEqual(c.sent,[ticket()]);
  for(const change of [{accountId:'guest'},{selfPeerId:'old-host'},{worker:null},{workerFailed:true},{leaving:true}]) {
    const denied=context(change);assert.equal(routeGmSignal(ticket(),denied,()=>assert.fail()),false);assert.equal(denied.sent.length,0);
  }
  for(const grantId of [null,42,'bad/id','', 'a'.repeat(129)])assert.equal(routeGmSignal({...ticket(),grantId},context(),()=>assert.fail()),false);
});
test('ordinary peer packets cannot enter GM routing',()=>{
  assert.equal(routeGmSignal({type:'packet',roomId:'test-room',epoch:3,grantId:'test_grant_1'},context(),()=>assert.fail()),false);
});
test('grant completion waits for the durable save and uses only server grant data',async()=>{
  const saving=deferred(),entered=deferred(),posts=[];
  const f=fixture({apply:async()=>{entered.resolve();await saving.promise;return {ok:true,receipt:{id:'test_grant_1'},revision:2};},fetcher:async(action,options,url)=>{
    posts.push({action,options,url});return {ok:true,json:async()=>({grant:grant()})};
  }});
  const pending=f.controller.receive({...ticket(),resources:{credits:999999}});
  await entered.promise;assert.deepEqual(f.calls,['verify','apply']);
  saving.resolve();assert.deepEqual(await pending,{ok:true});assert.deepEqual(f.calls,['verify','apply','complete']);
  assert.deepEqual(f.applied,[grant()]);
  for(const {options,url} of posts) {
    assert.equal(options.method,'POST');assert.equal(options.credentials,'same-origin');
    assert.deepEqual(JSON.parse(options.body),{grantId:'test_grant_1',epoch:3});
    assert.match(url,/^\/api\/platform\/rooms\/test-room\/gm\/(?:verify|complete)$/);
  }
});
test('same grant in flight shares one operation; a later retry retains its ticket',async()=>{
  const saving=deferred(),entered=deferred();
  const f=fixture({apply:async()=>{entered.resolve();await saving.promise;return {ok:true};}});
  const first=f.controller.receive(ticket()),second=f.controller.receive(ticket());
  assert.equal(first,second);await entered.promise;assert.equal(f.applied.length,1);
  saving.resolve();await first;
  await f.controller.receive(ticket());
  assert.equal(f.applied.length,2);assert.equal(f.applied[1].id,f.applied[0].id);
  // Durable replay deduplication belongs to RoomRuntime/World, not this transport.
});
test('ordinary autosave finishes before the verified grant is applied',async()=>{
  const saving=deferred(),verified=deferred();
  const f=fixture({fetcher:async()=>{verified.resolve();return {ok:true,json:async()=>({grant:grant()})};}});
  f.original.saving=saving.promise;
  const operation=f.controller.receive(ticket());await verified.promise;
  await Promise.resolve();await Promise.resolve();assert.equal(f.applied.length,0);
  f.original.saving=null;saving.resolve();assert.deepEqual(await operation,{ok:true});assert.deepEqual(f.calls,['verify','apply','complete']);
});
test('failed ordinary autosave requests explicit retry and never applies new resources',async()=>{
  const saving=deferred(),verified=deferred();
  const f=fixture({fetcher:async()=>{verified.resolve();return {ok:true,json:async()=>({grant:grant()})};}});
  f.original.saving=saving.promise;
  const operation=f.controller.receive(ticket());await verified.promise;
  await Promise.resolve();await Promise.resolve();saving.reject(Error('private detail'));
  assert.deepEqual(await operation,{ok:false});assert.equal(f.applied.length,0);assert.deepEqual(f.calls,['verify','fail']);
});
test('closing cancels an autosave wait without reporting against a new room',async()=>{
  const saving=deferred(),verified=deferred();
  const f=fixture({fetcher:async()=>{verified.resolve();return {ok:true,json:async()=>({grant:grant()})};}});
  f.original.saving=saving.promise;
  const operation=f.controller.receive(ticket());await verified.promise;
  await Promise.resolve();await Promise.resolve();f.controller.cancel();
  assert.deepEqual(await operation,{ok:false});assert.equal(f.applied.length,0);assert.deepEqual(f.calls,['verify']);
  saving.resolve();
});
test('invalid commands and stale initial context perform no HTTP requests',async()=>{
  const f=fixture();
  for(const change of [{type:'packet'},{roomId:'other'},{epoch:2},{grantId:12},{grantId:'../bad'}])assert.deepEqual(await f.controller.receive({...ticket(),...change}),{ok:false});
  f.original.stopping=true;assert.deepEqual(await f.controller.receive(ticket()),{ok:false});
  f.setRuntime(null);assert.deepEqual(await f.controller.receive(ticket()),{ok:false});assert.deepEqual(f.calls,[]);
});
for(const [field,value] of [['id','other'],['roomId','other'],['epoch',2],['hostPeerId','other']]) {
  test('verified grant rejects mismatched '+field,async()=>{
    const f=fixture({fetcher:async()=>({ok:true,json:async()=>({grant:{...grant(),[field]:value}})})});
    assert.deepEqual(await f.controller.receive(ticket()),{ok:false});assert.deepEqual(f.calls,['verify','fail']);assert.equal(f.applied.length,0);
  });
}
for(const mode of ['rejected','json-error','apply-error','save-not-confirmed','complete-error']) {
  test(mode+' produces a best-effort private failure without a fatal throw',async()=>{
    const posts=[];
    const f=fixture({apply:async()=>{if(mode==='apply-error')throw Error('private detail');return {ok:mode!=='save-not-confirmed'};},fetcher:async(action,options)=>{
      posts.push(JSON.parse(options.body));
      if(mode==='complete-error'&&action==='complete')throw Error('private detail');
      return {ok:!(mode==='rejected'&&action==='verify'),json:async()=>{if(mode==='json-error')throw Error('private detail');return {grant:grant()};}};
    }});
    assert.deepEqual(await f.controller.receive(ticket()),{ok:false});assert.equal(f.calls.at(-1),'fail');
    if(mode!=='complete-error')assert.equal(f.calls.includes('complete'),false);
    for(const body of posts)assert.deepEqual(body,{grantId:'test_grant_1',epoch:3});
  });
}
test('failure reporting failure is contained and does not block retry',async()=>{
  let reject=true;
  const f=fixture({fetcher:async()=>{if(reject)throw Error('private detail');return {ok:true,json:async()=>({grant:grant()})};}});
  assert.deepEqual(await f.controller.receive(ticket()),{ok:false});assert.deepEqual(f.calls,['verify','fail']);
  reject=false;assert.deepEqual(await f.controller.receive(ticket()),{ok:true});
});
test('known runtime failure codes pass only the enumerated code to private failure reporting',async()=>{
  for(const code of ['GM_BALANCE_LIMIT','GM_GRANT_LIMIT','GM_NOT_READY','GM_NOT_MEMBER','GM_BUSY','GM_SAVE_FAILED','GM_REPLAY_MISMATCH']) {
    const posts=[];
    const f=fixture({apply:async()=>{throw Object.assign(Error('private runtime detail'),{code});},fetcher:async(action,options)=>{
      posts.push({action,body:JSON.parse(options.body)});return {ok:true,json:async()=>({grant:grant()})};
    }});
    assert.deepEqual(await f.controller.receive(ticket()),{ok:false});
    assert.deepEqual(posts,[{action:'verify',body:{grantId:'test_grant_1',epoch:3}},{action:'fail',body:{grantId:'test_grant_1',epoch:3,code}}]);
  }
});
test('unknown runtime codes and error messages never enter failure requests',async()=>{
  for(const code of ['PRIVATE_RUNTIME_DETAIL','gm_balance_limit',null,123,{message:'private runtime detail'}]) {
    const posts=[];
    const f=fixture({apply:async()=>{throw Object.assign(Error('private runtime detail'),{code});},fetcher:async(action,options)=>{
      posts.push({action,body:JSON.parse(options.body)});return {ok:true,json:async()=>({grant:grant()})};
    }});
    assert.deepEqual(await f.controller.receive(ticket()),{ok:false});
    assert.deepEqual(posts,[{action:'verify',body:{grantId:'test_grant_1',epoch:3}},{action:'fail',body:{grantId:'test_grant_1',epoch:3}}]);
  }
});
for(const change of ['runtime','epoch','host','stopping','cancel']) {
  test('context change during verification ignores a late response: '+change,async()=>{
    const verifying=deferred(),entered=deferred();let signal;
    const f=fixture({fetcher:async(action,options)=>{assert.equal(action,'verify');signal=options.signal;entered.resolve();return verifying.promise;}});
    const operation=f.controller.receive(ticket());await entered.promise;
    if(change==='runtime')f.setRuntime({...f.original});
    if(change==='epoch')f.original.room.epoch++;
    if(change==='host')f.original.room.hostPeerId='replacement';
    if(change==='stopping')f.original.stopping=true;
    if(change==='cancel'){f.controller.cancel();assert.equal(signal.aborted,true);}
    verifying.resolve({ok:true,json:async()=>({grant:grant()})});
    assert.deepEqual(await operation,{ok:false});assert.equal(f.applied.length,0);assert.deepEqual(f.calls,['verify']);
  });
}
test('closing while saving prevents completion or failure against a new room',async()=>{
  const saving=deferred(),entered=deferred();
  const f=fixture({apply:async()=>{entered.resolve();await saving.promise;return {ok:true};}});
  const operation=f.controller.receive(ticket());await entered.promise;f.controller.cancel();
  saving.resolve();assert.deepEqual(await operation,{ok:false});assert.deepEqual(f.calls,['verify','apply']);
});
test('cancelled old promise cannot erase a new same-ticket operation',async()=>{
  const oldVerify=deferred(),newSave=deferred(),oldEntered=deferred(),newEntered=deferred();let verifies=0;
  const f=fixture({fetcher:async action=>{
    if(action==='verify'&&++verifies===1){oldEntered.resolve();return oldVerify.promise;}
    return {ok:true,json:async()=>({grant:grant()})};
  },apply:async()=>{newEntered.resolve();await newSave.promise;return {ok:true};}});
  const old=f.controller.receive(ticket());await oldEntered.promise;f.controller.cancel();
  const fresh=f.controller.receive(ticket());await newEntered.promise;
  oldVerify.resolve({ok:true,json:async()=>({grant:grant()})});assert.deepEqual(await old,{ok:false});
  assert.equal(f.controller.receive(ticket()),fresh);newSave.resolve();assert.deepEqual(await fresh,{ok:true});assert.equal(f.applied.length,1);
});
