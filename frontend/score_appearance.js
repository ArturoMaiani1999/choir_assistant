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
    const dialog = document.getElementById('settings-dialog') || document.getElementById('lab-settings-dialog');
    if (!dialog) return;
    const section = document.createElement('section');
    section.className = 'score-appearance-setting';
    section.innerHTML = '<h3>Colore della carta</h3><label for="score-paper-color">Sfondo dello spartito <input id="score-paper-color" type="color" /></label><div class="score-paper-presets"><button type="button" data-paper="#c3c0b6">Carta</button><button type="button" data-paper="#e3e8e6">Grigio chiaro</button><button type="button" data-paper="#ffffff">Bianco</button></div><small>Salvato automaticamente per brani e allenamento.</small>';
    dialog.insertBefore(section, dialog.querySelector('.dialog-actions'));
    section.querySelector('input').value = color;
    section.querySelector('input').addEventListener('input', (event) => apply(event.target.value, true));
    section.querySelectorAll('[data-paper]').forEach(button => button.addEventListener('click', () => apply(button.dataset.paper, true)));
  });
  window.addEventListener('storage', (event) => { if (event.key === key) apply(event.newValue); });
})();
