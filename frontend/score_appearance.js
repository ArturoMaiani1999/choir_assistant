/* Shared score paper preference, independent of musical and pitch settings. */
(function () {
  'use strict';
  const key = 'choir-score-paper:v1', defaultColor = '#c3c0b6';
  const valid = (value) => /^#[0-9a-f]{6}$/i.test(value || '');
  let color = defaultColor;
  try { const saved = localStorage.getItem(key); if (valid(saved)) color = saved; } catch (_) {}
  function apply(value, persist = false) {
    color = valid(value) ? value : defaultColor;
    document.documentElement.style.setProperty('--score-paper', color);
    const input = document.getElementById('score-paper-color');
    if (input) input.value = color;
    if (persist) { try { localStorage.setItem(key, color); } catch (_) {} }
  }
  apply(color);
  document.addEventListener('DOMContentLoaded', () => {
    const dialog = document.getElementById('settings-dialog');
    const basicPanel = document.getElementById('settings-basic-panel');
    if (!dialog || !basicPanel) return;
    const section = document.createElement('section');
    section.className = 'detector-setting score-appearance-setting';
    section.setAttribute('aria-labelledby', 'score-paper-heading');
    section.innerHTML = '<div><h3 id="score-paper-heading">Colore della carta <button class="setting-info" type="button" aria-label="Informazioni sul colore della carta" data-tooltip="Cambia lo sfondo dello spartito. La scelta viene salvata automaticamente per brani e allenamento.">i</button></h3></div><label class="score-paper-color-row" for="score-paper-color">Colore personalizzato <input id="score-paper-color" type="color" /></label><div class="score-paper-presets"><button type="button" data-paper="#c3c0b6">Carta</button><button type="button" data-paper="#e3e8e6">Grigio chiaro</button><button type="button" data-paper="#ffffff">Bianco</button></div>';
    (document.getElementById('settings-appearance') || basicPanel).appendChild(section);
    section.querySelector('input').value = color;
    section.querySelector('input').addEventListener('input', (event) => apply(event.target.value, true));
    section.querySelectorAll('[data-paper]').forEach(button => button.addEventListener('click', () => apply(button.dataset.paper, true)));
  });
  window.addEventListener('storage', (event) => { if (event.key === key) apply(event.newValue); });
})();
