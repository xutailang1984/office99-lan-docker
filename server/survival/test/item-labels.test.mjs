import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SurvivalWorld} from '../world.mjs';

const config=JSON.parse(readFileSync(new URL('../../../client/survival/balance.json',import.meta.url),'utf8'));

test('every displayable definition has a readable name and mission displays expose it',()=>{
  for(const category of ['items','creatures','buildings']){
    const unnamed=config[category].filter(entry=>typeof entry.name!=='string'||!entry.name.trim());
    assert.deepEqual(unnamed.map(entry=>entry.id),[],`${category} names are required by visible UI`);
  }
  const names=new Map(config.items.map(item=>[item.id,item.name]));
  const world=new SurvivalWorld(structuredClone(config),null,{onlineRoster:true,mode:'mission',missionStart:'free'});
  const displays=world.staticWorld().terminals.filter(terminal=>terminal.type==='training');
  assert.equal(displays.length,14);
  for(const display of displays){
    assert.equal(display.label,names.get(display.definitionId),display.id);
    assert(!/^(null|undefined)$/i.test(display.label),display.id);
  }
});
