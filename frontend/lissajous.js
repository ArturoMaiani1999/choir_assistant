/* Shared 3D Lissajous scene. Time and tail age are measured in real seconds. */
'use strict';
window.Lissajous = Object.freeze({ create(canvas, glow, { home = false, compact = false, fresh = false, active = true, duet = {} } = {}) {
  const output = canvas.getContext('2d', { alpha: true });
  // Resolve supersampling explicitly. CSS downscaling alone may use a simple
  // compositor filter and turn very thin bright filaments into moiré.
  const surface = document.createElement('canvas');
  const context = surface.getContext('2d', { alpha: true });
  const light = glow.getContext('2d', { alpha: true });
  const BASE_SPEED = .5, SPEED = BASE_SPEED*.5, PERIOD = 6.4;
  // Doubling the trail lifetime preserves its geometric length at half speed.
  const TAIL_SECONDS = 40, CAMERA_MULTIPLIER = 1.3;
  const HOME_ROTATION_MULTIPLIER = 5/3;
  const INITIAL_TIME = fresh ? 0 : 20.8, BASE_YAW_SPEED = BASE_SPEED*.045;
  const YAW_SPEED = BASE_YAW_SPEED*(home ? HOME_ROTATION_MULTIPLIER : 1)*CAMERA_MULTIPLIER;
  // Keep the initial camera pose when changing only the Home rotation rate.
  const YAW_START = .67+INITIAL_TIME*(BASE_YAW_SPEED-YAW_SPEED), TURN = Math.PI*2;
  const duetConfig = Object.freeze({
    duetEnabled:true, duetDurationMs:5000,
    // x = sin(t)*(cos(yaw)+3*sin(yaw)-4*sin(yaw)*sin(t)^2).
    // This tangent contact, not yaw=90°, matches the two upright friends.
    duetTriggerAngle:Math.PI-Math.atan(1/3),
    settleMs:400, resumeMs:500, fadeOutMs:500,
    swayAmplitude:3*Math.PI/180, swayFrequency:.38,
    faceScale:.34, faceOpacity:.8, singingIntensity:.4, ...duet
  });
  const PALETTE = [[113,205,220],[151,213,175],[198,220,126],[239,194,119],[227,143,169],[179,149,220]];
  // Home keeps the original 3D motion and ribbons, using only rehearsal colours.
  let homeColors = [];
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = true, destroyed = false, pageHidden = false;
  const state = { time: INITIAL_TIME, paused: matchMedia('(prefers-reduced-motion: reduce)').matches,
    active, last: null, frame: 0, width: 0, height: 0, ratio: 1,
    yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, pointer: null };
  const duetState = state.duet = { phase:'ROTATING', elapsedMs:0, approachMs:0, count:0 };
  const triggerTime = (duetConfig.duetTriggerAngle-YAW_START)/YAW_SPEED;
  const turnSeconds = TURN/YAW_SPEED;
  let nextDuetTime = followingDuetTime();
  const angles = {}, sample = {}, warped = {};
  const lobeBounds = [{},{}], faces = [{},{}], sway = [0,0];
  let faceEnvelope = 0;
  // A fixed parameter grid avoids resampling the whole trail as its ends move.
  const SAMPLES = 1024, STEP = TURN/SAMPLES, omega = TURN/PERIOD;
  const geometry = Array.from({length:SAMPLES+1},()=>({}));
  const points = Array.from({length:Math.ceil(TAIL_SECONDS*SPEED*omega/STEP)+3},()=>({}));
  const tangentBefore = {}, tangentAfter = {};
  const strands=[[-8,.22,.55],[-5,.35,.65],[-2.5,.55,.85],[0,1,1.85],[2.5,.55,.85],[5,.35,.65],[8,.22,.55]];
  const smooth = value => { const u=Math.max(0,Math.min(1,value));return u*u*(3-2*u); };

  function followingDuetTime() {
    return triggerTime + Math.max(0,Math.floor((state.time-triggerTime)/turnSeconds)+1)*turnSeconds;
  }

  function resetDuet() {
    duetState.phase='ROTATING';duetState.elapsedMs=0;duetState.approachMs=0;
    nextDuetTime=followingDuetTime();
  }

  function advance(seconds) {
    if (!home || !duetConfig.duetEnabled || motion.matches) { state.time+=seconds;return; }
    // Consume time at state boundaries too: dropped frames cannot skip or
    // retrigger the scene. Only active, visible RAF time reaches this clock.
    let remaining=seconds*1000;
    while (remaining>0) {
      if (duetState.phase==='ROTATING') {
        const brakeStart=nextDuetTime-duetConfig.settleMs/2000;
        const cruise=Math.min(remaining,Math.max(0,(brakeStart-state.time)*1000));
        state.time+=cruise/1000;remaining-=cruise;
        if (remaining<=0) break;
        const step=Math.min(remaining,duetConfig.settleMs-duetState.approachMs);
        duetState.approachMs+=step;remaining-=step;
        const u=duetState.approachMs/duetConfig.settleMs;
        state.time=brakeStart+duetConfig.settleMs/2000*(u+Math.sin(Math.PI*u)/Math.PI);
        if (duetState.approachMs>=duetConfig.settleMs) {
          state.time=nextDuetTime;duetState.phase='DUET';duetState.elapsedMs=0;duetState.count++;
        }
      } else if (duetState.phase==='DUET') {
        const step=Math.min(remaining,duetConfig.duetDurationMs-duetState.elapsedMs);
        duetState.elapsedMs+=step;remaining-=step;
        if (duetState.elapsedMs>=duetConfig.duetDurationMs) {
          duetState.phase='RESUMING';duetState.elapsedMs=0;
        }
      } else {
        const step=Math.min(remaining,duetConfig.resumeMs-duetState.elapsedMs);
        duetState.elapsedMs+=step;remaining-=step;
        const u=duetState.elapsedMs/duetConfig.resumeMs;
        state.time=nextDuetTime+duetConfig.resumeMs/2000*(u-Math.sin(Math.PI*u)/Math.PI);
        if (duetState.elapsedMs>=duetConfig.resumeMs) {
          duetState.phase='ROTATING';duetState.elapsedMs=0;duetState.approachMs=0;
          nextDuetTime+=turnSeconds;
        }
      }
    }
  }

  function project(t, angles, out) {
    // These three coordinates stay exact; the view only rotates and projects them.
    const x = Math.sin(t), y = Math.sin(2*t), z = Math.sin(3*t);
    const a = x*angles.cy + z*angles.sy;
    const b = z*angles.cy - x*angles.sy;
    const v = y*angles.cp - b*angles.sp;
    const depth = y*angles.sp + b*angles.cp;
    const perspective = 4.8/(4.8-depth);
    out.x=a*perspective;out.y=-v*perspective;out.z=depth;
    return out;
  }

  function deform(x,y,lobe,out) {
    // C1 continuous across the shared tangent: both displacement and its
    // derivative vanish at x=0. No separate transforms of disconnected lobes.
    const angle=sway[lobe]*smooth(Math.abs(x)/.65), c=Math.cos(angle), s=Math.sin(angle);
    out.x=x*c-y*s;out.y=x*s+y*c;out.angle=angle;
    return out;
  }

  function positioned(t,out) {
    project(t,angles,out);
    if(faceEnvelope)deform(out.x,out.y,Math.sin(t)>=0?0:1,out);
    return out;
  }

  function ribbonPath(target,start,end,offset,width,scale) {
    target.beginPath();
    for(let i=start;i<=end;i++) {
      const p=points[i],distance=offset*p.ribbon*scale+width*p.fade/2;
      const x=p.x+p.nx*distance,y=p.y+p.ny*distance;
      if(i===start)target.moveTo(x,y);else target.lineTo(x,y);
    }
    for(let i=end;i>=start;i--) {
      const p=points[i],distance=offset*p.ribbon*scale-width*p.fade/2;
      target.lineTo(p.x+p.nx*distance,p.y+p.ny*distance);
    }
    target.closePath();target.fill();
  }

  function drawFaces(scale,centerX,centerY) {
    if (!faceEnvelope) return;
    for (let lobe=0;lobe<2;lobe++) {
      const box=lobeBounds[lobe], face=faces[lobe];
      const size=(box.right-box.left)*duetConfig.faceScale;
      // The taller amber lobe needs a lower face to feel centred in its body.
      deform((box.left+box.right)/2,box.top+(box.bottom-box.top)*(lobe ? .40 : .28),lobe,face);
      const pixels=size*scale;
      const singing=(.5-.5*Math.cos(duetState.elapsedMs/1000*TURN*(lobe ? .52 : .61)+lobe*.9))*duetConfig.singingIntensity;
      context.save();
      context.translate(centerX+face.x*scale,centerY+face.y*scale);
      context.rotate(face.angle);context.scale(pixels,pixels);
      context.strokeStyle=`rgba(${homeColors[lobe]},${faceEnvelope*duetConfig.faceOpacity})`;
      context.lineWidth=Math.max(1,pixels*.023)/pixels;
      context.beginPath();
      context.moveTo(-.36,-.04);context.quadraticCurveTo(-.24,-.23,-.12,-.04);
      context.moveTo(.12,-.04);context.quadraticCurveTo(.24,-.23,.36,-.04);
      context.moveTo(-.14,.19);
      context.bezierCurveTo(-.08,.31+singing*.10,.08,.31+singing*.10,.14,.19);
      context.bezierCurveTo(.08,.31-singing*.30,-.08,.31-singing*.30,-.14,.19);
      context.stroke();context.restore();
    }
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
    const yaw=YAW_START+state.time*YAW_SPEED+state.yaw;
    const cameraTime=INITIAL_TIME+(state.time-INITIAL_TIME)*CAMERA_MULTIPLIER;
    const pitch=-.32+Math.sin(cameraTime*BASE_SPEED*.033)*.16+state.pitch;
    angles.cy=Math.cos(yaw);angles.sy=Math.sin(yaw);angles.cp=Math.cos(pitch);angles.sp=Math.sin(pitch);
    faceEnvelope=home && duetState.phase==='DUET' && !motion.matches
      ? smooth(duetState.elapsedMs/duetConfig.settleMs)*smooth((duetConfig.duetDurationMs-duetState.elapsedMs)/duetConfig.fadeOutMs) : 0;
    for(let i=0;i<2;i++) {
      sway[i]=faceEnvelope*duetConfig.swayAmplitude*Math.sin(duetState.elapsedMs/1000*TURN*duetConfig.swayFrequency+i*.32);
      const box=lobeBounds[i];box.left=box.top=Infinity;box.right=box.bottom=-Infinity;
    }
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for(let i=0;i<=SAMPLES;i++) {
      const t=i*STEP, p=project(t,angles,sample), point=geometry[i];
      left=Math.min(left,p.x);right=Math.max(right,p.x);top=Math.min(top,p.y);bottom=Math.max(bottom,p.y);
      if (faceEnvelope) {
        const box=lobeBounds[Math.sin(t)>=0?0:1];
        box.left=Math.min(box.left,p.x);box.right=Math.max(box.right,p.x);
        box.top=Math.min(box.top,p.y);box.bottom=Math.max(box.bottom,p.y);
      }
      if(faceEnvelope)deform(p.x,p.y,Math.sin(t)>=0?0:1,warped);
      point.x=faceEnvelope?warped.x:p.x;point.y=faceEnvelope?warped.y:p.y;
      point.z=p.z;point.t=t;point.ribbon=.75+.2*Math.sin(t*2);
    }
    const padding=home?compact?4:Math.min(30,Math.min(width,height)*.12):0;
    const usableHeight=height-(home?padding*2:height<500?130:width<600?290:215);
    const usableWidth=width-(home?padding*2:width<600?36:160);
    const scale=Math.min(usableWidth/(right-left),usableHeight/(bottom-top))*(compact ? .98 : .9);
    const centerX=width/2-(left+right)/2*scale;
    const centerY=(home?height/2:height*(width<600&&height>500?.435:.48))-(top+bottom)/2*scale;
    for(let i=0;i<=SAMPLES;i++) {
      geometry[i].x=centerX+geometry[i].x*scale;
      geometry[i].y=centerY+geometry[i].y*scale;
    }
    for(let i=0;i<=SAMPLES;i++) {
      const a=geometry[(i+SAMPLES-1)%SAMPLES],b=geometry[(i+1)%SAMPLES];
      const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
      geometry[i].nx=-dy/length;geometry[i].ny=dx/length;
    }
    const headT=(INITIAL_TIME*BASE_SPEED+(state.time-INITIAL_TIME)*SPEED)*omega;
    const trailSeconds=fresh?Math.min(TAIL_SECONDS,state.time):TAIL_SECONDS;
    const tailT=headT-trailSeconds*SPEED*omega;
    const firstGrid=Math.floor(tailT/STEP)+1, lastGrid=Math.ceil(headT/STEP)-1;
    const count=Math.max(0,lastGrid-firstGrid+1)+2;
    for(let i=0;i<count;i++) {
      const grid=firstGrid+i-1;
      const t=i===0?tailT:i===count-1?headT:grid*STEP;
      const age=(headT-t)/(SPEED*omega);
      const point=points[i];
      if(i>0 && i<count-1) {
        const p=geometry[((grid%SAMPLES)+SAMPLES)%SAMPLES];
        point.x=p.x;point.y=p.y;point.z=p.z;point.nx=p.nx;point.ny=p.ny;
      } else {
        positioned(t,sample);
        point.x=centerX+sample.x*scale;point.y=centerY+sample.y*scale;point.z=sample.z;
        positioned(t-STEP/2,tangentBefore);positioned(t+STEP/2,tangentAfter);
        const dx=tangentAfter.x-tangentBefore.x,dy=tangentAfter.y-tangentBefore.y,length=Math.hypot(dx,dy)||1;
        point.nx=-dy/length;point.ny=dx/length;
      }
      point.t=t;
      point.grid=grid;point.ribbon=.75+.2*Math.sin(t*2);
      // Width tends continuously to zero; no per-run alpha mask or butt caps.
      point.fade=Math.pow(Math.max(0,1-age/TAIL_SECONDS),.85)*(.72+.28*(point.z+1.8)/3.6);
    }
    context.globalCompositeOperation='lighter';
    light.globalCompositeOperation='lighter';
    context.lineCap=light.lineCap='round';context.lineJoin=light.lineJoin='round';
    const ribbonScale=home?Math.min(1,Math.min(width,height)/450):1;
    const sections=home?2:PALETTE.length;
    // One unbroken filament per lobe, independent of the travelling highlight.
    if(!fresh || trailSeconds>=PERIOD/SPEED)for(let section=0;section<sections;section++) {
      const start=Math.round(section*SAMPLES/sections),end=Math.round((section+1)*SAMPLES/sections);
      const a=geometry[start],b=geometry[end];
      let ink;
      if(home)ink=`rgb(${homeColors[section]})`;
      else {
        ink=context.createLinearGradient(a.x,a.y,b.x,b.y);
        ink.addColorStop(0,`rgb(${color(a.t)})`);ink.addColorStop(1,`rgb(${color(b.t)})`);
      }
      context.strokeStyle=ink;
      for(const [offset,strength,weight] of strands) {
        context.globalAlpha=strength*.17;context.lineWidth=weight*Math.max(.7,ribbonScale);
        context.beginPath();
        for(let i=start;i<=end;i++) {
          const p=geometry[i],distance=offset*p.ribbon*ribbonScale;
          const x=p.x+p.nx*distance,y=p.y+p.ny*distance;
          if(i===start)context.moveTo(x,y);else context.lineTo(x,y);
        }
        context.stroke();
      }
    }
    // The trail is a tapered filled ribbon, never a chain of small strokes.
    // Home changes colour only at the exact half-wave boundary.
    let runStart=0;
    for(let end=1;end<count;end++) {
      const sectionSteps=home?SAMPLES/2:Math.round(SAMPLES/PALETTE.length);
      if(end!==count-1 && points[end].grid%sectionSteps!==0)continue;
      const a=points[runStart],b=points[end];
      const startColor=home?color((a.t+b.t)/2):color(a.t);
      const endColor=home?startColor:color(b.t);
      let ink=`rgb(${startColor})`,glowInk=ink;
      if(!home) {
        ink=context.createLinearGradient(a.x,a.y,b.x,b.y);
        glowInk=light.createLinearGradient(a.x,a.y,b.x,b.y);
        ink.addColorStop(0,`rgb(${startColor})`);ink.addColorStop(1,`rgb(${endColor})`);
        glowInk.addColorStop(0,`rgb(${startColor})`);glowInk.addColorStop(1,`rgb(${endColor})`);
      }
      context.fillStyle=ink;light.fillStyle=glowInk;light.globalAlpha=.24;
      ribbonPath(light,runStart,end,0,16*ribbonScale,ribbonScale);
      for(const [offset,strength,weight] of strands) {
        context.globalAlpha=strength*.68;
        ribbonPath(context,runStart,end,offset,weight*Math.max(.7,ribbonScale),ribbonScale);
      }
      runStart=end;
    }
    context.globalAlpha=light.globalAlpha=1;
    context.globalCompositeOperation='source-over';context.lineCap='round';
    const head=points[count-1];
    context.fillStyle=home?`rgb(${color(head.t)})`:'#f5e8cb';context.beginPath();context.arc(head.x,head.y,1.65,0,Math.PI*2);context.fill();
    drawFaces(scale,centerX,centerY);
    output.clearRect(0,0,width,height);
    output.drawImage(surface,0,0,surface.width,surface.height,0,0,width,height);
    canvas.dataset.time=state.time.toFixed(3);
    canvas.dataset.tailSeconds=String(TAIL_SECONDS);
    canvas.dataset.speed=String(SPEED);
    canvas.dataset.oldestTime=(state.time-trailSeconds).toFixed(3);
    canvas.dataset.headParameter=headT.toFixed(6);
    canvas.dataset.cameraYaw=yaw.toFixed(6);
    canvas.dataset.cameraSpeed=String(YAW_SPEED);
    canvas.dataset.renderRatio=state.ratio.toFixed(3);
    if(home) {
      canvas.dataset.duetPhase=duetState.phase;
      canvas.dataset.duetElapsed=duetState.elapsedMs.toFixed(1);
      canvas.dataset.duetCount=String(duetState.count);
    }
  }

  function tick(timestamp) {
    state.frame=0;
    if(destroyed || pageHidden || state.paused || !state.active || !visible || document.hidden) { state.last=null;return; }
    if(state.last!==null) advance(Math.max(0,(timestamp-state.last)/1000));
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
    // Supersample even on 1x displays. Cap both density and total pixel memory.
    const desired=Math.max(2,(devicePixelRatio||1)*1.25);
    state.ratio=Math.min(desired,4,Math.sqrt(8_000_000/Math.max(1,bounds.width*bounds.height)));
    surface.width=Math.round(bounds.width*state.ratio);surface.height=Math.round(bounds.height*state.ratio);
    context.setTransform(state.ratio,0,0,state.ratio,0,0);
    const nativeRatio=Math.min(devicePixelRatio||1,4,Math.sqrt(8_000_000/Math.max(1,bounds.width*bounds.height)));
    canvas.width=Math.round(bounds.width*nativeRatio);canvas.height=Math.round(bounds.height*nativeRatio);
    output.setTransform(nativeRatio,0,0,nativeRatio,0,0);
    output.imageSmoothingEnabled=true;output.imageSmoothingQuality='high';
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
  function motionChange(event) {
    // Explicit playback under reduced motion may have passed a trigger. Rearm
    // from the current time on either preference change, without rewinding.
    resetDuet();if(event.matches)setPaused(true);
  }
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
    surface.width=surface.height=0;
    document.removeEventListener('visibilitychange', visibilityChange);
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', pageShow);
    motion.removeEventListener('change', motionChange);
  }
  resize(); start();
  return { state, render, resize, start, setPaused, setActive, destroy };
} });
