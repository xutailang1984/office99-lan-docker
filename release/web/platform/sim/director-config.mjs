// Portable data: imported by Node and the host browser Worker, no filesystem APIs.
export const PHASE_ROWS = [
  {players:1, PREP:60, DAY:240, RETURN:45, NIGHT:180},
  {players:2, PREP:45, DAY:180, RETURN:45, NIGHT:180},
  {players:4, PREP:30, DAY:135, RETURN:45, NIGHT:180},
  {players:8, PREP:20, DAY:105, RETURN:45, NIGHT:180},
];
export const PERKS = [
  {id:'precision',name:'精准签批',description:'命中弱点时伤害提高20%',effect:'weak_damage',value:1.2},
  {id:'scavenger',name:'废料慧眼',description:'每处搜索点额外找到2份零件原料',effect:'search_scrap',value:2},
  {id:'medic',name:'急救能手',description:'每次绷带额外恢复10点生命',effect:'bandage_heal',value:10},
  {id:'quick_reload',name:'补钉熟手',description:'装填时间缩短15%，弹药消耗不变',effect:'reload_duration',value:.85},
  {id:'endurance',name:'跑腿健将',description:'冲刺耐力消耗减少20%',effect:'sprint_drain',value:.8},
  {id:'brawler',name:'拆包达人',description:'刀和拳的伤害提高20%',effect:'melee_damage',value:1.2},
  {id:'angler',name:'顺线高手',description:'收线时张力增长减少15%',effect:'tension_rise',value:.85},
  {id:'pockets',name:'工具腰包',description:'本次冒险背包永久增加2格',effect:'backpack_slots',value:2},
];
export const OBJECTIVES = [
  {id:'cleanup',name:'清理旧工位',verb:'search',zone:'salvage',base:2,perPlayer:.5},
  {id:'lost_files',name:'找回文件',verb:'treasure',zone:'supply',base:1,perPlayer:.25},
  {id:'courier_cache',name:'回收快递',verb:'break',zone:null,base:2,perPlayer:.5},
  {id:'quiet_patrol',name:'静默巡检',verb:'quiet_search',zone:null,base:2,perPlayer:.25,quietSeconds:8},
  {id:'paired_nodes',name:'双点配合',verb:'zones',zone:null,base:2,perPlayer:0},
  {id:'priority_supply',name:'优先补给',verb:'deposit',zone:null,base:10,perPlayer:2},
  {id:'fishing_break',name:'午休钓鱼',verb:'fish',zone:null,base:1,perPlayer:.25},
  {id:'risk_order',name:'风险加单',verb:'kill',zone:null,base:2,perPlayer:.5},
];
export const NIGHT_PLANS = [
  {id:'north_pressure',name:'北门集中催单',entries:[0,0,1],roles:['breaker','shield_bug','crab'],boss:'base'},
  {id:'pincer',name:'双线夹击',entries:[0,2,0,2],roles:['courier','paper_drone','crab'],boss:'auditor'},
  {id:'relay',name:'轮转来件',entries:[0,1,2],roles:['jammer','courier','stamp_bat'],boss:'overload'},
  {id:'covered',name:'护档推进',entries:[1,1,2],roles:['shield_bug','archive_guard','eel','crab'],boss:'auditor'},
  {id:'rush',name:'急件加塞',entries:[2,0,2],roles:['stamp_bat','spore_slug','crab'],boss:'overload'},
  {id:'repair_line',name:'返工流水线',entries:[0,2,1],roles:['medic_bug','breaker','crab'],boss:'base'},
];
const ordinary = (id,name,role,archetype,hp,speed,damage,extra={}) => ({id,name,role,archetype,hp,speed,damage,attack_range:1.5,attack_windup:.8,attack_cooldown:1.7,aggro_range:16,loot:'catch_crab',resistance:1,aggressive:true,...extra});
export const CREATURES = [
  ordinary('courier','催单快递怪','courier','crab',50,3.3,9,{attack_range:6,attack_windup:1,dash_speed:9,dash_distance:6,attack_cooldown:2}),
  ordinary('shield_bug','护档柜','shield','crab',80,2.2,10,{front_multiplier:.3,attack_windup:1}),
  ordinary('jammer','信号干扰器','jammer','eel',65,2.7,6,{attack_range:12,attack_windup:1.1,attack_cooldown:2.8,projectile_speed:8,projectile_radius:.2,slow_seconds:1.5,loot:'catch_eel'}),
  ordinary('medic_bug','返工维修虫','medic','eel',55,2.5,5,{heal_range:7,heal_amount:8,heal_windup:1.2,heal_cooldown:4,attack_cooldown:2.5,loot:'catch_eel'}),
  ordinary('breaker','拆墙鼹鼠','breaker','crab',75,2.2,8,{building_damage:24,attack_range:2.2,attack_windup:1.3,attack_cooldown:2}),
  ordinary('spore_slug','便签黏怪','spore','crab',55,2.5,7,{attack_range:4,attack_windup:1.1,attack_cooldown:3,zone_radius:2,zone_seconds:4}),
  ordinary('bubble_puffer','气泡河豚','puffer','silverfish',24,1.6,3,{attack_range:2.2,attack_windup:1.1,attack_cooldown:2,aggro_range:4,loot:'catch_shore',resistance:1.1}),
  ordinary('lantern_fish','台灯鱼','lantern','silverfish',26,1.7,3,{attack_range:3,attack_windup:1,attack_cooldown:2.5,aggro_range:4,loot:'catch_shore',resistance:1.15}),
  ordinary('paper_drone','巡信纸鸢','drone','eel',42,2.8,6,{locomotion:'air',hover_height:1.15,attack_range:11,attack_windup:.9,attack_cooldown:2.4,projectile_speed:8,projectile_radius:.14,loot:'catch_eel'}),
  ordinary('stamp_bat','盖章飞蝠','swooper','crab',44,2.9,7,{locomotion:'air',hover_height:1.05,attack_range:3.6,attack_windup:1,dash_speed:6,dash_distance:3.6,attack_cooldown:2.2}),
  ordinary('archive_guard','归档机甲','artillery','crab',110,1.9,4,{tier:'elite',attack_range:12,attack_windup:1.3,attack_cooldown:3,projectile_speed:7,projectile_radius:.18,loot:'treasure'}),
];
export const TOOL_ITEMS = [
  {id:'decoy_alarm',name:'诱敌闹钟',kind:'tool',stack:3,buy_c:25,buy_m:0,buy_quantity:1,description:'投在可见地面，吸引附近普通敌人8秒'},
  {id:'repair_kit',name:'应急维修包',kind:'tool',stack:3,buy_c:40,buy_m:4,buy_quantity:1,description:'近距离立刻修复存活建筑120耐久；不能重建废墟'},
  {id:'coffee_flask',name:'咖啡保温杯',kind:'tool',stack:3,buy_c:25,buy_m:0,buy_quantity:1,description:'恢复40耐力；满耐力时不消耗'},
  {id:'flash_note',name:'闪光便签',kind:'tool',stack:3,buy_c:35,buy_m:2,buy_quantity:1,description:'投在可见地面，使4米内普通敌人眩晕1秒；首领免疫'},
];
export const DIRECTOR_DEFAULTS = {
  version:1,enabled:true,phaseRows:PHASE_ROWS,historySeconds:1800,
  objectives:OBJECTIVES,nightPlans:NIGHT_PLANS,perks:PERKS,
  budgets:{maxDeployables:16,maxEnemyZones:8,maxProjectiles:64,maxDecoysPerPlayer:1},
  tools:{decoy_alarm:{range:10,radius:14,duration:8,cooldown:8},repair_kit:{range:2.5,heal:120,cooldown:5},coffee_flask:{stamina:40,cooldown:20},flash_note:{range:8,radius:4,duration:1,cooldown:20}},
  fishVariants:{weight:10,ids:['bubble_puffer','lantern_fish']},
  bosses:{auditor:{windup:1.4,range:9,halfAngle:.46,damage:22,buildingDamage:60,weakSeconds:4,stampWindup:1.6,stampRadius:1.8,stampDamage:16,stampBuildingDamage:50,stampRange:12},overload:{windup:1.6,outerRadius:7,innerRadius:2.5,damage:25,buildingDamage:70,weakSeconds:4,burstWindup:1.5,burstSpeed:6,burstDamage:8}},
};

