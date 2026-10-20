(function aggregatePitchModule(global) {
  'use strict';

  const COLORS = Object.freeze({
    soprano: '#e8b44f', contralto: '#d98bd8', tenore: '#42c7bd', basso: '#6f9fe8',
  });
  const LABELS = Object.freeze({ soprano: 'Soprano', contralto: 'Contralto', tenore: 'Tenore', basso: 'Basso' });

  function targetEvents(parts) {
    const points = (parts[0]?.points || []).filter(point => Number.isFinite(point.targetPitch));
    if (!points.length) return [];
    const events = [];
    let start = points[0];
    let previous = points[0];
    const close = () => events.push({
      onsetBeat: start.beat,
      durationBeats: Math.max(.08, previous.beat - start.beat + .08),
      midiPitch: start.targetPitch,
      lyric: null,
    });
    for (const point of points.slice(1)) {
      if (Math.abs(point.targetPitch - previous.targetPitch) > .08 || point.beat - previous.beat > .5) {
        close();
        start = point;
      }
      previous = point;
    }
    close();
    return events;
  }

  function draw(canvas, parts) {
    const usable = (parts || []).filter(part => part.points?.length);
    if (!global.PianoRoll || !usable.length) {
      const ratio = Math.max(1, Math.min(2, global.devicePixelRatio || 1));
      const width = Math.max(320, canvas.clientWidth || 900), height = Math.max(260, canvas.clientHeight || 420);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = '#071419'; context.fillRect(0, 0, width, height);
      context.fillStyle = '#9db4b3'; context.font = '15px Inter, sans-serif'; context.textAlign = 'center';
      context.fillText('Servono almeno due esecuzioni complete comparabili per una stessa parte.', width / 2, height / 2);
      return null;
    }
    const totalBeats = Math.max(1, ...usable.map(part => Number(part.totalBeats || 0)));
    return global.PianoRoll.draw(canvas, {
      totalBeats,
      measures: [],
      targetEvents: targetEvents(usable),
      traces: usable.map(part => ({
        id: part.voicePart,
        label: LABELS[part.voicePart] || part.voicePart,
        color: COLORS[part.voicePart] || '#fff',
        samples: part.points.map(point => ({
          beat: Number(point.beat),
          displayPitch: Number(point.pitch),
          targetPitch: Number(point.targetPitch),
          errorCents: Number(point.medianErrorCents || 0),
        })),
      })),
      markers: [],
      lyricScale: 1,
    }, { zoom: 1, centerBeat: totalBeats / 2 });
  }

  global.AggregatePitch = Object.freeze({ COLORS, LABELS, draw });
})(window);
