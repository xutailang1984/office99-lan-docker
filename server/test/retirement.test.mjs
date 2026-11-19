import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,cp,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const build=JSON.parse(await readFile(path.join(root,'server/package.json'),'utf8')).version;
import {createGameServer} from '../server.mjs';
const {WebSocket}=createRequire(path.join(root,'server/package.json'))('ws');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function request(port,route,{method='GET',headers={},body}={}){return new Promise((resolve,reject)=>{
 const raw=body===undefined?'':JSON.stringify(body),req=http.request({host:'127.0.0.1',port,path:route,method,headers:{...(raw?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(raw)}:{}),...headers}},res=>{let data='';res.setEncoding('utf8');res.on('data',b=>data+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,raw:data,json:()=>JSON.parse(data)}));});req.setTimeout(5000,()=>req.destroy(Error('ISOLATED_HTTP_TIMEOUT')));req.on('error',reject);req.end(raw);
});}
async function rejectedUpgrade(port,route){return await new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${port}${route}`),timer=setTimeout(()=>{ws.terminate();reject(Error('UPGRADE_NOT_REJECTED'));},3000);ws.on('error',()=>{});ws.once('unexpected-response',(_req,res)=>{clearTimeout(timer);res.resume();resolve(res.statusCode);});ws.once('open',()=>{clearTimeout(timer);ws.terminate();reject(Error('RETIRED_UPGRADE_OPENED'));});});}
async function connect(f,route,headers={}){const ws=new WebSocket(`ws://127.0.0.1:${f.server.port}${route}`,{headers}),messages=[];f.sockets.push(ws);ws.on('error',()=>{});ws.on('message',b=>messages.push(JSON.parse(b)));let closeCode=null;ws.on('close',code=>closeCode=code);await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});return {ws,messages,get closeCode(){return closeCode;},send:m=>ws.send(JSON.stringify(m)),async wait(predicate){const end=Date.now()+4000;while(Date.now()<end){const value=messages.find(predicate);if(value)return value;await delay(10);}throw Error('EXPECTED_MESSAGE_MISSING');}};}
async function fixture(t,extra={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'tidal-retirement-')),serverDir=path.join(directory,'server'),webRoot=path.join(directory,'web'),saveFile=path.join(directory,'data/save.json');let f={directory,webRoot,saveFile,sockets:[],server:null};
 t.after(async()=>{for(const ws of f.sockets)ws.terminate();await f.server?.stop();assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('tidal-retirement-'));await rm(directory,{recursive:true,force:true});});
 await mkdir(serverDir);await mkdir(webRoot);await mkdir(path.dirname(saveFile));await mkdir(path.join(directory,'data/survival'));
 await writeFile(path.join(webRoot,'index.html'),'<title>Latest lobby fixture</title>');await writeFile(path.join(webRoot,'classic.html'),'OLD_ENGINE_MUST_NOT_RUN');await writeFile(path.join(webRoot,'legacy.html'),'OLD_ENGINE_MUST_NOT_RUN');
 f.create=createGameServer;
 f.settings={port:0,host:'127.0.0.1',webRoot,saveFile,survivalConfigPath:path.join(root,'client/survival/balance.json'),shutdownToken:randomBytes(32).toString('base64url'),...extra};
 f.start=async()=>f.server=await f.create(f.settings);return f;
}

