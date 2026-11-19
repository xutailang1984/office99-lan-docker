// P4 content replaces existing night slots. It does not change encounter budgets.
const boss=(id,name,extra={})=>({id,name,role:'boss',tier:'boss',locomotion:'ground',rangeClass:'mixed',hp:1200,speed:2.35,damage:24,attack_range:7,attack_windup:1.5,attack_cooldown:2,aggro_range:8,collision_radius:1.1,navigation_radius:1.1,hit_height:1.15,armor_multiplier:.35,weak_multiplier:2,resistance:0,aggressive:true,loot:null,...extra});
export const NIGHT_CONTENT_CREATURES=[
 boss('boss_shredder','暴走碎纸机',{weak_side:'side',speed:2.45}),
 boss('boss_printer','堵塞打印机',{weak_side:'back',speed:2.1,collision_radius:1.05,navigation_radius:1.05}),
 boss('boss_stamp_press','打卡冲压机',{weak_side:'side',speed:2.1}),
 boss('boss_coffee_boiler','暴走咖啡炉',{weak_side:'front',speed:1.9}),
 {id:'eraser_cart',name:'橡皮清扫车',role:'eraser',tier:'minion',locomotion:'ground',rangeClass:'melee',hp:50,speed:2.5,damage:7,attack_range:1.6,attack_windup:1.4,attack_cooldown:2,aggro_range:12,collision_radius:.6,hit_height:.85,resistance:1,aggressive:true,loot:'catch_crab'},
 {id:'battery_mite',name:'吃电虫',role:'battery',tier:'minion',locomotion:'ground',rangeClass:'melee',hp:46,speed:2.6,damage:7,attack_range:1.6,attack_windup:1.4,attack_cooldown:2,aggro_range:12,collision_radius:.6,hit_height:.8,resistance:1,aggressive:true,loot:'catch_crab'},
 {id:'broadcast_cart',name:'催单广播机',role:'rally',tier:'minion',locomotion:'ground',rangeClass:'melee',hp:58,speed:2.3,damage:5,attack_range:1.5,attack_windup:1,attack_cooldown:2.2,aggro_range:12,collision_radius:.6,hit_height:.85,resistance:1,aggressive:true,loot:'catch_crab'},
 {id:'paper_lobber',name:'卷纸投手',role:'lobber',tier:'minion',locomotion:'ground',rangeClass:'ranged',hp:52,speed:2.2,damage:9,attack_range:10,attack_windup:1.4,attack_cooldown:3.2,aggro_range:14,collision_radius:.6,hit_height:.9,resistance:1,aggressive:true,loot:'catch_crab'},
];
export const NIGHT_CONTENT_PLANS=[
 {id:'stamp_cleanup',name:'三连打卡',entries:[0,1,2],roles:['eraser_cart','crab','paper_drone'],boss:'base',bossDefinitionId:'boss_stamp_press'},
 {id:'stamp_overtime',name:'打卡加班',entries:[2,0,2],roles:['battery_mite','paper_lobber','crab'],boss:'base',bossDefinitionId:'boss_stamp_press'},
 {id:'coffee_break',name:'咖啡过载',entries:[0,2,1],roles:['battery_mite','crab','breaker'],boss:'base',bossDefinitionId:'boss_coffee_boiler'},
 {id:'coffee_cleanup',name:'清理茶水间',entries:[1,1,2],roles:['eraser_cart','paper_lobber','crab'],boss:'base',bossDefinitionId:'boss_coffee_boiler'},
 {id:'shredder_lane',name:'碎纸机开路',entries:[0,0,1],roles:['breaker','crab','paper_lobber'],boss:'base',bossDefinitionId:'boss_shredder'},
 {id:'shredder_dispatch',name:'广播催单',entries:[1,2,1],roles:['broadcast_cart','crab','paper_drone'],boss:'base',bossDefinitionId:'boss_shredder'},
 {id:'shredder_guard',name:'护柜碎纸',entries:[0,2,0,2],roles:['shield_bug','paper_lobber','crab'],boss:'base',bossDefinitionId:'boss_shredder'},
 {id:'printer_rolls',name:'卷纸加班',entries:[0,1,2],roles:['paper_lobber','crab','paper_drone'],boss:'base',bossDefinitionId:'boss_printer'},
 {id:'printer_rework',name:'卡纸返工',entries:[1,1,2],roles:['medic_bug','breaker','crab'],boss:'base',bossDefinitionId:'boss_printer'},
 {id:'printer_dispatch',name:'打印催单',entries:[2,0,2],roles:['broadcast_cart','paper_lobber','crab'],boss:'base',bossDefinitionId:'boss_printer'},
];
export const NIGHT_CONTENT_DEFAULTS={
 stamp:{windup:1.4,radius:1.6,damage:18,buildingDamage:55,weakSeconds:4.5,recoverSeconds:2,range:8},
 coffee:{windup:1.7,radius:7,innerRadius:2.2,length:9,width:2.5,damage:22,buildingDamage:60,weakSeconds:4.5,recoverSeconds:2},
 shredder:{fanWindup:1.45,fanRadius:6,fanHalfAngle:.72,fanDamage:22,fanBuildingDamage:60,advanceWindup:1.6,advanceRange:6,advanceSpeed:7,advanceDamage:24,advanceBuildingDamage:70,weakSeconds:4,recoverSeconds:1.7,motorThreshold:45},
 printer:{waveWindup:1.6,waveLength:9,waveWidth:3.4,waveDamage:23,waveBuildingDamage:65,shiftWindup:1.1,shiftRange:2.6,shiftSpeed:3.6,weakSeconds:4.5,recoverSeconds:1.8},
 rally:{radius:5,windup:1.15,cooldown:6,duration:3,speedMultiplier:1.2,maxAllies:2},
 lobber:{radius:1.45,buildingDamage:16},
};
const bossIds=new Set(['boss_crab','boss_shredder','boss_printer','boss_stamp_press','boss_coffee_boiler']);
export function isBoss(entity){return !!entity&&(entity.tier==='boss'||bossIds.has(typeof entity==='string'?entity:entity.definitionId??entity.id));}
export function buildNightPlans(basePlans){
 // The old relay paired a slow projectile with both charging species.
 // Keep its route and boss, but reserve only one charging role in that plan.
 const retained=structuredClone(basePlans.filter(p=>!NIGHT_CONTENT_PLANS.some(n=>n.id===p.id)));
 for(const plan of retained)if(plan.id==='relay'&&plan.roles.includes('jammer')&&plan.roles.includes('courier')&&plan.roles.includes('stamp_bat'))plan.roles=plan.roles.map(id=>id==='stamp_bat'?'crab':id);
 return [...retained,...structuredClone(NIGHT_CONTENT_PLANS)];
}
export function extendNightContentConfig(source){
 const c=structuredClone(source);c.director??={};
 for(const def of NIGHT_CONTENT_CREATURES)if(!c.creatures.some(old=>old.id===def.id))c.creatures.push(structuredClone(def));
 c.director.nightContent=Object.fromEntries(Object.entries(NIGHT_CONTENT_DEFAULTS).map(([id,def])=>[id,{...def,...c.director.nightContent?.[id]}]));
 c.director.nightPlans=buildNightPlans(c.director.nightPlans??[]);
 validateNightContentConfig(c);return c;
}
export function validateNightContentConfig(c){
 const n=c.director?.nightContent,positive=x=>Number.isFinite(x)&&x>0;
 if(!n||Object.keys(NIGHT_CONTENT_DEFAULTS).some(id=>!n[id]||Object.values(n[id]).some(v=>!positive(v))))throw Error('Invalid night content values');
 if(n.shredder.fanHalfAngle>=Math.PI/2||n.printer.waveWidth>6||n.printer.shiftRange>4||n.rally.speedMultiplier>1.25||n.rally.duration>4||n.rally.maxAllies!==2)throw Error('Invalid night content bounds');
 for(const def of NIGHT_CONTENT_CREATURES){const current=c.creatures.find(d=>d.id===def.id);if(!current||['hp','speed','damage','attack_range','attack_windup','attack_cooldown','collision_radius','hit_height'].some(k=>!positive(current[k])))throw Error('Invalid night creature');}
 for(const plan of c.director.nightPlans){
  if(plan.bossDefinitionId&&!c.creatures.some(d=>d.id===plan.bossDefinitionId&&isBoss(d)))throw Error('Invalid night boss reference');
  const roles=plan.roles??[],count=id=>roles.filter(r=>r===id).length;
  if(roles.some(id=>!c.creatures.some(d=>d.id===id))||count('shield_bug')&&count('medic_bug')||count('jammer')+count('spore_slug')>1||count('jammer')+count('spore_slug')>0&&count('courier')+count('stamp_bat')>1||count('broadcast_cart')>1||count('broadcast_cart')&&count('medic_bug'))throw Error('Invalid night role combination');
 }
}
