(() => {
  'use strict';
  const menu = document.getElementById('piece-picker-dialog');
  const canvas = document.getElementById('home-canvas');
  const account = document.getElementById('home-settings');
  const trigger = account.querySelector('summary');
  const panel = document.getElementById('home-account-menu');
  const pause = document.getElementById('home-pause');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const events = new AbortController();
  const options = { signal:events.signal };
  const scene = Lissajous.create(canvas, document.getElementById('home-glow'), { home:true, active:false });

  function updatePause() {
    pause.textContent = scene.state.paused ? 'Riprendi animazione' : 'Pausa animazione';
    pause.setAttribute('aria-pressed', String(scene.state.paused));
  }
  function closeAccount(restoreFocus = false) {
    account.open = false;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({preventScroll:true});
  }
  function sync() {
    const active = menu.open && !document.querySelector('dialog[open]:not(#piece-picker-dialog)');
    scene.setActive(active);
    menu.dataset.intro = 'skip'; // Navigation is available immediately, also on first entry.
    if (!active) closeAccount();
  }
  const items = () => [...panel.querySelectorAll('button,a')];
  account.addEventListener('toggle', () => trigger.setAttribute('aria-expanded', String(account.open)), options);
  account.addEventListener('keydown', event => {
    const controls = items();
    const index = controls.indexOf(document.activeElement);
    if (event.key === 'Escape' && account.open) {
      event.preventDefault();event.stopPropagation();closeAccount(true);
    } else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();account.open = true;trigger.setAttribute('aria-expanded', 'true');
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length-1
        : event.key === 'ArrowDown' ? (index+1)%controls.length : index<0 ? controls.length-1 : (index-1+controls.length)%controls.length;
      controls[next].focus();
    }
  }, options);
  account.addEventListener('focusout', event => {
    if (!account.contains(event.relatedTarget)) closeAccount();
  }, options);
  document.addEventListener('pointerdown', event => { if (!account.contains(event.target)) closeAccount(); }, options);
  // Capture the return target before the existing app listeners open a dialog.
  panel.addEventListener('click', event => {
    if (event.target.closest('#library-profile,#home-basic,#home-advanced,#home-sign-out,a')) closeAccount(true);
  }, { ...options, capture:true });
  document.getElementById('home-sign-out').addEventListener('click', () => {
    document.getElementById('settings-menu-account').click();
  }, options);
  pause.addEventListener('click', () => { scene.setPaused(!scene.state.paused);updatePause(); }, options);
  reduced.addEventListener('change', event => {
    if (event.matches) scene.setPaused(true);
    updatePause();
  }, options);
  menu.addEventListener('click', event => {
    if (event.target === menu && menu.querySelector('#library-close:not([hidden])')) menu.close();
  }, options);
  const observer = new MutationObserver(records => {
    if (records.some(record => record.target.tagName === 'DIALOG')) sync();
  });
  observer.observe(document.body, { subtree:true, attributes:true, attributeFilter:['open'] });
  window.addEventListener('pagehide', event => {
    scene.setActive(false);
    if (!event.persisted) { observer.disconnect();events.abort();scene.destroy(); }
  }, options);
  window.addEventListener('pageshow', sync, options);
  updatePause();sync();
})();
