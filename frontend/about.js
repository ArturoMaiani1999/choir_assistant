(() => {
  'use strict';
  const scene = Lissajous.create(document.getElementById('about-canvas'), document.getElementById('about-glow'), {
    home:true, compact:true, duet:{duetEnabled:false}
  });
  // The shared renderer handles reduced motion, visibility and BFCache.
  window.addEventListener('pagehide', event => {
    if (!event.persisted) scene.destroy();
  });
})();
