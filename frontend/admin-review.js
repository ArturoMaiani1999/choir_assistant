(async function initializeReview() {
  const manifest = await fetch('practice-piece.json', { cache: 'no-store' }).then((response) => {
    if (!response.ok) throw new Error('Review manifest unavailable');
    return response.json();
  });
  const approvalKey = `choir-approval:${manifest.bundle_fingerprint}`;
  const $ = (id) => document.getElementById(id);
  let ingestionJobId = null;
  let ingestionPoll = null;
  const ingestionLabels = {
    queued_for_codex: 'Bozza accodata…', codex_running: 'Codex sta leggendo il PDF e creando la bozza…',
    pending_admin_review: 'Bozza pronta: scaricala, correggila in MuseScore e ricaricala.',
    admin_revision_uploaded: 'Versione revisionata caricata; pronta per validazione e pubblicazione.',
    codex_failed: 'Creazione automatica non riuscita. Controlla i log del job e riprova.'
  };
  async function refreshIngestion() {
    if (!ingestionJobId) return;
    const result = await fetch(`/api/ingestions/${ingestionJobId}`, { cache: 'no-store' }).then((r) => r.json());
    $('ingestion-status').textContent = `${ingestionLabels[result.status] || result.status} Job: ${ingestionJobId}`;
    $('draft-actions').hidden = result.status !== 'pending_admin_review';
    if (['pending_admin_review', 'admin_revision_uploaded', 'codex_failed'].includes(result.status)) {
      clearInterval(ingestionPoll); ingestionPoll = null;
    }
  }
  $('new-score-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = $('new-score-pdf').files[0]; if (!file) return;
    $('create-draft').disabled = true; $('ingestion-status').textContent = 'Registrazione PDF…';
    const body = new FormData(); body.append('file', file, file.name); body.append('piece_id', $('new-piece-id').value.trim());
    try {
      const response = await fetch('/api/ingestions', { method: 'POST', body }); const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Registrazione non riuscita');
      ingestionJobId = result.job_id; await refreshIngestion();
      ingestionPoll = setInterval(() => refreshIngestion().catch(() => {}), 2500);
    } catch (error) { $('ingestion-status').textContent = `Errore: ${error.message}`; }
    finally { $('create-draft').disabled = false; }
  });
  $('download-draft').addEventListener('click', () => { if (ingestionJobId) location.href = `/api/ingestions/${ingestionJobId}/draft`; });
  $('revision-file').addEventListener('change', async (event) => {
    const file = event.target.files[0]; if (!file || !ingestionJobId) return;
    const body = new FormData(); body.append('file', file, file.name);
    try {
      const response = await fetch(`/api/ingestions/${ingestionJobId}/revision`, { method: 'POST', body });
      const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.error || 'Upload non riuscito');
      $('ingestion-status').textContent = `Versione revisionata caricata. Job: ${ingestionJobId}`; $('draft-actions').hidden = true;
    } catch (error) { $('ingestion-status').textContent = `Errore: ${error.message}`; }
    event.target.value = '';
  });
  $('title').textContent = manifest.title;
  $('scope').textContent = manifest.scope;
  $('fingerprint').textContent = `Bundle ${manifest.bundle_fingerprint}`;
  $('integrity').textContent = manifest.integrity.consistent
    ? `${manifest.integrity.event_count} events · ${manifest.integrity.lyric_attack_count} lyric attacks · hashes consistent`
    : 'INTEGRITY FAILURE · approval disabled';

  manifest.review_pairs.forEach((pair) => {
    const comparison = document.createElement('article');
    comparison.className = 'comparison';
    comparison.innerHTML = `<figure><figcaption>${pair.label} · source PDF</figcaption><div class="image-frame"><img src="${pair.source}" alt="Source PDF crop" /></div></figure><figure><figcaption>${pair.label} · reconstructed score</figcaption><div class="image-frame"><img src="${pair.rendered}" alt="Reconstructed notation" /></div></figure>`;
    $('comparisons').append(comparison);
  });
  manifest.checks.forEach((check) => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" name="review-check" value="${check.id}" /> <span>${check.label}</span>`;
    $('checks').append(label);
  });
  const audioManifest = await fetch(manifest.assets.audio_manifest, { cache: 'no-store' }).then((response) => response.json());
  const mix = Object.values(audioManifest.mixes)[0];
  $('review-audio').src = `${manifest.assets.audio_root}/${mix.file}`;

  $('download-mscz').addEventListener('click', async () => {
    const response = await fetch('/api/musescore-source');
    if (!response.ok) { $('import-status').textContent = 'File MuseScore non disponibile.'; return; }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob());
    link.download = 'ecco-mvp.mscz';
    link.click();
    URL.revokeObjectURL(link.href);
  });
  $('mscz-file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    $('import-status').textContent = 'Importazione e rigenerazione in corso…';
    const body = new FormData(); body.append('file', file, file.name);
    try {
      const response = await fetch('/api/import-musescore', { method: 'POST', body });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Importazione non riuscita');
      $('import-status').textContent = 'Versione importata e protetta come fonte canonica. Ricarico la revisione…';
      window.location.reload();
    } catch (error) { $('import-status').textContent = `Errore: ${error.message}`; }
    event.target.value = '';
  });

  function currentRecord() {
    try { return JSON.parse(localStorage.getItem(approvalKey)); } catch (_) { return null; }
  }
  function renderDecision() {
    const record = currentRecord();
    $('status-badge').textContent = record ? 'LOCALLY APPROVED' : 'PENDING REVIEW';
    $('decision').textContent = record
      ? `Approved by ${record.reviewer} on ${new Date(record.approvedAt).toLocaleString()}. This approval applies only to the fingerprint above.`
      : 'No human approval is recorded for this exact bundle.';
    $('revoke').disabled = !record;
    $('export').disabled = !record;
  }
  $('approval-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const checked = [...document.querySelectorAll('[name="review-check"]:checked')].map((item) => item.value);
    if (!manifest.integrity.consistent || checked.length !== manifest.checks.length) {
      $('decision').textContent = 'Every check must pass before approval.';
      return;
    }
    const record = { pieceId: manifest.piece_id, scoreVersionId: manifest.score_version_id, bundleFingerprint: manifest.bundle_fingerprint, reviewer: $('reviewer').value.trim(), notes: $('notes').value.trim(), checks: checked, approvedAt: new Date().toISOString() };
    if (!record.reviewer) return;
    localStorage.setItem(approvalKey, JSON.stringify(record));
    window.opener?.postMessage({ type: 'choir-bundle-approval', fingerprint: manifest.bundle_fingerprint }, location.origin);
    renderDecision();
  });
  $('revoke').addEventListener('click', () => { localStorage.removeItem(approvalKey); window.opener?.postMessage({ type: 'choir-bundle-approval', fingerprint: manifest.bundle_fingerprint }, location.origin); renderDecision(); });
  $('export').addEventListener('click', () => {
    const record = currentRecord(); if (!record) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
    link.download = `${manifest.piece_id}-approval-${manifest.bundle_fingerprint.slice(0, 12)}.json`;
    link.click(); URL.revokeObjectURL(link.href);
  });
  renderDecision();
})().catch((error) => { document.body.innerHTML = `<main><h1>Review unavailable</h1><p>${error.message}</p></main>`; });
