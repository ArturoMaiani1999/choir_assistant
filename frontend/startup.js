/* Small synchronous watchdog: runs before the large deferred/module bundles. */
(() => {
  'use strict';
  const mode = document.currentScript.dataset.startup;
  let done = false, failed = false, failureMessage = '', panel = null;
  const inertStates = new Map();
  const protect = new MutationObserver(() => {
    for (const child of document.body.children) {
      if (child === panel || ['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName) || inertStates.has(child)) continue;
      inertStates.set(child, child.inert); child.inert = true;
    }
  });
  function attach() {
    if (done || !document.body) return;
    panel = document.createElement('section');
    panel.id = 'startup-status';
    panel.setAttribute('aria-label', 'Caricamento');
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Caricamento…';
    const retry = document.createElement('button');
    retry.type = 'button'; retry.textContent = 'Riprova'; retry.hidden = true;
    retry.addEventListener('click', () => location.reload());
    panel.append(status, retry);
    if (mode === 'auth') document.querySelector('#auth-status').after(panel);
    else {
      document.body.append(panel);
      protect.observe(document.body, { childList: true });
      // Trigger the same protection for any body content already present.
      for (const child of document.body.children) {
        if (child !== panel && !['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName)) {
          inertStates.set(child, child.inert); child.inert = true;
        }
      }
    }
    if (failed) showFailure();
  }
  function showFailure() {
    if (!panel) return;
    panel.dataset.failed = 'true';
    if (mode === 'auth') document.querySelector('#auth-status').hidden = true;
    panel.querySelector('p').textContent = failureMessage;
    panel.querySelector('button').hidden = false;
  }
  function fail(message = 'Caricamento non riuscito.') {
    if (!done) { failed = true; failureMessage = message; showFailure(); }
  }
  const observer = new MutationObserver(() => {
    if (document.body && (mode !== 'auth' || document.querySelector('#auth-status'))) {
      observer.disconnect(); attach();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const timer = setTimeout(() => fail('Il caricamento richiede troppo tempo.'), 15_000);
  window.ChoirStartup = Object.freeze({
    ready() {
      done = true; clearTimeout(timer); observer.disconnect(); protect.disconnect(); panel?.remove();
      for (const [child, inert] of inertStates) child.inert = inert;
      inertStates.clear();
      if (mode === 'auth') document.querySelector('#auth-status').hidden = false;
    },
    fail,
  });
  // Auth pages already have a visible loading message; show only recovery there.
  if (mode === 'auth') document.documentElement.dataset.startupAuth = 'true';
  if (mode === 'document') addEventListener('DOMContentLoaded', () => {
    if (!failed) window.ChoirStartup.ready();
  }, { once: true });
  addEventListener('error', event => {
    if (event instanceof ErrorEvent || event.target instanceof HTMLScriptElement) fail();
  }, true);
})();