test('latest defaults ignore old corrupt saves, redirect old bookmarks, reject old HTTP/WS and keep health',async t=>{
 const f=await fixture(t,{survival:true});const oldSurvival=path.join(f.directory,'data/survival/snapshot-0.json');
 await writeFile(f.saveFile,'OFFLINE_OLD_SAVE_NOT_VALIDATED_OR_WRITTEN');await writeFile(oldSurvival,'OFFLINE_OLD_SURVIVAL_NOT_VALIDATED_OR_WRITTEN');await f.start();
 const health=(await request(f.server.port,'/health')).json();assert.equal(health.service,'voxel-fishing');assert.equal(health.build,build);assert.equal(health.pid,process.pid);assert.equal(health.ready,true);assert.equal(health.mode,'latest-only');assert.equal(health.legacyEnabled,false);assert.equal(health.maxPlayers,8);assert.equal(health.survival,null);assert.equal(health.platform.ready,true);
 for(const route of ['/legacy.html','/classic.html?old=1','/%6cegacy.html','/CLASSIC.HTML','/legacy/']){const r=await request(f.server.port,route);assert.equal(r.status,302);assert.equal(r.headers.location,'/');assert(!r.raw.includes('OLD_ENGINE'));}
 for(const route of ['/ws','/survival/ws','/survival/status','/api/state','/api/classic/action']){assert.equal((await request(f.server.port,route)).status,410);assert.equal((await request(f.server.port,route,{method:'POST',body:{type:'hello'}})).status,410);}
 for(const route of ['/ws','/survival/ws','/%77s'])assert.equal(await rejectedUpgrade(f.server.port,route),410);
 assert.equal((await request(f.server.port,'/api/platform/me')).status,401);
 await f.server.flushSave();await f.server.stop();assert.equal(await readFile(f.saveFile,'utf8'),'OFFLINE_OLD_SAVE_NOT_VALIDATED_OR_WRITTEN');assert.equal(await readFile(oldSurvival,'utf8'),'OFFLINE_OLD_SURVIVAL_NOT_VALIDATED_OR_WRITTEN');
});

test('latest platform auth, signal, save and local authenticated shutdown remain functional',async t=>{
 const f=await fixture(t);await f.start();const port=f.server.port,origin=`http://127.0.0.1:${port}`;
 const register=await request(port,'/api/platform/register',{method:'POST',headers:{Origin:origin},body:{username:'isolated_retirement',password:randomBytes(24).toString('base64url'),name:'测试队员'}});assert.equal(register.status,201);const Cookie=register.headers['set-cookie'][0].split(';')[0],headers={Origin:origin,Cookie};
 const peer=await connect(f,'/platform/signal',headers);await peer.wait(m=>m.type==='session');
 const a=await request(port,'/api/platform/adventures',{method:'POST',headers,body:{title:'隔离最新版'}});assert.equal(a.status,201);
 const created=await request(port,'/api/platform/rooms',{method:'POST',headers,body:{adventureId:a.json().adventure.id}});assert.equal(created.status,201);const room=created.json().room;
 peer.send({type:'ready',ready:true});await peer.wait(m=>m.type==='room'&&m.room.members.every(p=>p.ready));assert.equal((await request(port,`/api/platform/rooms/${room.id}/start`,{method:'POST',headers,body:{}})).status,200);
 const state={schema:3,worldId:'isolated-retirement-world',tick:30,time:1,phase:'DAY',players:{},items:{},containers:{storage:{id:'storage',slotLimit:80,itemIds:[]}},buildings:{core:{id:'core',hp:2000}},bank:{credits:17,materials:3,reservedCredits:0,reservedMaterials:0}};
 assert.equal((await request(port,`/api/platform/adventures/${room.adventureId}/snapshot`,{method:'PUT',headers,body:{roomId:room.id,hostEpoch:room.epoch,baseRevision:0,saveSeq:1,state}})).status,200);
 assert.equal((await request(port,'/shutdown',{method:'POST',body:{}})).status,403);assert.equal((await request(port,'/shutdown',{method:'POST',headers:{Origin:origin,'X-Shutdown-Token':f.settings.shutdownToken},body:{}})).status,403);
 const stop=await request(port,'/shutdown',{method:'POST',headers:{'X-Shutdown-Token':f.settings.shutdownToken},body:{}});assert.equal(stop.status,200);assert.equal(stop.json().saved,true);await f.server.stop();
 const persisted=path.join(f.directory,'data/platform/adventures',room.adventureId);const snapshots=await Promise.all((await readdir(persisted)).filter(n=>/^snapshot-\d\.json$/.test(n)).map(async n=>JSON.parse(await readFile(path.join(persisted,n),'utf8'))));assert(snapshots.some(s=>s.value.state.time===1&&s.value.state.bank.credits===17));
 await assert.rejects(stat(f.saveFile),error=>error.code==='ENOENT');
});

