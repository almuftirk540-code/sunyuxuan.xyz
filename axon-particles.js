/* GPU particle sculpture and incompressible cursor flow. Three.js r150. */
(() => {
  'use strict';
  const canvas = document.querySelector('#bg');
  const T = window.THREE;
  if (!canvas) return;
  const fallback = (reason) => {
    document.documentElement.classList.add('webgl-unavailable');
    window.dispatchEvent(new CustomEvent('axon:ready', { detail: { count: 0, mode: 'static', reason } }));
  };
  if (!T) { fallback('renderer-unavailable'); return; }
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch (_) { fallback('webgl-unavailable'); return; }
  const gl = renderer.getContext();
  const webgl2 = renderer.capabilities.isWebGL2;
  if (!(webgl2 ? renderer.extensions.has('EXT_color_buffer_float') : renderer.extensions.has('OES_texture_float') && renderer.extensions.has('WEBGL_color_buffer_float'))) {
    renderer.dispose(); fallback('float-targets-unavailable'); return;
  }
  renderer.setClearColor(0x000000, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.LinearEncoding;
  renderer.autoClear = true;
  const mobile = matchMedia('(max-width: 760px)').matches;
  let smallLayout = mobile;
  const lowPower = mobile || ((navigator.hardwareConcurrency || 8) <= 4);
  let particleSide = mobile ? 128 : lowPower ? 256 : 512;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches;
  let disposed = false;
  let frameId = 0;
  let elapsed = 0;
  let previousTime = 0;
  let width = innerWidth;
  let height = innerHeight;
  let slowFrames = 0;
  let adaptive = false;
  let frames = 0;
  let contextLost = false;
  const resources = [];
  const track = (item) => { resources.push(item); return item; };
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(30, width / height, .1, 1000);
  const base = new T.Vector3(-1.17, 0, 6);
  const gaze = new T.Vector3();
  const lookAt = new T.Vector3();
  const group = new T.Group();
  group.position.set(.343, .16, -1);
  group.rotation.set(T.MathUtils.degToRad(-28.4), T.MathUtils.degToRad(390), T.MathUtils.degToRad(4.92));
  group.scale.set(5, 5, 6);
  scene.add(group);
  const pointer = { x: .5, y: .5, lastX: .5, lastY: .5, dx: 0, dy: 0, moved: false, stamp: 0 };
  const quadScene = new T.Scene();
  const quadCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new T.Mesh(track(new T.PlaneGeometry(2, 2)));
  quadScene.add(quad);
  const vertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
  const shader = (fragment, uniforms = {}) => track(new T.ShaderMaterial({
    vertexShader: vertex, fragmentShader: `precision highp float; varying vec2 vUv;\n${fragment}`,
    uniforms, depthTest: false, depthWrite: false, blending: T.NoBlending
  }));
  const val = (value) => ({ value });
  const target = (w, h, type = T.HalfFloatType) => track(new T.WebGLRenderTarget(w, h, {
    type, format: T.RGBAFormat, minFilter: T.NearestFilter, magFilter: T.NearestFilter,
    wrapS: T.ClampToEdgeWrapping, wrapT: T.ClampToEdgeWrapping, depthBuffer: false, stencilBuffer: false
  }));
  const pair = (w, h, type) => ({ read: target(w, h, type), write: target(w, h, type), swap() { const old = this.read; this.read = this.write; this.write = old; } });
  const pass = (material, destination) => {
    quad.material = material; renderer.setRenderTarget(destination); renderer.render(quadScene, quadCamera);
  };
  const copy = shader('uniform sampler2D source; uniform float fade; void main(){gl_FragColor=texture2D(source,vUv)*fade;}', { source: val(null), fade: val(1) });
  const clear = (rt) => { renderer.setRenderTarget(rt); renderer.clear(); };
  const simRes = lowPower ? 128 : 256;
  const dyeRes = lowPower ? 256 : 512;
  const flowType = webgl2 || renderer.extensions.has('EXT_color_buffer_half_float') ? T.HalfFloatType : T.FloatType;
  const velocity = pair(simRes, simRes, flowType);
  const density = pair(dyeRes, dyeRes, flowType);
  const pressure = pair(simRes, simRes, flowType);
  const curlTarget = target(simRes, simRes, flowType);
  const divergenceTarget = target(simRes, simRes, flowType);
  const densityMask = target(Math.min(width, 1600), Math.min(height, 1200), flowType);
  [velocity.read, velocity.write, density.read, density.write, pressure.read, pressure.write, curlTarget, divergenceTarget].forEach(clear);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    resources.forEach(r => r.dispose()); renderer.dispose(); fallback('render-target-incomplete'); return;
  }
  const step = new T.Vector2(1 / simRes, 1 / simRes);
  const common = { texel: val(step), source: val(null) };
  const curl = shader(`uniform sampler2D source;uniform vec2 texel;
    void main(){float l=texture2D(source,vUv-vec2(texel.x,0.)).y;float r=texture2D(source,vUv+vec2(texel.x,0.)).y;
    float b=texture2D(source,vUv-vec2(0.,texel.y)).x;float t=texture2D(source,vUv+vec2(0.,texel.y)).x;
    gl_FragColor=vec4(.5*(r-l-t+b),0.,0.,1.);}`, { ...common });
  const vorticity = shader(`uniform sampler2D source;uniform sampler2D curlMap;uniform vec2 texel;uniform float dt;
    void main(){float l=texture2D(curlMap,vUv-vec2(texel.x,0.)).r;float r=texture2D(curlMap,vUv+vec2(texel.x,0.)).r;
    float b=texture2D(curlMap,vUv-vec2(0.,texel.y)).r;float t=texture2D(curlMap,vUv+vec2(0.,texel.y)).r;
    float c=texture2D(curlMap,vUv).r;vec2 f=.5*vec2(abs(t)-abs(b),abs(r)-abs(l));f/=length(f)+.0001;
    f*=30.*c;f.y*=-1.;gl_FragColor=vec4(clamp(texture2D(source,vUv).xy+f*dt,vec2(-250.),vec2(250.)),0.,1.);}`,
    { ...common, curlMap: val(curlTarget.texture), dt: val(1 / 60) });
  const divergence = shader(`uniform sampler2D source;uniform vec2 texel;
    void main(){vec2 c=texture2D(source,vUv).xy;float l=texture2D(source,vUv-vec2(texel.x,0.)).x;float r=texture2D(source,vUv+vec2(texel.x,0.)).x;
    float b=texture2D(source,vUv-vec2(0.,texel.y)).y;float t=texture2D(source,vUv+vec2(0.,texel.y)).y;
    if(vUv.x<texel.x)l=-c.x;if(vUv.x>1.-texel.x)r=-c.x;if(vUv.y<texel.y)b=-c.y;if(vUv.y>1.-texel.y)t=-c.y;
    gl_FragColor=vec4(.5*(r-l+t-b),0.,0.,1.);}`, { ...common });
  const solve = shader(`uniform sampler2D source;uniform sampler2D divergenceMap;uniform vec2 texel;
    void main(){float l=texture2D(source,vUv-vec2(texel.x,0.)).r;float r=texture2D(source,vUv+vec2(texel.x,0.)).r;
    float b=texture2D(source,vUv-vec2(0.,texel.y)).r;float t=texture2D(source,vUv+vec2(0.,texel.y)).r;
    gl_FragColor=vec4((l+r+b+t-texture2D(divergenceMap,vUv).r)*.25,0.,0.,1.);}`,
    { ...common, divergenceMap: val(divergenceTarget.texture) });
  const gradient = shader(`uniform sampler2D source;uniform sampler2D pressureMap;uniform vec2 texel;
    void main(){float l=texture2D(pressureMap,vUv-vec2(texel.x,0.)).r;float r=texture2D(pressureMap,vUv+vec2(texel.x,0.)).r;
    float b=texture2D(pressureMap,vUv-vec2(0.,texel.y)).r;float t=texture2D(pressureMap,vUv+vec2(0.,texel.y)).r;
    gl_FragColor=vec4(texture2D(source,vUv).xy-.5*vec2(r-l,t-b),0.,1.);}`, { ...common, pressureMap: val(null) });
  const advection = shader(`uniform sampler2D source;uniform sampler2D flow;uniform vec2 texel;uniform vec2 sourceSize;uniform float dt;uniform float fade;
    vec4 bilerp(sampler2D tex,vec2 uv){vec2 p=uv*sourceSize-.5;vec2 i=floor(p);vec2 f=fract(p);vec2 d=1./sourceSize;
    return mix(mix(texture2D(tex,(i+.5)*d),texture2D(tex,(i+vec2(1.5,.5))*d),f.x),mix(texture2D(tex,(i+vec2(.5,1.5))*d),texture2D(tex,(i+1.5)*d),f.x),f.y);}
    void main(){vec2 uv=vUv-dt*texture2D(flow,vUv).xy*texel;gl_FragColor=bilerp(source,uv)*fade;}`,
    { ...common, flow: val(null), sourceSize: val(new T.Vector2(simRes, simRes)), dt: val(1 / 60), fade: val(.98) });
  const splat = shader(`uniform sampler2D source;uniform vec2 pointA;uniform vec2 pointB;uniform vec3 color;uniform float radius;uniform float aspect;
    void main(){vec2 p=vUv;vec2 a=pointA;vec2 b=pointB;p.x*=aspect;a.x*=aspect;b.x*=aspect;
    vec2 ab=b-a;float f=clamp(dot(p-a,ab)/max(dot(ab,ab),.000001),0.,1.);float d=length(p-(a+ab*f));
    vec3 added=exp(-d*d/max(radius*radius,.000001))*color;gl_FragColor=vec4(clamp(texture2D(source,vUv).xyz+added,vec3(-250.),vec3(250.)),1.);}`,
    { source: val(null), pointA: val(new T.Vector2()), pointB: val(new T.Vector2()), color: val(new T.Vector3()), radius: val(.06), aspect: val(width / height) });
  const mask = shader('uniform sampler2D source;void main(){vec3 c=texture2D(source,vUv).rgb;gl_FragColor=vec4(c,max(max(c.r,c.g),c.b));}', { source: val(null) });

  const sdfSource = `
    float shape(vec3 p){
      if(length(p)>.8)return length(p)-.7;
      p.z=sqrt(p.z*p.z+.0215)-sqrt(.012);
      p=p.zxy;
      float a=atan(p.z,p.y);float r=.255+.024*cos(3.*a)+.014*sin(2.*a);
      float tube=.086+.014*cos(2.*a+.5);
      vec2 q=vec2(length(p.yz)-r,p.x-.022*sin(2.*a));
      q.y*=1.06;return length(q)-tube;
    }
    vec3 normalAt(vec3 p){vec2 e=vec2(.001,0.);return normalize(vec3(shape(p+e.xyy)-shape(p-e.xyy),shape(p+e.yxy)-shape(p-e.yxy),shape(p+e.yyx)-shape(p-e.yyx))+vec3(.0000001));}
    vec3 curlNoise(vec3 p,float t){return normalize(vec3(-1.1*sin(p.y*1.1+t)-1.3*cos(p.z*1.3+t),-2.1*sin(p.z*2.1-t)-1.9*cos(p.x*1.9-t),-2.3*sin(p.x*2.3)-1.7*cos(p.y*1.7+t)));}
  `;
  const projectionView = new T.Matrix4();
  const simulation = shader(`uniform sampler2D source;uniform sampler2D origin;uniform sampler2D flow;uniform sampler2D dye;
    uniform float time;uniform float hz;uniform float healing;uniform mat4 viewProjection;uniform mat4 sculpture;uniform mat3 cameraRotation;
    ${sdfSource}
    void main(){vec3 p=texture2D(source,vUv).xyz;vec3 o=texture2D(origin,vUv).xyz;if(length(p)>.7)p*=.5;
      p+=curlNoise(p*.1+time*.05,time*.025)*.0002*hz;
      vec3 n=normalAt(p);p+=cross(normalize(p+vec3(.00001)),n)*.0005*hz;
      p-=n*shape(p)*healing;p+=(o-p)*.0002*hz;
      vec4 clip=viewProjection*sculpture*vec4(p,1.);vec2 uv=clip.xy/max(clip.w,.01)*.5+.5;
      float den=min(texture2D(dye,uv).r,2.);vec3 force=cameraRotation*vec3(texture2D(flow,uv).xy,0.);
      if(uv.x>0.&&uv.x<1.&&uv.y>0.&&uv.y<1.)p+=force*.0001*hz*.4*den;
      gl_FragColor=vec4(p,1.);
    }`, { source: val(null), origin: val(null), flow: val(velocity.read.texture), dye: val(densityMask.texture), time: val(0), hz: val(1), healing: val(.5), viewProjection: val(projectionView), sculpture: val(group.matrixWorld), cameraRotation: val(new T.Matrix3()) });
  let positions, originTexture, geometry, points, pointMaterial;
  function createParticles(side) {
    if (points) { group.remove(points); geometry.dispose(); positions.read.dispose(); positions.write.dispose(); originTexture.dispose(); pointMaterial.dispose(); }
    particleSide = side;
    const count = side * side;
    const origin = new Float32Array(count * 4);
    const attributes = new Float32Array(count * 4);
    const uvPositions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      origin[i * 4] = Math.random() * 2 - 1;
      origin[i * 4 + 1] = Math.random() * 2 - 1;
      origin[i * 4 + 2] = Math.random() * 2 - 1;
      origin[i * 4 + 3] = 1;
      for (let j = 0; j < 4; j++) attributes[i * 4 + j] = Math.random();
      uvPositions[i * 3] = ((i % side) + .5) / side;
      uvPositions[i * 3 + 1] = (Math.floor(i / side) + .5) / side;
    }
    originTexture = track(new T.DataTexture(origin, side, side, T.RGBAFormat, T.FloatType));
    originTexture.needsUpdate = true;
    positions = pair(side, side, T.FloatType);
    copy.uniforms.source.value = originTexture; copy.uniforms.fade.value = 1; pass(copy, positions.read); pass(copy, positions.write);
    simulation.uniforms.origin.value = originTexture;
    geometry = track(new T.BufferGeometry());
    geometry.setAttribute('position', new T.BufferAttribute(uvPositions, 3));
    geometry.setAttribute('random', new T.BufferAttribute(attributes, 4));
    pointMaterial = track(new T.ShaderMaterial({
      uniforms: { positions: val(positions.read.texture), time: val(0), dpr: val(renderer.getPixelRatio()), energy: val(side <= 128 ? 2.8 : side <= 256 ? 1.5 : 1) },
      vertexShader: `precision highp float;uniform sampler2D positions;uniform float dpr;attribute vec4 random;varying vec4 vRandom;varying float vScale;
        void main(){vec3 p=texture2D(positions,position.xy).xyz;p*=mix(1.,1.5,pow(random.y,150.));
        vec4 view=modelViewMatrix*vec4(p,1.);float dist=length(view.xyz);vScale=smoothstep(3.,15.,dist)*mix(.5,1.,random.z);
        gl_PointSize=clamp(.04*dpr*2.*vScale*(1000./max(-view.z,.1)),.65,6.);gl_Position=projectionMatrix*view;vRandom=random;}`,
      fragmentShader: `precision highp float;uniform float time;uniform float energy;varying vec4 vRandom;varying float vScale;
        void main(){vec2 uv=gl_PointCoord*2.-1.;float rr=dot(uv,uv);if(rr>1.||vScale<.1)discard;
        vec3 n=vec3(uv,sqrt(max(0.,1.-rr)));float light=.36+.64*max(dot(n,normalize(vec3(-.4,.7,1.))),0.);
        vec3 col=mix(vec3(.035+vRandom.x*.165),vec3(.6,.45,1.),pow(vRandom.z,100.));
        float sparkle=.5+(.4+sin(time*4.+vRandom.y*20.))*pow(vRandom.z,10.)*2.5;
        float edge=1.-smoothstep(.15,1.,rr);gl_FragColor=vec4(col*max(.14,sparkle)*light*energy,edge*.85);}`,
      transparent: true, blending: T.AdditiveBlending, depthTest: true, depthWrite: false
    }));
    points = new T.Points(geometry, pointMaterial); points.frustumCulled = false; group.add(points);
  }
  function cameraUpdate(dt) {
    gaze.copy(base);
    if (!paused && !reduced.matches) { gaze.x += -(pointer.x * 2 - 1) * .55; gaze.y += (1 - pointer.y * 2) * .7; }
    camera.position.lerp(gaze, 1 - Math.pow(.95, dt * 60));
    camera.lookAt(lookAt); camera.updateMatrixWorld(); group.updateMatrixWorld();
    projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    simulation.uniforms.cameraRotation.value.setFromMatrix4(camera.matrixWorld);
  }
  function advanceParticles(hz, healing = .5) {
    simulation.uniforms.source.value = positions.read.texture;
    simulation.uniforms.flow.value = velocity.read.texture;
    simulation.uniforms.time.value = elapsed;
    simulation.uniforms.hz.value = hz;
    simulation.uniforms.healing.value = healing;
    pass(simulation, positions.write); positions.swap(); pointMaterial.uniforms.positions.value = positions.read.texture;
  }
  function splatPointer() {
    if (!pointer.moved) return;
    const len = Math.hypot(pointer.dx * width, pointer.dy * height);
    if (len > .01) {
      const u = splat.uniforms;
      u.pointA.value.set(pointer.lastX, 1 - pointer.lastY); u.pointB.value.set(pointer.x, 1 - pointer.y);
      u.radius.value = Math.max(.008, Math.min(len / 5, 1) * .18 * (mobile ? .8 : 1));
      const mult = Math.min(len / 15, 1) * 10;
      u.source.value = velocity.read.texture; u.color.value.set(pointer.dx * width * mult, -pointer.dy * height * mult, 0);
      pass(splat, velocity.write); velocity.swap();
      u.source.value = density.read.texture; u.color.value.set(1, 1, 1); pass(splat, density.write); density.swap();
    }
    pointer.moved = false; pointer.dx = 0; pointer.dy = 0;
  }
  function advanceFluid(dt) {
    splatPointer();
    curl.uniforms.source.value = velocity.read.texture; pass(curl, curlTarget);
    vorticity.uniforms.source.value = velocity.read.texture; vorticity.uniforms.dt.value = dt; pass(vorticity, velocity.write); velocity.swap();
    divergence.uniforms.source.value = velocity.read.texture; pass(divergence, divergenceTarget);
    copy.uniforms.source.value = pressure.read.texture; copy.uniforms.fade.value = .95; pass(copy, pressure.write); pressure.swap();
    for (let i = 0; i < 5; i++) { solve.uniforms.source.value = pressure.read.texture; pass(solve, pressure.write); pressure.swap(); }
    gradient.uniforms.source.value = velocity.read.texture; gradient.uniforms.pressureMap.value = pressure.read.texture;
    pass(gradient, velocity.write); velocity.swap();
    const a = advection.uniforms; a.dt.value = dt; a.flow.value = velocity.read.texture; a.source.value = velocity.read.texture;
    a.sourceSize.value.set(simRes, simRes); a.fade.value = Math.pow(.98, dt * 60); pass(advection, velocity.write); velocity.swap();
    a.flow.value = velocity.read.texture; a.source.value = density.read.texture; a.sourceSize.value.set(dyeRes, dyeRes); a.fade.value = Math.pow(.97, dt * 60);
    pass(advection, density.write); density.swap(); mask.uniforms.source.value = density.read.texture; pass(mask, densityMask);
  }
  function draw() { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  function resize() {
    width = innerWidth; height = innerHeight;
    const changedLayout = smallLayout !== (width <= 760);
    smallLayout = width <= 760;
    renderer.setSize(width, height, false); camera.aspect = width / height;
    // Keep the sculpture behind the upper half of the mobile information panel.
    if (width <= 760) { camera.fov = 42; group.scale.set(3.6, 3.6, 4.2); group.position.set(.25, 1.0, -1.5); }
    else { camera.fov = 30; group.scale.set(5, 5, 6); group.position.set(.343, .16, -1); }
    camera.updateProjectionMatrix(); densityMask.setSize(Math.min(width, 1600), Math.min(height, 1200));
    splat.uniforms.aspect.value = width / height;
    cameraUpdate(1 / 60);
    if (points && !contextLost) {
      if (changedLayout) {
        createParticles(smallLayout ? 128 : adaptive || (navigator.hardwareConcurrency || 8) <= 4 ? 256 : 512);
        for (let i = 0; i < 40; i++) advanceParticles(1);
      }
      draw();
    }
  }
  function onPointer(event) {
    const now = performance.now();
    const x = event.clientX / width, y = event.clientY / height;
    if (!pointer.moved) { pointer.lastX = pointer.x; pointer.lastY = pointer.y; }
    if (now - pointer.stamp > 50) { pointer.lastX = x; pointer.lastY = y; }
    pointer.dx += x - pointer.x; pointer.dy += y - pointer.y;
    pointer.x = x; pointer.y = y; pointer.stamp = now; pointer.moved = true;
  }
  function frame(now) {
    frameId = 0;
    if (disposed || paused || document.hidden || contextLost) return;
    const rawDt = previousTime ? (now - previousTime) / 1000 : 1 / 60;
    const dt = Math.min(Math.max(rawDt, 1 / 120), 1 / 30); previousTime = now;
    elapsed += dt; cameraUpdate(dt); advanceFluid(dt);
    advanceParticles(dt * 60, elapsed < 3 ? .035 + elapsed / 3 * .465 : .5);
    pointMaterial.uniforms.time.value = elapsed; draw(); frames++;
    if (frames > 120 && rawDt > .055 && particleSide === 512) slowFrames++; else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 90 && !adaptive) {
      adaptive = true; createParticles(256); for (let i = 0; i < 35; i++) advanceParticles(1);
      window.dispatchEvent(new CustomEvent('axon:ready', { detail: { count: 65536, mode: 'gpu-adaptive' } }));
    }
    frameId = requestAnimationFrame(frame);
  }
  function start() { if (!frameId && !paused && !document.hidden && !disposed && !contextLost) { previousTime = 0; frameId = requestAnimationFrame(frame); } }
  function setPaused(value) {
    paused = Boolean(value); cancelAnimationFrame(frameId); frameId = 0;
    pointer.moved = false; pointer.dx = pointer.dy = 0;
    if (paused) draw(); else start();
  }
  const motionEvent = (event) => setPaused(event.detail?.paused);
  const reduceEvent = (event) => setPaused(event.matches);
  const visibility = () => { if (document.hidden) { cancelAnimationFrame(frameId); frameId = 0; } else start(); };
  const lost = (event) => { event.preventDefault(); contextLost = true; cancelAnimationFrame(frameId); frameId = 0; fallback('context-lost'); };
  const restored = () => { contextLost = false; document.documentElement.classList.remove('webgl-unavailable'); createParticles(particleSide); for (let i = 0; i < 40; i++) advanceParticles(1); draw(); start(); };
  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('pointerdown', onPointer, { passive: true });
  window.addEventListener('axon:motion', motionEvent);
  document.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', reduceEvent);
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  try {
    camera.position.copy(base); camera.lookAt(lookAt); camera.updateMatrixWorld();
    createParticles(particleSide); resize(); advanceFluid(1 / 60);
    if (paused) for (let i = 0; i < 50; i++) advanceParticles(1);
    draw(); start();
    document.documentElement.classList.add('webgl-ready');
    window.dispatchEvent(new CustomEvent('axon:ready', { detail: { count: particleSide * particleSide, mode: 'gpu' } }));
  } catch (error) { fallback('initialization-failed'); console.warn('Particle scene could not initialize.', error); }
  window.axonScene = {
    setPaused,
    diagnostics: () => ({ count: particleSide * particleSide, paused, frames, adaptive, webgl2, contextLost, fluidResolution: simRes, dyeResolution: dyeRes, drawCalls: renderer.info.render.calls }),
    destroy() {
      disposed = true; cancelAnimationFrame(frameId);
      window.removeEventListener('resize', resize); window.removeEventListener('pointermove', onPointer); window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('axon:motion', motionEvent); document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', reduceEvent);
      canvas.removeEventListener('webglcontextlost', lost); canvas.removeEventListener('webglcontextrestored', restored);
      resources.forEach(r => r.dispose()); renderer.dispose();
    }
  };
})();
