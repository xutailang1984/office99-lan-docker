// Portable day-content definitions. Pools and daily material limits are finite.
export const DAY_EVENTS=[
 {id:'desk_stamp',zone:'salvage',name:'补签三连章',icon:'seal',goal:'按图依次盖三章',parts:3},
 {id:'desk_print',zone:'salvage',name:'打印机在思考',icon:'clock',goal:'启动打印，稍后回来拿',parts:1},
 {id:'supply_dial',zone:'hunt',name:'报销密码归零',icon:'folder',goal:'看标记，转对旋钮',parts:1},
 {id:'supply_cool',zone:'hunt',name:'电池先凉一会',icon:'shield',goal:'等冷却保全，强拆会响',parts:1},
 {id:'parcel_invoice',zone:'supply',name:'三箱两张真单',icon:'folder',goal:'跳过错单，找两件真货',parts:3},
 {id:'parcel_relay',zone:'supply',name:'团建搬运接力',icon:'carry',goal:'两箱送到绿框，可分工搬',parts:2}
];
export const DAY_FISH=[
 {id:'clip_crab',name:'回形蟹',hp:26,speed:1.7,damage:3,attack_range:1.3,attack_windup:.9,attack_cooldown:1.8,resistance:1.0,loot:'catch_shore',aggressive:true,tier:'minion',role:'clip',locomotion:'ground',rangeClass:'melee',aggro_range:4},
 {id:'receipt_ray',name:'小票鳐',hp:28,speed:1.5,damage:3,attack_range:1.8,attack_windup:1.0,attack_cooldown:2,resistance:1.0,loot:'catch_shore',aggressive:true,tier:'minion',role:'receipt',locomotion:'ground',rangeClass:'melee',aggro_range:4},
 {id:'staple_squid',name:'订书鱿',hp:30,speed:1.9,damage:2,attack_range:1.6,attack_windup:.7,attack_cooldown:1.3,resistance:1.15,loot:'catch_shore',aggressive:true,tier:'minion',role:'staple',locomotion:'ground',rangeClass:'melee',aggro_range:4},
 {id:'seal_puffer',name:'盖章河豚',hp:32,speed:1.1,damage:4,attack_range:2.2,attack_windup:1.2,attack_cooldown:2.5,resistance:1.1,loot:'catch_shore',aggressive:true,tier:'minion',role:'seal',locomotion:'ground',rangeClass:'melee',aggro_range:4}
];
export const FISH_PARTS={silverfish:'float_unit',spring_shrimp:'spool_unit',clip_crab:'trigger_unit',receipt_ray:'optic_unit',staple_squid:'spool_unit',seal_puffer:'seal_unit'};
export const FISH_REGIONS={salvage:['silverfish','clip_crab','spring_shrimp'],hunt:['receipt_ray','staple_squid','ink_cuttle'],supply:['seal_puffer','eel','crab']};
export const DAY_PROPS=[
 {id:'supply_locker',name:'返修储物柜',zone:'hunt',count:2,hp:65,material:'metal',size:{x:.85,y:1.75,z:.65},search_seconds:4,part:'barrel_unit'},
 {id:'cable_reel',name:'加班绕线盘',zone:'supply',count:2,hp:50,material:'metal',size:{x:1.3,y:.7,z:.85},search_seconds:3,part:'spool_unit'},
 {id:'punch_clock',name:'报废考勤机',zone:'salvage',count:2,hp:45,material:'metal',size:{x:.72,y:1.1,z:.5},search_seconds:3,part:'trigger_unit'},
 {id:'notice_board',name:'永不更新的公告板',zone:'salvage',count:2,hp:40,material:'wood',size:{x:1.8,y:1.35,z:.16},search_seconds:2.5,part:'optic_unit'}
];
export const DAY_SOLID_EVENTS=['desk_alarm','desk_sort','desk_stamp','desk_print','supply_dial','supply_cool'];
export const DAY_CRATE_EVENTS=['supply_seal','parcel_intact','parcel_rush','parcel_invoice'];
export function extendDayDefinitions(c){
 for(const def of DAY_FISH){if(!c.creatures.some(x=>x.id===def.id))c.creatures.push({...def});c.fishing.open_water.hp[def.id]=def.hp;}
 c.exploration.partLimitBase??=6;c.exploration.partLimitPerPlayer??=2;
 if(c.destructibles){
  for(const [id,count]of [['crate',6],['barrel',6],['barricade',2]]){const t=c.destructibles.types.find(x=>x.id===id);if(t)t.count=count;}
  for(const def of DAY_PROPS)if(!c.destructibles.types.some(x=>x.id===def.id))c.destructibles.types.push({...def,size:{...def.size}});
  c.destructibles.salvage=Object.fromEntries(DAY_PROPS.map(d=>[d.id,{name:d.name,seconds:d.search_seconds,part:d.part}]));
 }
 return c;
}