test('only an explicit loopback test opt-in can revive old routes with independent temporary saves',async t=>{
 const f=await fixture(t,{testLegacyModes:true,survival:true});await assert.rejects(f.create({...f.settings,host:'0.0.0.0'}),/Legacy test modes require loopback/);await assert.rejects(f.create({...f.settings,saveFile:undefined}),/explicit isolated saveFile/);await f.start();
 const classic=await connect(f,'/ws'),survival=await connect(f,'/survival/ws');classic.send({type:'hello',name:'测试经典'});survival.send({type:'hello',name:'测试旧生存'});assert(await classic.wait(m=>m.type==='welcome'));assert(await survival.wait(m=>m.type==='welcome'));
 const h=(await request(f.server.port,'/health')).json();assert.equal(h.mode,'isolated-legacy-test');assert.equal(h.platform,null);assert.equal(h.classicPlayers,1);assert.equal(h.survival.players,1);assert.equal((await request(f.server.port,'/classic.html')).status,200);await f.server.stop();assert.equal(Object.keys(JSON.parse(await readFile(f.saveFile,'utf8')).profiles).length,1);
});

test('latest static Worker modules retain isolation/MIME and old direct play bridge redirects to lobby',async t=>{
 const f=await fixture(t);await mkdir(path.join(f.webRoot,'platform/sim'),{recursive:true});
 for(const name of ['app.mjs','host-worker.mjs','link-policy.mjs'])await cp(path.join(root,'client/platform',name),path.join(f.webRoot,'platform',name));
 for(const name of ['world.mjs','mission-mode.mjs','fishing-experience.mjs','exploration.mjs','exploration-config.mjs','host-session.mjs','room-runtime.mjs','state-wire.mjs','terrain-layout.mjs','portable-id.mjs','director.mjs','director-combat.mjs','director-config.mjs','night-content-config.mjs','night-content.mjs','social-config.mjs','social-activities.mjs','day-content-config.mjs','day-content.mjs','tactical-content.mjs','social.mjs','enemy-aggro.mjs','enemy-navigation.mjs','gm-resources.mjs','member-progress.mjs','career-state.mjs','crafting.mjs','crafting-config.mjs','assembly-config.mjs','gear-growth.mjs','expedition.mjs','expedition-config.mjs'])await cp(path.join(root,'server/survival',name),path.join(f.webRoot,'platform/sim',name));
 await f.start();for(const route of ['/platform/host-worker.mjs','/platform/sim/room-runtime.mjs','/platform/sim/world.mjs']){const r=await request(f.server.port,route);assert.equal(r.status,200);assert.match(r.headers['content-type'],/javascript/);assert.equal(r.headers['cross-origin-embedder-policy'],'require-corp');assert.equal(r.headers['cross-origin-opener-policy'],'same-origin');}
 const finalizer=await readFile(path.join(root,'tools/finalize_web.mjs'),'utf8');assert(finalizer.includes('location.replace("/")'));assert(!finalizer.includes("args: ['--', '--classic']"));
});

