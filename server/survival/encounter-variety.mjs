// Deterministic, finite compositions. Reuse existing slots and persist choices.
export const REGION_PATTERNS={
 salvage:[{id:'patrol',name:'巡检来件',advice:'躲冲刺，留意巡逻',roles:['crab','courier'],patrol:'roam',events:['desk_alarm','desk_sort','desk_stamp']},{id:'paper',name:'纸鸢巡检',advice:'先找空中的巡信员',roles:['crab','paper_drone'],patrol:'roam',events:['desk_print','desk_stamp','desk_sort']}],
 hunt:[{id:'checkpoint',name:'护档关卡',advice:'绕护柜，先处理干扰',roles:['shield_bug','jammer'],patrol:'hold',events:['supply_dial','supply_seal']},{id:'sticky',name:'黏地封路',advice:'绕开黏地，搬箱前清路',roles:['spore_slug','stamp_bat'],patrol:'hold',events:['supply_carry','supply_cool']}],
 supply:[{id:'escort',name:'返工护送',advice:'先维修虫，再打归档机',roles:['archive_guard','medic_bug'],patrol:'escort',events:['parcel_intact','parcel_invoice']},{id:'dispatch',name:'空中急件',advice:'先躲卷纸，再清巡信员',roles:['paper_lobber','paper_drone'],patrol:'escort',events:['parcel_rush','parcel_relay']}]
};
export const NIGHT_SEQUENCES=[
 {id:'probe',name:'试探推进',times:[0,28,58],labels:['巡检试探','支援来件','集中突破'],orders:[['crab','courier','paper_drone'],['medic_bug','broadcast_cart','jammer','paper_lobber'],['breaker','shield_bug','eraser_cart','battery_mite']]},
 {id:'pincer',name:'双线错峰',times:[0,20,52],labels:['正门压阵','侧门来件','交叉推进'],orders:[['shield_bug','crab','breaker'],['stamp_bat','paper_drone','paper_lobber'],['courier','battery_mite','eraser_cart','medic_bug']]},
 {id:'relay',name:'先援后冲',times:[0,34,62],labels:['支援入场','快件突击','尾班压阵'],orders:[['broadcast_cart','medic_bug','paper_lobber'],['courier','stamp_bat','paper_drone'],['breaker','shield_bug','crab','battery_mite']]}
];
export function chooseNight(d){
 const now=d.w.s.time;d.s.history=d.s.history.filter(h=>now-h.at<=d.c.historySeconds).slice(-64);
 const recent=new Set(d.s.history.filter(h=>h.kind==='night').map(h=>h.id));
 let pool=d.c.nightPlans.filter(p=>!recent.has(p.id));if(!pool.length)pool=d.c.nightPlans;
 const history=d.s.bossHistory??=[];
 // Boss variety wins if the only still-unused plan belongs to yesterday's boss.
 if(history.length&&pool.every(p=>(p.bossDefinitionId??'boss_crab')===history.at(-1))&&d.c.nightPlans.some(p=>(p.bossDefinitionId??'boss_crab')!==history.at(-1)))pool=d.c.nightPlans.filter(p=>(p.bossDefinitionId??'boss_crab')!==history.at(-1));
 const kinds=[...new Set(pool.map(p=>p.bossDefinitionId??'boss_crab'))];
 const last=id=>history.lastIndexOf(id);const least=Math.min(...kinds.map(last));
 const kindPool=kinds.filter(id=>last(id)===least),kind=kindPool[Math.floor(d.w.rng('director')*kindPool.length)];
 const selected=d.choose(pool.filter(p=>(p.bossDefinitionId??'boss_crab')===kind),'night');
 history.push(kind);d.s.bossHistory=history.slice(-10);return selected;
}
export function prepareRegions(d){
 const day=d.w.s.dayIndex;d.spawnRoleCounts={};
 if(d.s.regionDay===day&&d.s.regionPlans)return;
 d.s.regionDay=day;d.s.regionPlans=Object.fromEntries(Object.entries(REGION_PATTERNS).map(([id,rows],i)=>[id,structuredClone(rows[(day+i)%rows.length])]));
}
export function compileNight(d){
 const w=d.w,n=w.s.night,plan=d.s.nightPlan,rows=NIGHT_SEQUENCES;
 const prior=d.s.sequenceHistory??=[],choices=rows.filter(r=>r.id!==prior.at(-1));
 const sequence=choices[Math.floor(w.rng('director_sequence')*choices.length)];
 prior.push(sequence.id);d.s.sequenceHistory=prior.slice(-6);
 const slots=n.pending.length,roles=plan.roles;const remaining=Array.from({length:slots},(_,i)=>roles[i%roles.length]);
 n.sequenceId=sequence.id;n.sequenceName=sequence.name;n.segments=sequence.times.map((at,index)=>({at,label:sequence.labels[index]}));
 n.pending=Array.from({length:slots},(_,i)=>{
  const stage=Math.min(2,Math.floor(i*3/Math.max(1,slots))),preferred=sequence.orders[stage];
  let pick=preferred.map(id=>remaining.indexOf(id)).find(index=>index>=0);if(pick===undefined)pick=0;
  const [definitionId]=remaining.splice(pick,1),entry=plan.entries[(i+(sequence.id==='pincer'?stage:0))%plan.entries.length];
  return {definitionId,at:sequence.times[stage],entry,segment:stage};
 });
 n.planId=plan.id;n.variantId=plan.boss;
}
export function nightSegment(n,elapsed){const rows=n?.segments;return rows?.length?Math.max(0,rows.findLastIndex(r=>elapsed>=r.at)):Math.min(2,Math.floor(elapsed/35));}
