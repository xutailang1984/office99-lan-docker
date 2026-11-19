import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {copyReadable} from './readable-copy.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const output = path.resolve(process.argv[2] || path.join(root, 'web'));
const generated = await readFile(path.join(output, 'index.html'), 'utf8');
let configMatch = generated.match(/const GODOT_CONFIG = (\{[^\n]+\});/);
if(!configMatch){try{const previous=await readFile(path.join(output,'play.html'),'utf8');configMatch=previous.match(/^const config=(\{[^\n]+\});/m);}catch{}}
if (!configMatch) throw new Error('Godot generated shell did not contain its engine configuration');
const config = JSON.parse(configMatch[1]);
for (const name of ['index.wasm', 'index.pck']) {
  if (config.fileSizes[name] !== (await stat(path.join(output, name))).size) throw new Error('Export size mismatch');
}
const source = await readFile(path.join(root, 'client', 'web_shell.html'), 'utf8');
const html = source.replace('$GODOT_HEAD_INCLUDE', '<link rel="icon" type="image/svg+xml" href="icon.svg">')
  .replace('$GODOT_URL', 'index.js').replace('$GODOT_CONFIG', JSON.stringify(config))
  .replace('<title>方岛渔友 · 一起钓个好天气</title>', '<title>办公室的99夜</title>')
  .replace('ISLAND DAYS · CO-OP FISHING', 'OFFICE / 99N · CO-OP SURVIVAL')
  .replace('<h1>方岛渔友</h1>', '<h1>办公室的99夜</h1>')
  .replace('海风已到，等你抛竿。', '午休钓鱼，工位寻宝。和同事一起守灯。');
if (html.includes('$GODOT_') || !html.includes('startGame(')) throw new Error('Incomplete HTML shell');
await writeFile(path.join(output, 'index.html'), html);
await writeFile(path.join(output, 'icon.svg'), await readFile(path.join(root, 'tools', 'icon.svg')));
const verified = await readFile(path.join(output, 'index.html'), 'utf8');
if (verified !== html) throw new Error('HTML readback mismatch');
// Old bookmarks remain redirects, never playable Godot entry points.
const retired='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/"><title>打开最新大厅</title><a href="/">进入最新大厅</a></html>';
for(const name of ['classic.html','legacy.html'])await writeFile(path.join(output,name),retired);
// The lobby remains small; Godot is loaded only after the room owner starts.
const bridge='<script>if(window.parent===window||typeof window.parent.makeGameTransport!=="function"){location.replace("/");}else{window.tidalTransport=window.parent.makeGameTransport(window);}for(const event of ["error","unhandledrejection"])window.addEventListener(event,()=>window.tidalTransport?.loading?.({phase:"error"}));</script>';
await writeFile(path.join(output,'play.html'),html.replace('<script src="index.js">',bridge+'<script src="index.js">'));
// A dedicated scene/transport keeps PVP input and inventories out of PVE.
const mobaBridge='<script>if(window.parent===window||typeof window.parent.makeMobaTransport!=="function"){location.replace("/");}else{window.mobaTransport=window.parent.makeMobaTransport(window,new URLSearchParams(location.search).get("renderer"));}window.addEventListener("contextmenu",e=>e.preventDefault());for(const event of ["error","unhandledrejection"])window.addEventListener(event,()=>window.mobaTransport?.loading?.({phase:"error"}));</script>';
const mobaHtml=html.replaceAll('window.tidalTransport','window.mobaTransport').replace('<script src="index.js">',mobaBridge+'<script src="index.js">').replace('const engine=new Engine(config);','config.args=[...(config.args||[]),"--","--moba"];const engine=new Engine(config);').replace('engineExited=true;resolveEngineExit(code);','engineExited=true;window.mobaEngineExit={code};resolveEngineExit(code);');
await writeFile(path.join(output,'moba-play.html'),mobaHtml);
await copyReadable(path.join(root,'client','moba-web'),path.join(output,'moba'),{recursive:true});
await mkdir(path.join(output,'moba','sim'),{recursive:true});
for(const name of ['catalog.mjs','map.mjs','world.mjs','wire.mjs'])await copyReadable(path.join(root,'server','moba',name),path.join(output,'moba','sim',name));
await mkdir(path.join(output,'platform','sim'),{recursive:true});
await copyReadable(path.join(root,'client','platform'),path.join(output,'platform'),{recursive:true});
await copyReadable(path.join(root,'client','audio'),path.join(output,'audio'),{recursive:true});
for(const name of ['host-session.mjs','room-runtime.mjs','world.mjs','mission-mode.mjs','fishing-experience.mjs','exploration.mjs','exploration-config.mjs','crafting.mjs','crafting-config.mjs','gear-growth.mjs','expedition.mjs','expedition-config.mjs','career-state.mjs','terrain-layout.mjs','portable-id.mjs','state-wire.mjs','director.mjs','director-combat.mjs','director-config.mjs','night-content-config.mjs','night-content.mjs','social-config.mjs','social.mjs','social-activities.mjs','enemy-aggro.mjs','enemy-navigation.mjs','gm-resources.mjs','member-progress.mjs'])await copyReadable(path.join(root,'server','survival',name),path.join(output,'platform','sim',name));
for(const name of ['risk-progression.mjs','encounter-variety.mjs','assembly-config.mjs','day-content-config.mjs','day-content.mjs','tactical-content.mjs','combat-feedback.mjs','combat-moves.mjs','boss-combat.mjs'])await copyReadable(path.join(root,'server','survival',name),path.join(output,'platform','sim',name));
const {loadConfig}=await import('../server/survival/config.mjs');
await writeFile(path.join(output,'platform','balance.json'),JSON.stringify(await loadConfig(path.join(root,'client','survival','balance.json'))));
await copyReadable(path.join(root,'client','fonts','IslandSans.ttf'),path.join(output,'platform','IslandSans.ttf'));
await writeFile(path.join(output,'index.html'),await readFile(path.join(root,'client','platform','index.html'),'utf8'));
if(!(await readFile(path.join(output,'play.html'),'utf8')).includes('makeGameTransport'))throw Error('Missing room transport bridge');
const audioManifest=JSON.parse(await readFile(path.join(output,'audio','sfx','manifest.json'),'utf8'));
if(!audioManifest.cues?.pistol?.near?.length||!(await stat(path.join(output,'audio','sfx',audioManifest.cues.pistol.near[0]))).isFile())throw Error('Missing browser audio sidecar');
for(const name of ['classic.html','legacy.html'])if(await readFile(path.join(output,name),'utf8')!==retired)throw Error('Retired redirect readback mismatch');
console.log('Latest lobby, room worker, game bridge, shared audio and retired redirects verified.');
