// Shared by the browser host and Node. Risk materials have no safe crafting,
// purchase or conversion source. Sharing earned equipment remains allowed.
export const RISK_ITEMS=[
 {id:'field_core',name:'外勤机芯',kind:'material',stack:8,sell_c:40,crafting_material:true,non_refundable:true,description:'中风险外勤获得 · 制作进阶装备'},
 {id:'hazard_core',name:'特勤机芯',kind:'material',stack:8,sell_c:100,crafting_material:true,non_refundable:true,description:'高风险外勤或高压首领获得 · 制作高阶装备'}
];
export const RISK_SOURCES={field_core:'中风险区宝盒、外勤交付；击败一二阶夜袭首领',hazard_core:'高风险区宝盒、外勤交付；击败三阶以上夜袭首领'};
const advanced=new Set(['shotgun','smg','rod_pro','rod_light','rod_magnet']);
const specialist=new Set(['rifle','lmg','doublebarrel','dmr','rod_heavy','rod_net']);
export function gearRisk(id){return specialist.has(id)?3:advanced.has(id)?2:1;}
export function riskCost(id,{improvement=false}={}){
 const tier=Math.max(improvement?2:1,gearRisk(id));
 return tier===1?[]:[{definitionId:tier===3?'hazard_core':'field_core',quantity:tier===3&&!improvement?2:1}];
}
export function riskRecipe(row,improvement=false){
 const extra=riskCost(row.definitionId,{improvement});
 return {...row,risk:Math.max(improvement?2:1,gearRisk(row.definitionId)),ingredients:[...row.ingredients.filter(x=>!RISK_ITEMS.some(i=>i.id===x.definitionId)),...extra]};
}
export function zoneCore(zone){return zone==='supply'?'hazard_core':zone==='hunt'?'field_core':null;}
export function nightCore(threatStage){return threatStage>=3?'hazard_core':'field_core';}
