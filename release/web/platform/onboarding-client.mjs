// Keep account preferences out of room simulation and reject retired frames.
export function createOnboardingChannel({api,currentAccount,isCurrent,deliver}) {
  let pending=false;
  return {
    state:()=>JSON.stringify(currentAccount()?.onboarding??{version:2,status:'pending',step:0,revision:0,checks:[]}),
    async update(raw) {
      if(pending || !isCurrent() || typeof raw!=='string' || raw.length>256)return;
      let input;try{input=JSON.parse(raw);}catch{return;}
      if(!input || typeof input!=='object' || Array.isArray(input))return;
      const identity=currentAccount()?.id;if(!identity)return;
      pending=true;let value,error='';
      try {value=(await api('onboarding',{method:'POST',body:input})).onboarding;}
      catch {
        try {value=(await api('onboarding')).onboarding;}catch{}
        // A lost response is reconciled with durable account state, never with
        // an optimistic "completed" flag in localStorage.
        if(!value || (value.version===input.version && value.revision===input.revision))error='引导未保存，正在重试';
      } finally {pending=false;}
      if(currentAccount()?.id!==identity)return;
      const current=currentAccount().onboarding;
      if(value && (value.version>(current?.version??0) || value.version===current?.version && value.revision>=current.revision))currentAccount().onboarding=value;
      if(isCurrent())deliver({type:'onboarding_state',onboarding:currentAccount().onboarding,error});
    }
  };
}
