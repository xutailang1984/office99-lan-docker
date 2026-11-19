// Shared by Node and the host Worker. Times describe authority, animation and sound.
const move=(windup,damage,shape,extra={})=>({windup,damage,shape,recovery:.55,active:.12,lock:.22,weak:0,buildingDamage:damage*2,...extra});
export const BOSS_MOVES={
 claw_left:move(.42,12,'cone',{radius:2.8,halfAngle:.85,yawOffset:-.32}),
 claw_right:move(.46,14,'cone',{radius:2.8,halfAngle:.85,yawOffset:.32}),
 slam:move(.86,32,'circle',{radius:4,weak:2.2,buildingDamage:100,recovery:.7}),
 charge:move(.78,28,'line',{length:10,width:3.1,speed:9,active:10/9,weak:2.1,buildingDamage:90,lock:.35}),
 audit_cone:move(.64,20,'cone',{radius:8,halfAngle:.48,recovery:.45}),
 stamp_marks:move(.86,18,'marks',{radius:1.6,range:11,weak:2.1,buildingDamage:48,lock:.45}),
 overload_ring:move(.78,22,'ring',{radius:7,innerRadius:2.2,active:.8,travel:true,weak:1.8,buildingDamage:65}),
 power_burst:move(.56,8,'burst',{radius:7,speed:7,weak:0,recovery:.5}),
 shredder_fan:move(.65,21,'cone',{radius:6,halfAngle:.72,active:.28,recovery:.5,buildingDamage:60}),
 shredder_advance:move(.82,24,'line',{length:6,width:3.2,speed:7.5,active:.8,weak:2,buildingDamage:70,lock:.32}),
 printer_wave:move(.78,23,'line',{length:9,width:3.4,active:.9,travel:true,weak:2.1,buildingDamage:65,lock:.32}),
 printer_shift:move(.28,0,'line',{length:2.6,width:2.1,speed:4.5,active:2.6/4.5,recovery:.15,sideways:true}),
 stamp_press:move(.72,18,'marks',{radius:1.6,range:8,weak:2.2,buildingDamage:55,lock:.38}),
 coffee_line:move(.68,20,'line',{length:9,width:2.5,active:.6,travel:true,weak:1.8,buildingDamage:60,lock:.3}),
 coffee_ring:move(.72,22,'ring',{radius:7,innerRadius:2.2,active:.8,travel:true,weak:1.8,buildingDamage:60}),
 coffee_boil:move(.57,18,'circle',{radius:2.2,active:.15,weak:2,buildingDamage:45}),
};

export const COMBAT_PRESETS={
 introduction:{rank:1,windup:1.2,recovery:1.25,weak:1.25,comboLimit:1},
 veteran:{rank:2,windup:1.08,recovery:1.1,weak:1.1,comboLimit:2},
 complete:{rank:3,windup:1,recovery:1,weak:1,comboLimit:3},
};
export function bossApproachRange(e){
 if(e.definitionId==='boss_crab')return e.variantId==='overload'?7:8;
 return {boss_shredder:7,boss_printer:9,boss_stamp_press:8,boss_coffee_boiler:9}[e.definitionId]??7;
}
export function combatPreset(w,e){
 const id=e.combatPreset??(e.source==='practice'?'complete':(e.night?(w.s.dayIndex??1):e.riskTier??1)>=6?'complete':(e.night?(w.s.dayIndex??1):e.riskTier??1)>=3?'veteran':'introduction');
 return {id:COMBAT_PRESETS[id]?id:'introduction',...(COMBAT_PRESETS[id]??COMBAT_PRESETS.introduction)};
}
// A role has a distinct tempo. Fishing and rare catches keep their own risk rules.
export function combatRoleDefinition(e,def){
 if(['fishing','rare_catch'].includes(e.source)||def.tier==='boss'||!def.aggressive)return def;
 const roles={
  courier:[.48,1.15,1.1],swooper:[.52,1.25,1.05],shield:[.65,1.15,1],
  jammer:[.62,1.8,1],drone:[.48,1.55,1.05],artillery:[.78,2.05,1],
  breaker:[.72,1.35,1],spore:[.68,1.9,1],medic:[.46,1.5,1],
  eraser:[.6,1.2,1.12],battery:[.5,1.05,1.16],rally:[.58,1.45,1],lobber:[.8,2.1,1],
 };
 const row=roles[def.role]??(e.definitionId==='eel'?[.55,1.5,1]:e.definitionId==='crab'?[.38,1.05,1.12]:null);
 return row?{...def,attack_windup:row[0],attack_cooldown:row[1],speed:def.speed*row[2]}:def;
}

export function bossChains(e,distance,preset){
 let chains;
 switch(e.definitionId){
 case 'boss_crab':
  chains=e.variantId==='auditor'?[['audit_cone','stamp_marks'],['stamp_marks','audit_cone']]:e.variantId==='overload'?[['power_burst','overload_ring'],['overload_ring','power_burst']]:distance>4.3?[['charge','claw_left'],['charge','slam']]:distance>3.1?[['slam'],['charge','claw_right']]:[['claw_left','claw_right','slam'],['slam'],['charge','claw_right']];break;
 case 'boss_shredder':chains=e.cancelNextAdvance?[['shredder_fan']]:distance>5?[['shredder_advance','shredder_fan']]:[['shredder_fan','shredder_advance'],['shredder_advance','shredder_fan']];break;
 case 'boss_printer':chains=[['printer_wave','printer_shift','printer_wave'],['printer_shift','printer_wave']];break;
 case 'boss_stamp_press':chains=[['stamp_press','stamp_press','stamp_press']];break;
 case 'boss_coffee_boiler':chains=distance>7?[['coffee_line','coffee_ring','coffee_boil']]:distance<2.4?[['coffee_boil','coffee_line'],['coffee_ring','coffee_boil']]:[['coffee_line','coffee_ring','coffee_boil'],['coffee_ring','coffee_line']];break;
 default:return [];
 }
 return chains.map(chain=>chain.slice(0,preset.comboLimit));
}
