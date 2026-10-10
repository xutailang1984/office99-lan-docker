// Finite daily stock and risk tiers. Neither loot rolls nor personal rewards
// multiply by the current player count; more players share more bounded stock.
export const ZONE_RISKS = [
 {id:'salvage',name:'旧工位区',risk:1,riskName:'轻度风险',advice:'基础装备可来，留意巡逻',materials:['scrap','spring_parts','sealed_cell'],guardHp:.85,guardDamage:.8,roles:['crab','courier','paper_drone'],reward:[['scrap',4],['spring_parts',1]]},
 {id:'hunt',name:'旧物资间',risk:2,riskName:'中度风险',advice:'带药和备用弹，绕开重甲',materials:['spring_parts','sealed_cell','scrap'],guardHp:1.1,guardDamage:1.05,roles:['shield_bug','jammer','spore_slug','stamp_bat'],reward:[['scrap',3],['spring_parts',3],['sealed_cell',1]]},
 {id:'supply',name:'快递堆放区',risk:3,riskName:'高度风险',advice:'带好装备，结伴更稳',materials:['sealed_cell','spring_parts','scrap'],guardHp:1.3,guardDamage:1.2,roles:['archive_guard','breaker','paper_drone','medic_bug','paper_lobber'],reward:[['spring_parts',4],['sealed_cell',2]]},
];
const COUNTS=[
 {players:1,guards:6,nodes:10,aliveCap:5,bossFactor:1},
 {players:2,guards:10,nodes:18,aliveCap:8,bossFactor:1.65},
 {players:4,guards:16,nodes:32,aliveCap:12,bossFactor:2.9},
 {players:8,guards:24,nodes:56,aliveCap:18,bossFactor:5.2},
];
function row(count){
 const players=Math.max(1,Math.min(8,Math.round(Number.isFinite(count)?count:1))),hi=COUNTS.find(r=>players<=r.players);
 if(hi.players===players)return hi;
 const lo=COUNTS[COUNTS.indexOf(hi)-1],t=(players-lo.players)/(hi.players-lo.players),mix=key=>lo[key]+(hi[key]-lo[key])*t;
 // Intermediate team sizes should not inherit the next full squad's threat.
 return {players,guards:Math.round(mix('guards')),nodes:Math.round(mix('nodes')),aliveCap:Math.round(mix('aliveCap')),bossFactor:Number(mix('bossFactor').toFixed(4))};
}
export const zoneRisk=id=>ZONE_RISKS.find(z=>z.id===id)??ZONE_RISKS[0];
export function dayEncounterBudget(count){const {players,guards,nodes}=row(count);return {players,guards,nodes};}
export function nightEncounterBudget(count){const {players,aliveCap,bossFactor}=row(count);return {players,aliveCap,bossFactor};}
import {zoneCore} from './risk-progression.mjs';
export function nodeMaterialLoot(zoneId,kind){
 const tier=zoneRisk(zoneId).risk,cache=kind==='treasure';
 if(!cache)return tier===1?[['scrap',6],['spring_parts',1],['trigger_unit',1]]:tier===2?[['scrap',7],['spring_parts',2],['spool_unit',1]]:[['scrap',8],['spring_parts',2],['sealed_cell',1],['float_unit',1]];
 return [...(tier===1?[['scrap',4],['spring_parts',2],['sealed_cell',1],['barrel_unit',1]]:tier===2?[['scrap',6],['spring_parts',3],['sealed_cell',2],['optic_unit',1]]:[['scrap',8],['spring_parts',4],['sealed_cell',3],['seal_unit',1],['barrel_unit',1]]),['treasure',1],...(zoneCore(zoneId)?[[zoneCore(zoneId),1]]:[])];
}
export function expeditionContract(zoneId,day=1){
 const risk=zoneRisk(zoneId),alternate=day%2===0;
 const [searchGoal,killGoal]=risk.risk===1?[2,0]:risk.risk===2?[alternate?1:2,alternate?2:1]:[alternate?2:1,alternate?1:2];
 return {zoneId:risk.id,searchGoal,killGoal,reward:[...risk.reward,...(zoneCore(zoneId)?[[zoneCore(zoneId),1]]:[])].map(([definitionId,quantity])=>({definitionId,quantity}))};
}
export function publicRiskZones(){return ZONE_RISKS.map(({id,name,risk,riskName,advice,materials})=>({id,name,risk,riskName,advice,materials:[...materials,...(zoneCore(id)?[zoneCore(id)]:[])],loot:{search:nodeMaterialLoot(id,'scrap').map(([definitionId,quantity])=>({definitionId,quantity})),cache:nodeMaterialLoot(id,'treasure').map(([definitionId,quantity])=>({definitionId,quantity}))}}));}
