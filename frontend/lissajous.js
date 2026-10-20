/* Shared 3D Lissajous scene. Time and tail age are measured in real seconds. */
'use strict';
window.Lissajous = Object.freeze({ create(canvas, glow, { home = false, fresh = false, active = true } = {}) {
  const context = canvas.getContext('2d', { alpha: true });
  const light = glow.getContext('2d', { alpha: true });
  const TAIL_SECONDS = 20, SPEED = .5, PERIOD = 6.4;
  const PALETTE = [[113,205,220],[151,213,175],[198,220,126],[239,194,119],[227,143,169],[179,149,220]];
  // Home keeps the original 3D motion and ribbons, using only rehearsal colours.
  let homeColors = [];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = true, destroyed = false, pageHidden = false;
  const state = { time: fresh ? 0 : 20.8, paused: matchMedia('(prefers-reduced-motion: reduce)').matches,
    active, last: null, frame: 0, width: 0, height: 0, ratio: 1,
    yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, pointer: null };
  function project(t, angles) {
    // These three coordinates stay exact; the view only rotates and projects them.
    const x = Math.sin(t), y = Math.sin(2*t), z = Math.sin(3*t);
    const a = x*angles.cy + z*angles.sy;
    const b = z*angles.cy - x*angles.sy;
    const v = y*angles.cp - b*angles.sp;
    const depth = y*angles.sp + b*angles.cp;
    const perspective = 4.8/(4.8-depth);
    return { x: a*perspective, y: -v*perspective, z: depth };
  }

  function color(t) {
    if (home) return homeColors[Math.sin(t) >= 0 ? 0 : 1];
    const cycle = ((t/(Math.PI*2) + .15)%1 + 1)%1 * PALETTE.length;
    const index = Math.floor(cycle), fraction = cycle-index;
    const a=PALETTE[index], b=PALETTE[(index+1)%PALETTE.length];
    return a.map((value,i)=>Math.round(value+(b[i]-value)*fraction)).join(',');
  }

  function render() {
    const { width, height } = state;
    if (!width || !height || !context || !light) return;
    context.clearRect(0,0,width,height);
    light.clearRect(0,0,width,height);
    const yaw=.67+state.time*SPEED*.045+state.yaw, pitch=-.32+Math.sin(state.time*SPEED*.033)*.16+state.pitch;
    const angles={cy:Math.cos(yaw),sy:Math.sin(yaw),cp:Math.cos(pitch),sp:Math.sin(pitch)};
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for(let i=0;i<=160;i++) {
      const p=project(i/160*Math.PI*2,angles);
      left=Math.min(left,p.x);right=Math.max(right,p.x);top=Math.min(top,p.y);bottom=Math.max(bottom,p.y);
    }
    const padding=home?Math.min(30,Math.min(width,height)*.12):0;
    const usableHeight=height-(home?padding*2:height<500?130:width<600?290:215);
    const usableWidth=width-(home?padding*2:width<600?36:160);
    const scale=Math.min(usableWidth/(right-left),usableHeight/(bottom-top))*.9;
    const centerX=width/2-(left+right)/2*scale;
    const centerY=(home?height/2:height*(width<600&&height>500?.435:.48))-(top+bottom)/2*scale;
    const count=width<600?500:720, points=[], omega=Math.PI*2/PERIOD;
    for(let i=0;i<=count;i++) {
      const age=Math.min(TAIL_SECONDS,state.time)*(1-i/count), t=(state.time-age)*SPEED*omega;
      const p=project(t,angles);
      points.push({x:centerX+p.x*scale,y:centerY+p.y*scale,z:p.z,t,
        alpha:Math.pow(Math.max(0,1-age/TAIL_SECONDS),.8)*(.72+.28*(p.z+1.8)/3.6)});
    }
    const segments=[];
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
      segments.push({a,b,nx:-dy/length,ny:dx/length,z:(a.z+b.z)/2,color:color(b.t)});
    }
    segments.sort((a,b)=>a.z-b.z);
    context.globalCompositeOperation='source-over';
    light.globalCompositeOperation='lighter';
    context.lineCap='round';light.lineCap='round';
    const strands=[[-8,.22,.55],[-5,.35,.65],[-2.5,.55,.85],[0,1,1.85],[2.5,.55,.85],[5,.35,.65],[8,.22,.55]];
    const ribbonScale=home?Math.min(1,Math.min(width,height)/450):1;
    for(const s of segments) {
      const alpha=s.b.alpha;
      light.strokeStyle=`rgba(${s.color},${alpha*.33})`;light.lineWidth=16*ribbonScale;
      light.beginPath();light.moveTo(s.a.x,s.a.y);light.lineTo(s.b.x,s.b.y);light.stroke();
      for(const [offset,strength,weight] of strands) {
        const ribbon=offset*(.75+.2*Math.sin(s.b.t*2))*ribbonScale;
        context.strokeStyle=`rgba(${s.color},${alpha*strength})`;context.lineWidth=weight*Math.max(.7,ribbonScale);
        context.beginPath();context.moveTo(s.a.x+s.nx*ribbon,s.a.y+s.ny*ribbon);
        context.lineTo(s.b.x+s.nx*ribbon,s.b.y+s.ny*ribbon);context.stroke();
      }
    }
    const head=points.at(-1);
    context.fillStyle=home?`rgb(${color(head.t)})`:'#f5e8cb';context.beginPath();context.arc(head.x,head.y,1.65,0,Math.PI*2);context.fill();
    canvas.dataset.time=state.time.toFixed(3);
    canvas.dataset.tailSeconds=String(TAIL_SECONDS);
    canvas.dataset.speed=String(SPEED);
    canvas.dataset.oldestTime=Math.max(0,state.time-TAIL_SECONDS).toFixed(3);
  }

  function tick(timestamp) {
    state.frame=0;
    if(destroyed || pageHidden || state.paused || !state.active || !visible || document.hidden) { state.last=null;return; }
    if(state.last!==null) state.time+=Math.max(0,(timestamp-state.last)/1000);
    state.last=timestamp;
    state.yaw+=(state.targetYaw-state.yaw)*.045;state.pitch+=(state.targetPitch-state.pitch)*.045;
    render();
    state.frame=requestAnimationFrame(tick);
  }

  function start() {
    if(!destroyed && !pageHidden && !state.paused && state.active && visible && !document.hidden && !state.frame) {state.last=null;state.frame=requestAnimationFrame(tick);}
  }

  function setPaused(value) {
    state.paused=value;
    if(state.frame)cancelAnimationFrame(state.frame);
    state.frame=0;state.last=null;render();start();
  }

  function resize() {
    if (destroyed) return;
    const bounds=canvas.getBoundingClientRect();state.width=bounds.width;state.height=bounds.height;
    if (home) {
      const tokens = getComputedStyle(canvas);
      homeColors = ['--home-voice','--home-target'].map(name => {
        // Product tokens are six-digit hex; convert once per resize for RGBA strokes.
        const hex = tokens.getPropertyValue(name).trim().slice(1);
        return [0,2,4].map(offset => parseInt(hex.slice(offset,offset+2),16)).join(',');
      });
    }
    state.ratio=Math.min(devicePixelRatio||1,innerWidth<600?1.5:2);
    canvas.width=Math.round(bounds.width*state.ratio);canvas.height=Math.round(bounds.height*state.ratio);
    context.setTransform(state.ratio,0,0,state.ratio,0,0);
    const glowRatio=.65;
    glow.width=Math.round(bounds.width*glowRatio);glow.height=Math.round(bounds.height*glowRatio);
    light.setTransform(glowRatio,0,0,glowRatio,0,0);
    render();
  }


  function setActive(value) {
    state.active = value;
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0; state.last = null;
    if (value) { resize(); start(); }
  }
  function suspend() { if(state.frame)cancelAnimationFrame(state.frame);state.frame=0;state.last=null; }
  function visibilityChange() { if(document.hidden)suspend();else start(); }
  function pageHide() { pageHidden=true;suspend(); }
  function pageShow() { pageHidden=false;start(); }
  function motionChange(event) { if(event.matches)setPaused(true); }
  document.addEventListener('visibilitychange', visibilityChange);
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  motion.addEventListener('change', motionChange);
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(canvas);
  const intersection = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if(visible)start();else suspend();
  });
  intersection.observe(canvas);
  function destroy() {
    destroyed=true;suspend();sizeObserver.disconnect();intersection.disconnect();
    document.removeEventListener('visibilitychange', visibilityChange);
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', pageShow);
    motion.removeEventListener('change', motionChange);
  }
  resize(); start();
  return { state, render, resize, start, setPaused, setActive, destroy };
} });