test('actual finalizer overwrites stale playable entries with redirects and publishes the current Worker graph',async t=>{
 const f=await fixture(t);await mkdir(path.join(f.directory,'tools'));await mkdir(path.join(f.directory,'client/fonts'),{recursive:true});
 await cp(path.join(root,'tools/readable-copy.mjs'),path.join(f.directory,'tools/readable-copy.mjs'));
 await cp(path.join(root,'client/moba-web'),path.join(f.directory,'client/moba-web'),{recursive:true});
 await mkdir(path.join(f.directory,'server/moba'));for(const name of ['catalog.mjs','map.mjs','world.mjs','wire.mjs'])await cp(path.join(root,'server/moba',name),path.join(f.directory,'server/moba',name));

 await cp(path.join(root,'client/platform'),path.join(f.directory,'client/platform'),{recursive:true});await cp(path.join(root,'client/audio'),path.join(f.directory,'client/audio'),{recursive:true});await mkdir(path.join(f.directory,'client/survival'));
 await cp(path.join(root,'client/web_shell.html'),path.join(f.directory,'client/web_shell.html'));await cp(path.join(root,'client/survival/balance.json'),path.join(f.directory,'client/survival/balance.json'));await cp(path.join(root,'client/fonts/IslandSans.ttf'),path.join(f.directory,'client/fonts/IslandSans.ttf'));await cp(path.join(root,'tools/icon.svg'),path.join(f.directory,'tools/icon.svg'));
 let finalize=await readFile(path.join(root,'tools/finalize_web.mjs'),'utf8');finalize=finalize.replace("import('../server/survival/config.mjs')",`import(${JSON.stringify(pathToFileURL(path.join(root,'server/survival/config.mjs')).href)})`);await writeFile(path.join(f.directory,'tools/finalize_web.mjs'),finalize);
 await mkdir(path.join(f.directory,'server/survival'));for(const name of ['combat-feedback.mjs','combat-moves.mjs','boss-combat.mjs','risk-progression.mjs','encounter-variety.mjs','host-session.mjs','room-runtime.mjs','world.mjs','mission-mode.mjs','fishing-experience.mjs','exploration.mjs','exploration-config.mjs','terrain-layout.mjs','portable-id.mjs','state-wire.mjs','director.mjs','director-combat.mjs','director-config.mjs','night-content-config.mjs','night-content.mjs','social-config.mjs','social-activities.mjs','day-content-config.mjs','day-content.mjs','tactical-content.mjs','social.mjs','enemy-aggro.mjs','enemy-navigation.mjs','gm-resources.mjs','member-progress.mjs','career-state.mjs','crafting.mjs','crafting-config.mjs','assembly-config.mjs','gear-growth.mjs','expedition.mjs','expedition-config.mjs'])await cp(path.join(root,'server/survival',name),path.join(f.directory,'server/survival',name));
 await writeFile(path.join(f.webRoot,'index.wasm'),'wasm');await writeFile(path.join(f.webRoot,'index.pck'),'fixture');await writeFile(path.join(f.webRoot,'index.js'),'// isolated engine placeholder');
 await writeFile(path.join(f.webRoot,'index.html'),'const GODOT_CONFIG = {"fileSizes":{"index.wasm":4,"index.pck":7}};');
 const child=spawn(process.execPath,[path.join(f.directory,'tools/finalize_web.mjs'),f.webRoot],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>output+=b);const deadline=setTimeout(()=>child.kill(),10000);const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});clearTimeout(deadline);assert.equal(exit,0,output);
 for(const name of ['classic.html','legacy.html']){const html=await readFile(path.join(f.webRoot,name),'utf8');assert.match(html,/url=\//);assert.match(html,/href="\/"/);assert(!/index\.js|startGame|GODOT_|OLD_ENGINE|--classic/.test(html));}
 assert.equal(await readFile(path.join(f.webRoot,'index.html'),'utf8'),await readFile(path.join(f.directory,'client/platform/index.html'),'utf8'));
 const play=await readFile(path.join(f.webRoot,'play.html'),'utf8');assert(play.includes('makeGameTransport'));assert(play.includes('location.replace("/")'));assert(!play.includes('--classic'));
 const moba=await readFile(path.join(f.webRoot,'moba-play.html'),'utf8');assert(moba.includes('makeMobaTransport'));assert(moba.includes('"--moba"'));assert(!play.includes('"--moba"'));for(const name of ['catalog.mjs','map.mjs','world.mjs'])assert.equal(await readFile(path.join(f.webRoot,'moba/sim',name),'utf8'),await readFile(path.join(root,'server/moba',name),'utf8'));
 for(const name of ['combat-feedback.mjs','combat-moves.mjs','boss-combat.mjs','host-session.mjs','room-runtime.mjs','world.mjs','mission-mode.mjs','fishing-experience.mjs','exploration.mjs','exploration-config.mjs','terrain-layout.mjs','portable-id.mjs','state-wire.mjs','director.mjs','director-combat.mjs','director-config.mjs','night-content-config.mjs','night-content.mjs','social-config.mjs','social-activities.mjs','day-content-config.mjs','day-content.mjs','tactical-content.mjs','social.mjs','enemy-aggro.mjs','enemy-navigation.mjs','gm-resources.mjs','member-progress.mjs','career-state.mjs','crafting.mjs','crafting-config.mjs','assembly-config.mjs','gear-growth.mjs','expedition.mjs','expedition-config.mjs'])assert.equal(await readFile(path.join(f.webRoot,'platform/sim',name),'utf8'),await readFile(path.join(root,'server/survival',name),'utf8'));
});
