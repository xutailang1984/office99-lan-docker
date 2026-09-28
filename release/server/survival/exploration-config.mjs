// Portable content definitions shared by Node and the browser host Worker.
export const EXPLORATION_ITEMS = [
 {id:'spring_parts',name:'弹簧组件',kind:'material',stack:10,deposit_m:2,sell_c:0},
 {id:'sealed_cell',name:'密封电芯',kind:'material',stack:3,deposit_m:4,sell_c:0},
 {id:'coffee_coupon',name:'咖啡券',kind:'loot',stack:5,sell_c:12},
 {id:'team_medal',name:'摸鱼奖章',kind:'loot',stack:1,sell_c:80}
];
export const EXPLORATION_CREATURES = [
 {id:'spring_shrimp',name:'弹簧虾',hp:24,speed:1.8,damage:3,attack_range:1.2,attack_windup:.85,attack_cooldown:1.6,resistance:.85,loot:'spring_parts',aggressive:true,tier:'minion',role:'spring',locomotion:'ground',rangeClass:'melee'},
 {id:'ink_cuttle',name:'墨盒乌贼',hp:30,speed:1.5,damage:3,attack_range:3.5,attack_windup:1.1,attack_cooldown:2.1,resistance:1.05,loot:'catch_shore',aggressive:true,tier:'minion',role:'ink',locomotion:'ground',rangeClass:'ranged'},
 {id:'manager_koi',name:'加班锦鲤',hp:220,speed:2,damage:10,attack_range:2,attack_windup:1.05,attack_cooldown:2.4,resistance:1.15,loot:'team_medal',aggressive:true,tier:'elite',role:'rare_fish',locomotion:'ground',rangeClass:'melee'}
];
export const EXPLORATION_EVENTS = [
 {id:'desk_alarm',zone:'salvage',name:'响铃抽屉',icon:'bell',goal:'拆铃慢开，或响铃多拿',parts:1},
 {id:'desk_sort',zone:'salvage',name:'错号文件',icon:'folder',goal:'看图找对抽屉',parts:3},
 {id:'supply_carry',zone:'hunt',name:'搬回补给',icon:'carry',goal:'抬到接收点，可放下作战',parts:1},
 {id:'supply_seal',zone:'hunt',name:'封条保全',icon:'seal',goal:'慢拆保全，快砸拿零件',parts:1},
 {id:'parcel_intact',zone:'supply',name:'完整回收',icon:'shield',goal:'护住快递，装好带走',parts:1},
 {id:'parcel_rush',zone:'supply',name:'速拆来件',icon:'clock',goal:'开箱计时，打碎三件快递',parts:3}
];
export function extendExplorationConfig(source) {
 const c=structuredClone(source);
 c.exploration={version:1,maxActive:3,maxRare:1,rareAfterCatches:3,rareLeash:12,rareIdleSeconds:25,carrySpeed:.58,rushSeconds:25,...c.exploration};
 for(const d of EXPLORATION_ITEMS)if(!c.items.some(x=>x.id===d.id))c.items.push({...d});
 for(const d of EXPLORATION_CREATURES)if(!c.creatures.some(x=>x.id===d.id))c.creatures.push({...d});
 for(const d of c.creatures)if(EXPLORATION_CREATURES.some(x=>x.id===d.id))d.aggro_range??=d.id==='manager_koi'?8:4;
 Object.assign(c.fishing.open_water.hp,{spring_shrimp:24,ink_cuttle:30,manager_koi:220});
 const magnet=c.rods.find(x=>x.id==='rod_magnet');
 if(magnet&&!magnet.loot_table.some(x=>x.definitionId==='sealed_cell'))magnet.loot_table.push({definitionId:'sealed_cell',quantity:1,resistance:1.05,weight:8});
 for(const zone of c.encounters.danger_zones)if(zone.id==='supply')zone.label='快递堆放区';
 if(c.exploration.version!==1||c.exploration.maxActive!==3||c.exploration.maxRare!==1||['rareAfterCatches','rareLeash','rareIdleSeconds','carrySpeed','rushSeconds'].some(k=>!Number.isFinite(c.exploration[k])||c.exploration[k]<=0)||c.exploration.rareLeash>16||c.exploration.rareLeash<6||c.exploration.carrySpeed>=1||c.exploration.rushSeconds>60||c.exploration.rareIdleSeconds>60)throw Error('Invalid exploration envelope');
 return c;
}
