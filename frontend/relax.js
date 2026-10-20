(() => {
  'use strict';

  const canvas = document.getElementById('relax-canvas');
  const glow = document.getElementById('relax-glow');
  const scene = Lissajous.create(canvas, glow);
  const { state, render, start } = scene;
  const pause = document.getElementById('relax-pause');
  const fullscreen = document.getElementById('relax-fullscreen');
  const back = document.getElementById('relax-back');
  const details = document.getElementById('relax-details');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let idleTimer;
  // A destination is always one of our own rehearsal surfaces.
  const requestedReturn = new URLSearchParams(location.search).get('return');
  let returnUrl = new URL('index.html', location.href);
  if (requestedReturn) {
    try {
      const candidate = new URL(requestedReturn, location.href);
      if (candidate.origin === location.origin && ['/index.html', '/', '/voice-lab.html'].includes(candidate.pathname)) returnUrl = candidate;
    } catch (_) {}
  }
  back.href = returnUrl.pathname + returnUrl.search + returnUrl.hash;
  if (returnUrl.pathname === '/voice-lab.html') back.textContent = 'Torna agli esercizi';
  else if (returnUrl.searchParams.has('piece')) back.textContent = 'Torna alla prova';
  back.addEventListener('click', event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    try {
      const previous = new URL(document.referrer);
      if (requestedReturn && previous.origin === location.origin && previous.pathname === returnUrl.pathname && history.length > 1) {
        event.preventDefault(); history.back();
      }
    } catch (_) {}
  });

  function wake() {
    document.body.dataset.idle = 'false';
    clearTimeout(idleTimer);
    if (!state.paused && !reducedMotion.matches) idleTimer = setTimeout(() => {
      if (!details.open && !document.querySelector('.relax-controls:focus-within')) document.body.dataset.idle = 'true';
    }, 6500);
  }

  function updateControls() {
    pause.textContent = state.paused ? 'Riprendi' : 'Pausa';
    pause.setAttribute('aria-pressed', String(state.paused));
    document.body.dataset.paused = String(state.paused);
    wake();
  }

  function setPaused(value) { scene.setPaused(value); updateControls(); }

  pause.addEventListener('click',()=>setPaused(!state.paused));
  fullscreen.hidden=!document.documentElement.requestFullscreen;
  fullscreen.addEventListener('click',async()=>{
    try {if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
    catch(_){document.getElementById('relax-status').textContent='Schermo intero non disponibile.';}
  });
  document.addEventListener('fullscreenchange',()=>{fullscreen.textContent=document.fullscreenElement?'Esci da schermo intero':'Schermo intero';wake();});
  document.addEventListener('keydown',event=>{
    wake();
    if(event.key==='Escape') {
      if(details.open){event.preventDefault();details.open=false;details.querySelector('summary').focus();}
      else if(!document.fullscreenElement)back.click();
    }
    if(event.code==='Space'&&!event.target.closest('button,a,summary,input')){event.preventDefault();setPaused(!state.paused);}
    if(event.target===canvas && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
      event.preventDefault();
      if(event.key==='ArrowLeft')state.targetYaw-=.12;
      if(event.key==='ArrowRight')state.targetYaw+=.12;
      if(event.key==='ArrowUp')state.targetPitch=Math.max(-1.1,state.targetPitch-.1);
      if(event.key==='ArrowDown')state.targetPitch=Math.min(1.1,state.targetPitch+.1);
      if(state.paused){state.yaw=state.targetYaw;state.pitch=state.targetPitch;render();}
    }
  });
  document.addEventListener('pointerdown',event=>{wake();if(!details.contains(event.target))details.open=false;});
  document.addEventListener('pointermove',wake,{passive:true});
  document.addEventListener('focusin',wake);
  canvas.addEventListener('pointerdown',event=>{
    state.pointer={id:event.pointerId,x:event.clientX,y:event.clientY,yaw:state.targetYaw,pitch:state.targetPitch};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!state.pointer || event.pointerId!==state.pointer.id)return;
    state.targetYaw=state.pointer.yaw+(event.clientX-state.pointer.x)*.004;
    state.targetPitch=Math.max(-1.1,Math.min(1.1,state.pointer.pitch+(event.clientY-state.pointer.y)*.003));
    if(state.paused){state.yaw=state.targetYaw;state.pitch=state.targetPitch;render();}
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,()=>{state.pointer=null;});
  details.addEventListener('toggle',wake);
  reducedMotion.addEventListener('change',event=>{if(event.matches)setPaused(true);});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){if(state.frame)cancelAnimationFrame(state.frame);state.frame=0;state.last=null;clearTimeout(idleTimer);}
    else{wake();start();}
  });
  window.addEventListener('pagehide',()=>{if(state.frame)cancelAnimationFrame(state.frame);state.frame=0;clearTimeout(idleTimer);});
  window.addEventListener('pageshow',()=>{wake();start();});
  updateControls();
})();
