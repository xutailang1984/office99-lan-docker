// One authoritative strike cue per committed attack. Animation and snapshots
// share the sequence; recovery/impact cues must not replay the wind-up or strike.
export function resolveEnemyAttack(w,enemy,zone=enemy.attackZone,{animate=true,followActor=false}={}) {
  if(animate){
    enemy.attackActionSeq=(enemy.attackActionSeq??0)+1;
    enemy.attackActionAt=w.s.time;
    enemy.attackActionKind=enemy.attackKind??'melee';
    enemy.attackActionYaw=enemy.yaw;
  }
  let area=zone??{shape:'cone',x:enemy.x,y:enemy.y,z:enemy.z,yaw:enemy.yaw,radius:enemy.attackRadius||1.5,halfAngle:Math.PI/3};
  // Body-centred damage follows knockback. Locked landing marks must not move.
  if(followActor)area={...area,x:enemy.x,y:enemy.y,z:enemy.z,yaw:enemy.yaw};
  w.event('EnemyAttackResolved',{enemyId:enemy.id,definitionId:enemy.definitionId,attackKind:enemy.attackKind??'melee',attackActionSeq:enemy.attackActionSeq??0,attackActionAt:enemy.attackActionAt??w.s.time,combatPhase:enemy.combatPhase??1,combatPreset:enemy.combatPreset??null,comboIndex:enemy.attackTimeline?.comboIndex??0,animate,zone:structuredClone(area),position:{x:enemy.x,y:enemy.y,z:enemy.z}},enemy.id);
}

export function syncCombatIntent(w,enemy,priorState,priorKind){
  if(enemy.tier==='boss')return;
  if(enemy.state!=='WINDUP'){enemy.attackTimeline=null;return;}
  if(enemy.attackTimeline&&priorState==='WINDUP'&&priorKind===enemy.attackKind)return;
  const windup=Math.max(.1,enemy.phaseRemaining??.5);
  const presentation=['puddle','paper_lob'].includes(enemy.attackKind)?'projection':'body';
  enemy.attackTimeline={startedAt:w.s.time,windup,presentation,active:.15,trackUntil:w.s.time+Math.max(0,windup-.25)};
  if(enemy.attackZone)enemy.attackZone.presentation=presentation;
}

export function cancelEnemyAttack(enemy){
 enemy.attackZone=null;enemy.attackTimeline=null;enemy.activeAttack=null;enemy.comboQueue=null;
 enemy.moveHits=[];enemy.chargeHit=[];enemy.chargeRemaining=0;enemy.weak=false;
 if(['WINDUP','ATTACK','CHARGE','FOLLOW_THROUGH','burrow_windup'].includes(enemy.state)){enemy.state='RECOVER';enemy.phaseRemaining=.5;}
}
