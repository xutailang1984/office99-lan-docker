// Avoid synchronous GPU reads of two frequently queried states.
// Godot owns this context and calls its methods; native/prototype bypass is unsupported.
export function cacheFrameState(gl) {
 if (!gl || typeof gl.blitFramebuffer !== 'function') return null;
 const contexts = cacheFrameState.contexts ??= new WeakMap();
 if (contexts.has(gl)) return contexts.get(gl).control;
 const names = ['getParameter', 'enable', 'disable', 'createFramebuffer', 'bindFramebuffer', 'deleteFramebuffer', 'isContextLost'];
 const native = Object.fromEntries(names.map(key => [key, gl[key]]));
 let own = new WeakSet(), deleted = new WeakSet();
 let scissor, draw, validScissor = false, validDraw = false, hits = 0, misses = 0;
 const invalidate = () => { validScissor = false; validDraw = false; };
 const restore = () => { invalidate(); own = new WeakSet(); deleted = new WeakSet(); };
 gl.canvas?.addEventListener('webglcontextlost', invalidate, true);
 gl.canvas?.addEventListener('webglcontextrestored', restore, true);
 const alive = () => !native.isContextLost.call(gl);
 const read = parameter => native.getParameter.call(gl, parameter);
 const borrowed = (key, receiver, args) => {
  const other = contexts.get(receiver);
  return (other?.wrapped[key] ?? native[key]).apply(receiver, args);
 };
 const wrapped = {
  createFramebuffer(...args) {
   if (this !== gl) return borrowed('createFramebuffer', this, args);
   const framebuffer = native.createFramebuffer.apply(this, args);
   if (framebuffer) own.add(framebuffer);
   return framebuffer;
  },
  bindFramebuffer(...args) {
   if (this !== gl) return borrowed('bindFramebuffer', this, args);
   const result = native.bindFramebuffer.apply(this, args);
   const [target, framebuffer] = args;
   // Preserve native WebIDL conversions and exceptions. Exotic enum inputs
   // are forwarded unchanged and invalidate the mirror for a native read.
   if (typeof target !== 'number') { validDraw = false; return result; }
   const kind = target >>> 0;
   if (kind === 36160 || kind === 36009) {
    if (alive() && (framebuffer === null || (typeof framebuffer === 'object' && own.has(framebuffer) && !deleted.has(framebuffer)))) {
     draw = framebuffer; validDraw = true;
    } else validDraw = false;
   }
   return result;
  },
  deleteFramebuffer(...args) {
   if (this !== gl) return borrowed('deleteFramebuffer', this, args);
   const result = native.deleteFramebuffer.apply(this, args), framebuffer = args[0];
   if (framebuffer && typeof framebuffer === 'object') {
    if (own.has(framebuffer)) deleted.add(framebuffer);
    // A native read can discover a framebuffer created before installation.
    if (validDraw && draw === framebuffer) { draw = null; validDraw = alive(); }
   }
   return result;
  },
  getParameter(...args) {
   if (this !== gl) return borrowed('getParameter', this, args);
   const parameter = args[0];
   if (![3089, 36006].includes(parameter)) return native.getParameter.apply(this, args);
   if (!alive()) { invalidate(); return read(parameter); }
   if (parameter === 3089) {
    if (validScissor) { hits++; return scissor; }
    misses++; scissor = read(parameter); validScissor = typeof scissor === 'boolean'; return scissor;
   }
   if (validDraw) { hits++; return draw; }
   misses++; draw = read(parameter); validDraw = true; return draw;
  },
 };
 for (const [key, enabled] of [['enable', true], ['disable', false]]) wrapped[key] = function(...args) {
  if (this !== gl) return borrowed(key, this, args);
  const result = native[key].apply(this, args), capability = args[0];
  if (typeof capability !== 'number') validScissor = false;
  else if ((capability >>> 0) === 3089) { scissor = enabled; validScissor = alive(); }
  return result;
 };
 const control = {
  stats: () => ({hits, misses}),
  compare: () => ({scissor: gl.getParameter(3089) === read(3089), draw: gl.getParameter(36006) === read(36006)}),
  nativeRead: read,
 };
 contexts.set(gl, {wrapped, control});
 Object.assign(gl, wrapped);
 return control;
}

// Scope the mirror to the engine canvas. Other canvases retain native methods.
export function installFrameStateCache(canvas) {
 if (!canvas || typeof canvas.getContext !== 'function') return false;
 const installed = installFrameStateCache.canvases ??= new WeakSet();
 if (installed.has(canvas)) return true;
 const original = canvas.getContext;
 canvas.getContext = function(...args) {
  const gl = original.apply(this, args);
  if (this === canvas && args[0] === 'webgl2' && gl) cacheFrameState(gl);
  return gl;
 };
 installed.add(canvas);
 return true;
}
