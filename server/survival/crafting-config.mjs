// Physical materials are carried loot. Currency and team building parts are
// separate wallets; no recipe silently spends either one.
import {ASSEMBLY_PARTS,PART_SOURCES,NEW_GEAR_ITEMS,NEW_WEAPONS,NEW_RODS,ASSEMBLY_RECIPES,ASSEMBLY_MODULES,ASSEMBLY_ATTACHMENTS,assemblyRod} from './assembly-config.mjs';
import {RISK_ITEMS,RISK_SOURCES,riskRecipe,riskCost} from './risk-progression.mjs';
export const CRAFTING_MATERIALS=['scrap','spring_parts','sealed_cell',...ASSEMBLY_PARTS.map(p=>p.id),...RISK_ITEMS.map(p=>p.id)];
const cost=(scrap,spring_parts,sealed_cell=0)=>Object.entries({scrap,spring_parts,sealed_cell}).filter(([,quantity])=>quantity>0).map(([definitionId,quantity])=>({definitionId,quantity}));
export const CRAFTING_RECIPES=[
 {id:'shotgun',definitionId:'shotgun',name:'回形针霰弹枪',description:'近距散射 · 逐发装填',ingredients:[{definitionId:'scrap',quantity:8},{definitionId:'spring_parts',quantity:4},{definitionId:'sealed_cell',quantity:1}]},
 {id:'rod_pro',definitionId:'rod_pro',name:'远投鱼竿',description:'远投找鱼 · 横移顺线',ingredients:cost(6,2,1)},
 {id:'carbine',definitionId:'carbine',name:'订书突击步枪',description:'中程稳定 · 按住连射',ingredients:cost(6,2,1)},
 {id:'rifle',definitionId:'rifle',name:'签字笔狙击枪',description:'远距瞄准 · 逐发拉栓',ingredients:cost(10,4,2)},
 {id:'pistol',definitionId:'pistol',name:'订书手枪',description:'单击重击 · 装填快',ingredients:cost(4,1)},
 {id:'smg',definitionId:'smg',name:'图钉冲锋枪',description:'近距快射 · 腰射灵活',ingredients:cost(7,4,1)},
 {id:'lmg',definitionId:'lmg',name:'装订轻机枪',description:'站稳压制 · 装填慢',ingredients:cost(10,5,2)},
 {id:'rod_basic',definitionId:'rod_basic',name:'午休鱼竿',description:'轻松入门 · 看到咬钩再提竿',ingredients:cost(3,1)},
 {id:'rod_light',definitionId:'rod_light',name:'轻快鱼竿',description:'短拉短停 · 近岸快钓',ingredients:cost(4,3)},
 {id:'rod_heavy',definitionId:'rod_heavy',name:'重载鱼竿',description:'冲刺松线 · 疲劳快拉',ingredients:cost(7,3,1)},
 {id:'rod_magnet',definitionId:'rod_magnet',name:'磁吸打捞竿',description:'打捞物资 · 横移解卡',ingredients:cost(6,2,2)},
 ...ASSEMBLY_RECIPES
].map(row=>riskRecipe(row));
export const CRAFTING_MODULES=[
 {id:'shotgun_stop',definitionId:'shotgun',name:'止步机匣',description:'近距多弹命中，打断小怪；首领免控',ingredients:[{definitionId:'scrap',quantity:6},{definitionId:'spring_parts',quantity:5},{definitionId:'sealed_cell',quantity:1}]},
 {id:'rod_rebound',definitionId:'rod_pro',name:'回弹卷轴',description:'顺线横移，松线蓄能，再收线快拉',ingredients:cost(4,3,2)},
 {id:'carbine_burst',definitionId:'carbine',name:'三连机匣',description:'按住打三连，连发后停顿',tradeoff:'瞬间集中，持续射速较慢',ingredients:cost(4,3,1)},
 {id:'rifle_focus',definitionId:'rifle',name:'专注镜组',description:'站稳瞄准一秒，子弹穿过首个小怪',tradeoff:'最多再击中一怪，不穿墙或首领',ingredients:cost(6,2,2)},
 {id:'pistol_chain',definitionId:'pistol',name:'续签机匣',description:'击倒敌人，从背包补入两发',tradeoff:'需要备用弹药，不能凭空造弹',ingredients:cost(3,2,1)},
 {id:'smg_mobile',definitionId:'smg',name:'走装弹匣',description:'停火走动，边走边装入备用子弹',tradeoff:'每走三米补一发，停步或开火重计',ingredients:cost(4,4,1)},
 {id:'lmg_suppress',definitionId:'lmg',name:'压阵枪管',description:'连中同一小怪四发，让它短暂减速',tradeoff:'换目标重计，首领不减速',ingredients:cost(6,3,2)},
 {id:'rod_autohook',definitionId:'rod_basic',name:'铃铛浮漂',description:'咬钩自动提竿，收线稍慢',tradeoff:'适合看风景，收线慢一成',ingredients:cost(2,2,1)},
 {id:'rod_rhythm',definitionId:'rod_light',name:'节拍摇柄',description:'短拉、松线、再短拉，抓准节拍快收',tradeoff:'一直按住不会加速',ingredients:cost(3,3,1)},
 {id:'rod_anchor',definitionId:'rod_heavy',name:'驻足支架',description:'站稳松线顶住冲刺，鱼累时快拉',tradeoff:'移动会打断蓄力',ingredients:cost(4,3,2)},
 {id:'rod_winch',definitionId:'rod_magnet',name:'脱困棘轮',description:'卡住时松线半秒，再收线就能解卡',tradeoff:'一直硬拉不会解卡',ingredients:cost(4,2,2)},
 ...ASSEMBLY_MODULES
].map(row=>riskRecipe(row,true));
export const MODULE_BY_ID=Object.fromEntries(CRAFTING_MODULES.map(module=>[module.id,module]));
export const GEAR_REFUND_RATE=.5;
export const CRAFTING_SOURCES={scrap:'拆箱、搜索',spring_parts:'各区搜索、弹簧虾、抽屉',sealed_cell:'宝盒、错号文件、磁吸打捞；中高风险搜索与交付',...PART_SOURCES,...RISK_SOURCES};
export function extendCraftingConfig(source){
 const c=source;
 for(const [key,rows]of [['items',[...ASSEMBLY_PARTS,...NEW_GEAR_ITEMS,...RISK_ITEMS]],['weapons',NEW_WEAPONS],['rods',NEW_RODS]])for(const row of rows)if(!c[key].some(d=>d.id===row.id))c[key].push(structuredClone(row));
 const magnet=c.rods.find(r=>r.id==='rod_magnet');
 if(magnet&&!magnet.loot_table.some(e=>e.definitionId==='seal_unit'))magnet.loot_table.push({definitionId:'seal_unit',quantity:1,resistance:1.1,weight:12});
 c.crafting={version:3,recipes:structuredClone(CRAFTING_RECIPES),modules:structuredClone(CRAFTING_MODULES),attachments:structuredClone(ASSEMBLY_ATTACHMENTS),materials:[...CRAFTING_MATERIALS],sources:{...CRAFTING_SOURCES},refundRate:GEAR_REFUND_RATE,replacementPolicy:'destroy-old',ammoRefund:'full',nonRefundable:RISK_ITEMS.map(i=>i.id),upgrades:Object.fromEntries(c.weapons.map(w=>[w.id,{credits:c.weapon_upgrade.cost_c,materials:c.weapon_upgrade.cost_m,ingredients:riskCost(w.id,{improvement:true})}]))};
 for(const recipe of c.crafting.recipes){const item=c.items.find(i=>i.id===recipe.definitionId);if(item){if(['carbine','rod_basic'].includes(item.id))delete item.craft_only;else item.craft_only=true;}}
 for(const material of c.items)if(CRAFTING_MATERIALS.includes(material.id))material.crafting_material=true;
 return c;
}
export function effectiveRod(def,item){
 const module=MODULE_BY_ID[item?.moduleId];
 if(!def)return def;
 const modified=module?.definitionId===def.id?{...def,moduleId:module.id,...(module.id==='rod_autohook'?{reel_power:def.reel_power*.9}:{})}:def;
 return assemblyRod(modified,item);
}
