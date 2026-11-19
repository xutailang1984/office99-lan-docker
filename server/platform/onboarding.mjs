// Account-level learning preferences; no world, inventory or reward mutations.
export const ONBOARDING_STEPS = 8;
export const ONBOARDING_VERSION = 2;
export const ONBOARDING_CHECKS = [ ['move','look'], ['rod','melee','quick'], ['inventory'], ['landed'], ['hit','pickup'], ['store','storage','upgrade','recycle'], ['rewards'], ['building'] ];
export function onboardingOf(account) {
  const value = account.onboarding;
  // v1 allowed advancing unchecked steps, so even its "done" cannot prove
  // completion. Project every previous account into this enrollment once;
  // the first confirmed learning transaction persists v2 without touching play.
  if (value==null || typeof value==='object' && !Array.isArray(value) && value.version===1) return newOnboarding();
  if (value.version!==ONBOARDING_VERSION || !['pending','active','done','paused'].includes(value.status) ||
      !Number.isSafeInteger(value.revision) || value.revision<0 ||
      !Number.isInteger(value.step) || value.step<0 || value.step>ONBOARDING_STEPS ||
      (value.status==='done')!==(value.step===ONBOARDING_STEPS) ||
      (value.status==='pending' && (value.step!==0 || value.checks?.length!==0)) ||
      !Array.isArray(value.checks) || value.checks.length>4 || new Set(value.checks).size!==value.checks.length ||
      !value.checks.every(c=>(ONBOARDING_CHECKS[value.step]??[]).includes(c))) throw Error('Invalid onboarding record');
  return {version:ONBOARDING_VERSION,status:value.status,step:value.step,revision:value.revision,checks:[...value.checks]};
}
export function newOnboarding() {return {version:ONBOARDING_VERSION,status:'pending',step:0,revision:0,checks:[]};}
export function changeOnboarding(account, input) {
  const current=onboardingOf(account);
  const invalid=code=>Object.assign(new Error(code),{code});
  if (!input || input.version!==ONBOARDING_VERSION || !['begin','check','advance','pause','restart'].includes(input.action) ||
      !Number.isSafeInteger(input.revision) || input.revision<0 ||
      Object.keys(input).some(k=>!['version','action','revision','step','checks'].includes(k))) throw invalid('INVALID_GUIDE');
  if (input.revision!==current.revision) throw invalid('GUIDE_CHANGED');
  let next={...current,revision:current.revision+1};
  if (input.action==='restart') next={...next,status:'active',step:0,checks:[]};
  else if (input.action==='begin' && ['pending','paused'].includes(current.status)) next.status='active';
  else if (input.action==='pause' && ['pending','active'].includes(current.status)) next.status='paused';
  else if (input.action==='check' && current.status==='active' && Array.isArray(input.checks) && input.checks.length>0 && input.checks.length<=4 && input.checks.every(c=>ONBOARDING_CHECKS[current.step].includes(c))) {
    next.checks=[...new Set([...current.checks,...input.checks])];
    if(next.checks.length===current.checks.length)return current;
  } else if (input.action==='advance' && current.status==='active' && input.step===current.step+1 && input.step<=ONBOARDING_STEPS && ONBOARDING_CHECKS[current.step].every(c=>current.checks.includes(c))) {
    next.step=input.step;next.status=input.step===ONBOARDING_STEPS?'done':'active';next.checks=[];
  } else throw invalid('INVALID_GUIDE');
  return next;
}
