// Authoritative, allocation-light fishing feedback. These helpers never create
// loot, roll a catch, move a player, or change the outer CAST/WAIT/BITE/REEL/LAND
// state. The world owns those transitions and all resource/collision checks.
const clamp = (n, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const number = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
const MODES = {rod_basic:'float',rod_light:'lure',rod_pro:'angle',rod_heavy:'power',rod_magnet:'magnet',rod_net:'net'};
const TRAITS = {
  clip_crab:{behavior:'drag',period:4.4,burst:1.2,strength:1.25},receipt_ray:{behavior:'glide',period:5.8,burst:.6,strength:1.05},staple_squid:{behavior:'dart',period:2.1,burst:.55,strength:1.3},seal_puffer:{behavior:'pulse',period:4.8,burst:1.3,strength:1.45},
  spring_shrimp: {behavior:'dart',period:2.7,burst:.4,strength:1.2},
  ink_cuttle: {behavior:'pulse',period:4.3,burst:1,strength:1.3},
  manager_koi: {behavior:'rush',period:5.2,burst:1.2,strength:1.65},
  silverfish: {behavior:'dart',period:3.2,burst:.55,strength:1.1},
  crab: {behavior:'drag',period:4,burst:.85,strength:1.2},
  eel: {behavior:'rush',period:4.5,burst:1.05,strength:1.55},
  bubble_puffer: {behavior:'pulse',period:4.6,burst:1,strength:1.3},
  lantern_fish: {behavior:'glide',period:5,burst:.55,strength:1.05}
};
const trait = f => TRAITS[f.creature] ?? TRAITS.silverfish;

function lineSide(f, p) {
  const x = number(f.x)-number(p.x), z = number(f.z)-number(p.z), length = Math.hypot(x,z);
  return length > .01 ? {x:z/length,z:-x/length} : {x:1,z:0};
}

export function initializeFishing(f, p, def) {
  f.mode ??= def.moduleId==='rod_straight'?'float':MODES[def.id] ?? (f.catch_kind === 'salvage' ? 'magnet' : 'float');
  f.cue ??= f.mode === 'magnet' ? 'scan' : f.mode === 'lure' ? 'lure_pull' : 'wait';
  f.behavior = f.mode === 'magnet' ? 'drag' : trait(f).behavior;
  f.pullSide ??= 0;
  f.angleAdvantage ??= 0;
  f.activity ??= 0;
  f.signal ??= 0;
  f.motion ??= 0;
  f._castDistance ??= Math.hypot(number(f.x)-number(p.x),number(f.z)-number(p.z));
  f._waitSeconds ??= 0;
  f._interest ??= 0;
  f._holdTime ??= 0;
  f._releaseTime ??= .5;
  f._wasReeling ??= false;
  return f;
}

function observeHold(f, p, dt) {
  const held = p.input?.reel === true;
  if (held) {
    // Tiny packet/button pulses do not reset a prolonged pull. A perceptible
    // release is needed; spamming a button is no stronger than a steady rhythm.
    if (!f._wasReeling && f._releaseTime >= .24) f._holdTime = 0;
    f._holdTime += dt;
    f._releaseTime = 0;
  } else {
    if (f._wasReeling) f._restBoost = f._holdTime >= .25 && f._holdTime <= 1.15;
    f._releaseTime += dt;
  }
  f._wasReeling = held;
  f.reeling = held;
  return held;
}

export function updateWaiting(f, p, def, dt, config = {}) {
  initializeFishing(f,p,def);
  dt = Math.max(0,number(dt));
  f._waitGoal ??= Math.max(.05,number(f.remaining,def.bite_wait_min ?? config.bite_wait_min ?? 4)+dt);
  f._waitSeconds += dt;
  const held = observeHold(f,p,dt);
  if(f.mode==='net'){
    f.activity=clamp(f._waitSeconds/(def.attachmentId==='rod_marker'?3:4));f.signal=f.activity;f.cue=f.activity>=.8?'net_ready':'net_wait';f.motion=Math.sin(f._waitSeconds*1.7)*.15;
    f.remaining=Math.max(0,12-f._waitSeconds);
    const closing=held&&f._waitSeconds>=.8;
    if(closing||f.remaining<=0){f.netBatch=def.moduleId==='net_quick'?1:f.activity>=.8?2:1;f.netBatch=Math.min(f.netBatch,def.max_batch??2);f.cue='net_close';}
    return {readyToBite:false,autoHook:closing||f.remaining<=0};
  }
  f.struggling = false;
  f.pullSide = 0;
  f.angleAdvantage = 0;
  if (f.mode === 'lure') {
    const goodPause = !held && f._restBoost && f._releaseTime >= .2 && f._releaseTime <= .85;
    const rate = held ? (f._holdTime <= .85 ? .26 : .018) : goodPause ? .7 : .014;
    f._interest = clamp(f._interest+rate*dt);
    f.activity = f._interest;
    f.motion = held ? Math.sin(f._waitSeconds*5)*.5 : .08;
    f.cue = held && f._holdTime >= .7 || !held && f._releaseTime < .5 ? 'lure_pause' : 'lure_pull';
    // Waiting is forgiving, but visibly slower than working the lure.
    const fallback = Math.max(11,f._waitGoal*2.5);
    f.remaining = Math.max(0,fallback-f._waitSeconds);
    return {readyToBite:(f._interest >= 1 && f._waitSeconds >= 2.6) || f.remaining <= 0,autoHook:false};
  }
  if (f.mode === 'magnet') {
    const side = lineSide(f,p), lateralSpeed = Math.abs(number(p.velocity?.x)*side.x+number(p.velocity?.z)*side.z);
    f.signal = clamp(f.signal+(held ? (def.moduleId==='rod_sweep'?.10+Math.min(.25,lateralSpeed*.15):.16+Math.min(.06,lateralSpeed*.025)) : .025)*dt);
    f.activity = held ? .35+.5*f.signal : .08;
    f.motion = held ? Math.sin(f._waitSeconds*1.8)*.12 : 0;
    f.cue = 'scan';
    // An inaccessible bank cannot soft-lock the cast: holding scans in place,
    // and a passive fallback exists without changing or revealing the catch.
    const fallback = Math.max(18,f._waitGoal*2.4);
    f.remaining = Math.max(0,fallback-f._waitSeconds);
    const attached = f.signal >= 1 || f.remaining <= 0;
    if (attached) {f.signal=1;f.cue='attached';}
    return {readyToBite:false,autoHook:attached};
  }
  if (f.mode === 'angle') {
    // A useful distant cast saves waiting time, while every valid sea cast
    // remains fishable and the reward roll stays independent of cancel/recast.
    const reach = clamp(f._castDistance/Math.max(1,def.cast_range));
    const duration = f._waitGoal*(1.12-.36*reach);
    f.remaining = Math.max(0,duration-f._waitSeconds);
  }
  f.cue = 'wait';
  f.activity = clamp(f._waitSeconds/Math.max(.1,f._waitGoal))*.3;
  f.motion = Math.sin(f._waitSeconds*1.3)*.06;
  const automatic=def.moduleId==='rod_autohook'&&f.remaining<=0;
  if(automatic)f.cue='auto_hook';
  return {readyToBite:f.remaining <= 0&&!automatic,autoHook:automatic};
}

export function beginReeling(f, p, def) {
  initializeFishing(f,p,def);
  f.behavior = f.mode === 'magnet' ? 'drag' : trait(f).behavior;
  f._reelTime = 0;
  f._manualBonus=def.moduleId==='rod_manual'&&f.state==='REEL'&&number(f.remainingBeforeHook)>=0&&number(f.remainingBeforeHook)<=(def.hook_window_seconds??2.6)*.5;
  f._holdTime = 0;
  f._releaseTime = .5;
  f._wasReeling = false;
  f._angleX = number(p.x);
  f._angleZ = number(p.z);
  const side = lineSide(f,p);
  f._sideX = side.x;
  f._sideZ = side.z;
  f._snagsDone = 0;
  f._snagActive = false;
  f._snagRest = 0;
  f._freeTime = 0;
  f._motionPhase = 0;
  f._reboundCycle = -1;
  f._reboundCharge = 0;
  f._reboundRemaining = 0;
  f._reboundSpent = false;
  f._rhythmReady = false;f._rhythmRemaining = 0;f._rhythmCooldown = 0;
  f._anchorCycle = -1;f._anchorRest = 0;f._anchorRemaining = 0;f._anchorSpent = false;
  f._anchorX = number(p.x);f._anchorZ = number(p.z);f._winchReady = false;
  f.struggling = false;
  f.activity = .2;
  f.pullSide = f.mode === 'angle' ? 1 : 0;
  f.angleAdvantage = 0;
  f.cue = f.mode === 'power' ? 'rush' : f.mode === 'magnet' ? 'attached' : f.mode === 'lure' ? 'lure_pull' : 'steady';
  return f;
}

export function updateReeling(f, p, def, dt, config = {}) {
  initializeFishing(f,p,def);
  if (!Number.isFinite(f._reelTime)) beginReeling(f,p,def);
  dt = Math.max(0,number(dt));
  f._reelTime += dt;
  const wasHeld=f._wasReeling,held = observeHold(f,p,dt), t = trait(f), phase = f._reelTime % t.period;
  f.struggling = phase < t.burst;
  f.activity = f.struggling ? clamp(.65*t.strength) : .2;
  let motionSpeed = f.struggling ? 3.6 : 1.2;
  let motionAmplitude = f.struggling ? .8 : .15;
  let motionTarget = null;
  f.pullSide = 0;
  f.angleAdvantage = 0;
  f.cue = f.struggling ? t.behavior === 'rush' ? 'rush' : 'dart' : 'steady';
  let progressRate = def.reel_power;
  let tensionRate = def.tension_rise*(f.struggling ? (def.struggle_multiplier ?? 1.5)*t.strength : 1);
  let lossRate = config.release_progress_loss_per_second ?? 3;
  let drainScale = 1;

  if (f.mode === 'lure') {
    // A short pull is productive. Holding indefinitely both tires the lure and
    // tightens the line; a short, intentional release restores the next pull.
    const fresh = def.moduleId==='rod_tow'?f._holdTime>=.5&&f._holdTime<=1.8:f._holdTime<=.85;
    progressRate *= fresh ? 1.6 : .32;
    tensionRate *= fresh ? .78 : 1.22;
    lossRate *= .5;
    f.cue = held && f._holdTime >= .7 || !held && f._releaseTime < .45 ? 'lure_pause' : 'lure_pull';
    if(def.moduleId==='rod_tow')f.cue=fresh?'tow_pull':'tow_rest';
    f.activity = fresh && held ? .75 : .25;
    drainScale = fresh ? .85 : 1;
    if(def.moduleId==='rod_rhythm'){
      if(!held&&wasHeld)f._rhythmPull=f._holdTime;
      if(!held)f._rhythmReady=number(f._rhythmPull)>=.25&&number(f._rhythmPull)<=.85&&f._releaseTime>=.25&&f._releaseTime<=.7&&f._reelTime>=f._rhythmCooldown;
      if(held&&!wasHeld&&f._rhythmReady){f._rhythmReady=false;f._rhythmRemaining=.6;f._rhythmCooldown=f._reelTime+2;}
      if(f._rhythmRemaining>0){const active=Math.min(dt,f._rhythmRemaining);f._rhythmRemaining=Math.max(0,f._rhythmRemaining-dt);if(held){progressRate*=1+.65*active/Math.max(.0001,dt);f.cue='rhythm_pull';f.activity=1;}}
      else if(f._rhythmReady)f.cue='rhythm_ready';
    }
  } else if (f.mode === 'angle') {
    const side = Math.floor(f._reelTime/5)%2 === 0 ? 1 : -1;
    const lateral = (number(p.x)-f._angleX)*f._sideX+(number(p.z)-f._angleZ)*f._sideZ;
    f.pullSide = side;
    f.angleAdvantage = clamp(lateral*side/.9);
    f.cue = side < 0 ? 'side_left' : 'side_right';
    progressRate *= .83+.82*f.angleAdvantage;
    tensionRate *= 1.08-.65*f.angleAdvantage;
    motionTarget = -side*(.35+.35*f.activity);
    drainScale = 1-.2*f.angleAdvantage;
    if(def.moduleId==='rod_rebound'){
      const cycle=Math.floor(f._reelTime/5);
      if(f._reboundCycle!==cycle){f._reboundCycle=cycle;f._reboundCharge=0;f._reboundRemaining=0;f._reboundSpent=false;}
      // One deliberate pause per side-change earns one burst. Repeated mouse
      // edges cannot re-arm it and staying on the wrong side never charges.
      if(!f._reboundSpent&&!held&&f.angleAdvantage>=.7)f._reboundCharge=Math.min(.4,number(f._reboundCharge)+dt);
      else if(!held&&f.angleAdvantage<.7)f._reboundCharge=0;
      if(!f._reboundSpent&&held&&f._reboundCharge>=.4&&f.angleAdvantage>=.7){f._reboundSpent=true;f._reboundRemaining=.7;}
      if(f._reboundRemaining>0){
        const active=Math.min(dt,f._reboundRemaining);f._reboundRemaining=Math.max(0,f._reboundRemaining-dt);
        if(held){progressRate*=1+.8*active/Math.max(dt,.0001);f.cue='rebound_pull';f.activity=1;}
      }else if(!f._reboundSpent&&f.angleAdvantage>=.7)f.cue=f._reboundCharge>=.4?'rebound_ready':'rebound_rest';
    }
  } else if (f.mode === 'power') {
    const period = t.behavior === 'rush' ? 5.5 : t.behavior === 'drag' ? 5.1 : 4.8;
    const rushing = f._reelTime % period < 1.4;
    f.struggling = rushing;
    f.cue = rushing ? 'rush' : 'tired';
    f.activity = rushing ? 1 : .16;
    motionSpeed = rushing ? 2.7 : 1;
    motionAmplitude = rushing ? .9 : .1;
    progressRate *= rushing ? .18 : 1.75;
    tensionRate = def.tension_rise*(rushing ? 6.5 : .38);
    lossRate = rushing ? .8 : 2;
    drainScale = rushing ? 1.5 : .72;
    if(def.moduleId==='rod_anchor'){
      const cycle=Math.floor(f._reelTime/period),moved=Math.hypot(number(p.x)-f._anchorX,number(p.z)-f._anchorZ)>.04||(p.moveSpeed??0)>.15;
      f._anchorX=number(p.x);f._anchorZ=number(p.z);
      if(f._anchorCycle!==cycle){f._anchorCycle=cycle;f._anchorRest=0;f._anchorRemaining=0;f._anchorSpent=false;}
      if(moved){f._anchorRest=0;f._anchorRemaining=0;}
      else if(rushing&&!held)f._anchorRest=Math.min(.7,f._anchorRest+dt);
      if(!rushing&&held&&!f._anchorSpent&&f._anchorRest>=.7){f._anchorSpent=true;f._anchorRemaining=.8;}
      if(f._anchorRemaining>0){const active=Math.min(dt,f._anchorRemaining);f._anchorRemaining=Math.max(0,f._anchorRemaining-dt);if(held){progressRate*=1+.65*active/Math.max(.0001,dt);f.cue='anchor_pull';f.activity=1;}}
      else if(!f._anchorSpent&&!moved&&rushing&&!held)f.cue=f._anchorRest>=.7?'anchor_ready':'anchor_brace';
    }
  } else if (f.mode === 'magnet') {
    f.struggling = false;
    f.signal = 1;
    motionTarget = 0;
    f.activity = held ? .35 : .08;
    f.cue = 'steady';
    tensionRate = def.tension_rise*.4;
    lossRate = 0;
    drainScale = .75;
    if (def.moduleId!=='rod_sweep'&&!f._snagActive && f._snagsDone < 2 && number(f.progress) >= [30,65][f._snagsDone]) {
      f._snagActive = true;
      f._snagX = number(p.x);
      f._snagZ = number(p.z);
      const axis = lineSide(f,p);
      f._snagSideX = axis.x;
      f._snagSideZ = axis.z;
      f._snagRest = 0;
      f._winchReady = false;
    }
    if (f._snagActive) {
      f._snagRest = held ? 0 : f._snagRest+dt;
      const sideways = Math.abs((number(p.x)-f._snagX)*f._snagSideX+(number(p.z)-f._snagZ)*f._snagSideZ);
      f.angleAdvantage = clamp(sideways/.65);
      if(def.moduleId==='rod_winch'&&!held&&f._snagRest>=.5)f._winchReady=true;
      const winched=def.moduleId==='rod_winch'&&held&&f._winchReady;
      if (sideways >= .65 || f._snagRest >= 3 || winched) {
        f._snagActive = false;
        f._snagsDone++;
        f._freeTime = .7;
        f.cue = winched?'winch_free':'free';f._winchFreed=winched;
      } else {
        f.cue = f._winchReady?'winch_ready':'snag';
        f.activity = held ? .8 : .15;
        progressRate = 0;
        tensionRate = def.tension_rise*1.6;
      }
    }
    if (!f._snagActive && f._freeTime > 0) {f.cue=f._winchFreed?'winch_free':'free';f._freeTime=Math.max(0,f._freeTime-dt);}
  } else if(f.mode==='net'){
    // A stretched net needs two distinct pull/rest cycles, rather than the
    // five rods' continuous tension contest. Both gates remain escapable.
    const gate=number(f.progress)>=55?1:0;
    f._netGate??=-1;f._netRest??=0;
    if(gate!==f._netGate){f._netGate=gate;f._netRest=0;}
    if(!held)f._netRest+=dt;
    const blocked=gate===1&&f._netRest<.4;
    progressRate*=blocked?.08:1.25;tensionRate*=held&&f._holdTime>1.6?2.8:.65;lossRate=0;
    f.cue=blocked||held&&f._holdTime>1.6?'net_rest':'net_pull';f.activity=held?.8:.15;motionTarget=0;motionAmplitude=.08;
  }
  if(def.moduleId==='rod_pump'){
    const fresh=held&&f._holdTime>=.2&&f._holdTime<=.85;
    progressRate*=fresh?1.6:.15;tensionRate*=fresh?.6:1.6;f.cue=fresh?'pump_pull':'pump_rest';
  }
  if(f._manualBonus){progressRate*=1.25;f.cue='manual_pull';}
  if(def.attachmentId==='rod_keeper')lossRate=0;
  // Integrate angular velocity instead of multiplying total time by the new
  // speed. Rush/recovery transitions must not jump to another sine phase.
  f._motionPhase = (number(f._motionPhase)+dt*motionSpeed)%(Math.PI*2);
  const motion = motionTarget ?? Math.sin(f._motionPhase)*motionAmplitude;
  f.motion += (motion-f.motion)*(1-Math.exp(-12*dt));
  return {progressRate,tensionRate,lossRate,drainScale};
}