export function extendDirectorConfig(source) {
  const c=structuredClone(source);
  const provided=c.director??{},defaults=structuredClone(DIRECTOR_DEFAULTS);
  c.director={...defaults,...provided,budgets:{...defaults.budgets,...provided.budgets},tools:Object.fromEntries(Object.entries(defaults.tools).map(([id,def])=>[id,{...def,...provided.tools?.[id]}])),fishVariants:{...defaults.fishVariants,...provided.fishVariants},bosses:{auditor:{...defaults.bosses.auditor,...provided.bosses?.auditor},overload:{...defaults.bosses.overload,...provided.bosses?.overload}}};
  if(c.director.enabled===false)return c;
  for(const def of CREATURES)if(!c.creatures.some(x=>x.id===def.id))c.creatures.push(structuredClone(def));
  for(const def of c.creatures){
    def.tier??=def.id==='boss_crab'?'boss':['shield_bug','breaker','archive_guard'].includes(def.id)?'elite':'minion';
    def.locomotion??='ground';
    def.rangeClass??=def.id==='boss_crab'?'mixed':['eel','jammer','paper_drone','archive_guard'].includes(def.id)?'ranged':'melee';
  }
  for(const def of TOOL_ITEMS)if(!c.items.some(x=>x.id===def.id))c.items.push(structuredClone(def));
  c.fishing.open_water.hp={bubble_puffer:24,lantern_fish:26,...c.fishing.open_water.hp};
  validateDirectorConfig(c);
  return c;
}
export function validateDirectorConfig(c) {
  const d=c.director;
  if(!d||d.enabled===false)return;
  const positive=x=>Number.isFinite(x)&&x>0;
  if(!Array.isArray(d.phaseRows)||d.phaseRows.length!==4||d.phaseRows.some((r,i)=>r.players!==[1,2,4,8][i]||['PREP','DAY','RETURN','NIGHT'].some(k=>!positive(r[k]))))throw Error('Invalid director phase rows');
  for(const key of ['objectives','nightPlans','perks'])if(!Array.isArray(d[key])||!d[key].length||new Set(d[key].map(x=>x.id)).size!==d[key].length)throw Error('Invalid director '+key);
  if(d.perks.length!==8||!positive(d.historySeconds)||d.historySeconds>7200||Object.values(d.budgets).some(v=>!Number.isInteger(v)||v<1)||d.budgets.maxEnemyZones>8||d.budgets.maxDeployables>16||d.budgets.maxProjectiles>64)throw Error('Invalid director budgets');
  if(d.nightPlans.some(p=>!p.entries?.length||p.entries.some(i=>![0,1,2].includes(i))||!p.roles?.length||p.roles.some(id=>!c.creatures.some(x=>x.id===id))||!['base','auditor','overload'].includes(p.boss)))throw Error('Invalid night plan');
  if(d.objectives.some(o=>!positive(o.base)||!Number.isFinite(o.perPlayer)||o.perPlayer<0||!['search','treasure','break','quiet_search','zones','deposit','fish','kill'].includes(o.verb)))throw Error('Invalid objective');
  for(const [id,def] of Object.entries(d.tools))if(!c.items.some(x=>x.id===id&&x.kind==='tool')||Object.values(def).some(v=>!positive(v)))throw Error('Invalid active tool');
  if(d.perks.some(p=>!PERKS.some(def=>def.id===p.id&&def.effect===p.effect)||!positive(p.value))||d.perks.find(p=>p.id==='pockets').value!==2)throw Error('Invalid director perks');
  if(!Number.isFinite(d.fishVariants.weight)||d.fishVariants.weight<0||d.fishVariants.weight>100||!Array.isArray(d.fishVariants.ids)||!d.fishVariants.ids.length||d.fishVariants.ids.some(id=>!['bubble_puffer','lantern_fish'].includes(id)))throw Error('Invalid director fishing variants');
  for(const id of ['auditor','overload'])if(Object.values(d.bosses[id]).some(x=>!positive(x)))throw Error('Invalid director boss');
  if(d.bosses.auditor.halfAngle>=Math.PI||d.bosses.overload.innerRadius>=d.bosses.overload.outerRadius)throw Error('Invalid director boss geometry');
  for(const def of CREATURES){const current=c.creatures.find(x=>x.id===def.id);if(!current||['hp','speed','damage','attack_range','attack_windup','attack_cooldown'].some(k=>!positive(current[k])))throw Error('Invalid director creature');}
  for(const def of c.creatures)if(!['minion','elite','boss'].includes(def.tier)||!['ground','air'].includes(def.locomotion)||!['melee','ranged','mixed'].includes(def.rangeClass)||(def.locomotion==='air'&&(!positive(def.hover_height)||def.hover_height>1.5)))throw Error('Invalid creature classification');
}
