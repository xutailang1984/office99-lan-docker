// Bounded physical components and two independent fitting positions.
// This module is portable: the browser owner and Node use identical definitions.
import {riskCost} from './risk-progression.mjs';
const cost=(rows)=>rows.map(([definitionId,quantity])=>({definitionId,quantity}));
export const ASSEMBLY_PARTS=[
 {id:'trigger_unit',name:'扳机组件',kind:'material',stack:5,sell_c:14,description:'改变开火节奏 · 工位、抽屉'},
 {id:'barrel_unit',name:'枪管组件',kind:'material',stack:5,sell_c:18,description:'改变射击用途 · 工位、快递'},
 {id:'optic_unit',name:'镜片组件',kind:'material',stack:5,sell_c:20,description:'瞄准和标记 · 物资间、宝盒'},
 {id:'spool_unit',name:'线轮组件',kind:'material',stack:5,sell_c:14,description:'改变收线方式 · 物资间、弹簧虾'},
 {id:'float_unit',name:'浮漂组件',kind:'material',stack:5,sell_c:12,description:'读懂水下动静 · 快递、便签鱼'},
 {id:'seal_unit',name:'防水外壳',kind:'material',stack:5,sell_c:18,description:'保护钓具附件 · 快递、磁吸'}
];
export const PART_SOURCES={trigger_unit:'旧工位区搜索、完整抽屉；制作台可合成',barrel_unit:'旧工位区或快递区搜索；制作台可合成',optic_unit:'旧物资间宝盒、完整抽屉；制作台可合成',spool_unit:'旧物资间搜索、弹簧虾；制作台可合成',float_unit:'便签鱼、快递区搜索；制作台可合成',seal_unit:'磁吸打捞、快递区宝盒；制作台可合成'};
export const NEW_GEAR_ITEMS=[
 {id:'doublebarrel',name:'双联回形针霰弹枪',kind:'weapon',stack:1,resale_c:110,description:'快速两发 · 折开装填'},
 {id:'dmr',name:'批注半自动步枪',kind:'weapon',stack:1,resale_c:115,description:'连续点射 · 控制后坐'},
 {id:'rod_net',name:'团建抛网',kind:'rod',stack:1,resale_c:65,description:'等鱼入网 · 分段收网'}
];
export const NEW_WEAPONS=[
 {id:'doublebarrel',ammo:'ammo_shell',fire_mode:'semi',damage:9,pellets:9,rpm:240,magazine:2,reload_seconds:2.65,range_full:7,range_end:23,range_end_multiplier:.2,hip_spread_deg:5.8,ads_spread_deg:4,recoil_pitch_deg:3.8,recoil_yaw_deg:.6,ads_fov:67,ads_seconds:.16,equip_seconds:.4},
 {id:'dmr',ammo:'ammo_heavy',fire_mode:'semi',damage:40,pellets:1,rpm:210,magazine:10,reload_seconds:2.35,range_full:48,range_end:100,range_end_multiplier:.65,hip_spread_deg:3.4,ads_spread_deg:.2,move_spread_deg:.55,recoil_pitch_deg:1.75,recoil_yaw_deg:.25,ads_fov:48,ads_seconds:.23,equip_seconds:.4}
];
export const NEW_RODS=[{id:'rod_net',cast_range:8,reel_power:15,tension_rise:20,tension_fall:32,cast_seconds:.7,bite_wait_min:3,bite_wait_max:6,charge_seconds:.65,hook_window_seconds:4,reel_timeout_seconds:35,presentation_kind:'net',max_batch:2}];
export const ASSEMBLY_RECIPES=[
 ...ASSEMBLY_PARTS.map((part,index)=>({id:part.id,definitionId:part.id,name:part.name,description:'材料合成 · 也可探索获得',ingredients:cost([['scrap',5+index%2],['spring_parts',2]])})),
 {id:'doublebarrel',definitionId:'doublebarrel',name:'双联回形针霰弹枪',description:'两次单击 · 折开装填',ingredients:cost([['scrap',8],['barrel_unit',2],['trigger_unit',1]])},
 {id:'dmr',definitionId:'dmr',name:'批注半自动步枪',description:'瞄准点射 · 连续压枪',ingredients:cost([['scrap',9],['barrel_unit',1],['optic_unit',2]])},
 {id:'rod_net',definitionId:'rod_net',name:'团建抛网',description:'等鱼聚拢 · 分段收网',ingredients:cost([['scrap',5],['spool_unit',1],['float_unit',2]])}
];
const branch=(id,definitionId,name,description,tradeoff,part,extra={})=>({id,definitionId,name,description,tradeoff,ingredients:cost([['scrap',3],[part,1]]),...extra});
export const ASSEMBLY_MODULES=[
 branch('carbine_anchor','carbine','驻足机匣','站稳瞄准半秒，稳住连射','移动失去支撑，持续射速较慢','trigger_unit'),
 branch('shotgun_breach','shotgun','拆箱喷嘴','散射破坏物品更快','打怪伤害略低','barrel_unit'),
 branch('rifle_spotter','rifle','指路镜组','命中后标出目标，方便同事找它','伤害略低，标记不穿墙','optic_unit'),
 branch('pistol_quick','pistol','快换机匣','装填快，适合切换和近身应急','单发威力较低','trigger_unit'),
 branch('smg_sweep','smg','扫纸喷嘴','每发两枚图钉，近处扫开小怪','远处散得更开','barrel_unit'),
 branch('lmg_heat','lmg','散热机匣','快射十二发，然后需要停火冷却','连射过久会热停一秒','trigger_unit'),
 branch('rod_manual','rod_basic','手提浮漂','自己抓准咬钩后半段，提竿后快收','提早提竿没有加速','float_unit'),
 branch('rod_tow','rod_light','拖曳线轮','按住轻拖，半秒后发力收线','频繁点按较慢，持续硬拉仍要卸力','spool_unit'),
 branch('rod_straight','rod_pro','直收线轮','不用横移，沿直线慢慢拖回','收线慢于正确走位的原型','spool_unit'),
 branch('rod_pump','rod_heavy','泵拉摇柄','短拉一下再松手，分次拖回大鱼','一直按住拉不动','spool_unit'),
 branch('rod_sweep','rod_magnet','扫底磁头','左右扫底更快挂住，收回不易卡住','站着扫描和收回较慢','seal_unit'),
 branch('doublebarrel_pair','doublebarrel','双发机匣','按住打出两发，随后折开装填','耗弹快，空膛要等换弹','trigger_unit'),
 branch('doublebarrel_tight','doublebarrel','束弹喷嘴','散布收拢，适合中近距离','近处覆盖变小','barrel_unit'),
 branch('dmr_rhythm','dmr','节拍机匣','停半秒再射，后坐和散布更小','快点没有节拍收益','trigger_unit'),
 branch('dmr_mobile','dmr','机动镜组','走动瞄准更稳，适合边走边点','远程伤害衰减更早','optic_unit'),
 branch('net_quick','rod_net','快收网轮','鱼入网后立即收，少量快速捕捞','一次只收一条','spool_unit'),
 branch('net_wide','rod_net','宽口网框','等鱼聚齐再收，网里更稳','收网较慢，要先处理上岸活鱼','float_unit')
];
export const ASSEMBLY_ATTACHMENTS=[
 {id:'gun_grip',kind:'weapon',name:'稳握把',description:'移动瞄准散布更小',tradeoff:'瞄准起手稍慢',ingredients:cost([['scrap',2],['trigger_unit',1]])},
 {id:'gun_brake',kind:'weapon',name:'缓冲垫',description:'开火后坐更小',tradeoff:'换弹稍慢',ingredients:cost([['scrap',2],['barrel_unit',1]])},
 {id:'rod_marker',kind:'rod',name:'响铃标',description:'咬钩窗口更长，抛网更快聚鱼',tradeoff:'普通钓竿等待稍久',ingredients:cost([['scrap',2],['float_unit',1]])},
 {id:'rod_keeper',kind:'rod',name:'止退扣',description:'松手不倒退，硬拉张力更慢',tradeoff:'收线稍慢',ingredients:cost([['scrap',2],['seal_unit',1]])}
];
for(const row of ASSEMBLY_ATTACHMENTS)row.ingredients.push(...riskCost('',{improvement:true}));
export const ATTACHMENT_BY_ID=Object.fromEntries(ASSEMBLY_ATTACHMENTS.map(a=>[a.id,a]));
const attachmentGear={weapon:new Set(['carbine','shotgun','rifle','pistol','smg','lmg','doublebarrel','dmr']),rod:new Set(['rod_basic','rod_pro','rod_light','rod_heavy','rod_magnet','rod_net'])};
export function validAttachment(item,kind){const attachment=ATTACHMENT_BY_ID[item?.attachmentId];return !item?.attachmentId||!!attachment&&(!kind||attachment.kind===kind)&&attachmentGear[attachment.kind].has(item.definitionId);}
export function assemblyWeapon(def,item,p,now=0){
 if(!def)return def;
 const d={...def},id=item?.moduleId;
 if(id==='carbine_anchor'){d.rpm=250;if((p?.gearFocusSeconds??0)>=.5){d.ads_spread_deg*=.35;d.recoil_pitch_deg*=.5;}}
 if(id==='shotgun_breach')d.damage*=.85;
 if(id==='rifle_spotter')d.damage*=.9;
 if(id==='pistol_quick'){d.damage=27;d.reload_seconds=.85;d.equip_seconds=.15;}
 if(id==='smg_sweep'){d.damage=7;d.pellets=2;d.hip_spread_deg=3.5;d.ads_spread_deg=1.3;d.range_end=30;}
 if(id==='lmg_heat')d.rpm=600;
 if(id==='doublebarrel_pair')d.fire_mode='auto';
 if(id==='doublebarrel_tight'){d.hip_spread_deg=2.8;d.ads_spread_deg=1.8;}
 if(id==='dmr_rhythm'&&now-(p?.gearLastShotAt??-100)>=.5){d.ads_spread_deg*=.3;d.recoil_pitch_deg*=.5;}
 if(id==='dmr_mobile'){d.move_spread_deg=0;d.range_full=32;d.range_end=70;}
 if(item?.attachmentId==='gun_grip'){d.move_spread_deg=(d.move_spread_deg??0)*.4;d.moving_spread_multiplier=.7;d.ads_seconds+=.06;}
 if(item?.attachmentId==='gun_brake'){d.recoil_pitch_deg*=.65;d.recoil_yaw_deg*=.65;d.reload_seconds*=1.12;}
 return d;
}
export function assemblyRod(def,item){
 if(!def)return def;
 const d={...def,moduleId:item?.moduleId,attachmentId:item?.attachmentId};
 if(item?.moduleId==='rod_straight')d.reel_power*=.8;
 if(item?.moduleId==='rod_sweep')d.reel_power*=.8;
 if(item?.moduleId==='net_quick'){d.max_batch=1;d.reel_power*=1.3;}
 if(item?.moduleId==='net_wide'){d.reel_power*=.8;d.tension_rise*=.6;}
 if(item?.attachmentId==='rod_marker'){d.hook_window_seconds+=.8;d.bite_wait_min=(d.bite_wait_min??4)+1;d.bite_wait_max=(d.bite_wait_max??7)+1;}
 if(item?.attachmentId==='rod_keeper'){d.reel_power*=.85;d.tension_rise*=.75;}
 return d;
}
