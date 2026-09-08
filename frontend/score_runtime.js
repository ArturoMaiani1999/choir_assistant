// Small browser runtime for an approved symbolic score.
// This fixture is intentionally synthetic: it proves the runtime contract
// without pretending that Gloria Frisina has already passed through OMR.
(function exposeScoreRuntime(global) {
  function midiToHz(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function midiToName(midi) {
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const pitchClass = ((midi % 12) + 12) % 12;
    return `${names[pitchClass]}${Math.floor(midi / 12) - 1}`;
  }

  class NormalizedScoreRuntime {
    constructor({ title, tempoBpm, beatsPerMeasure, measures = [], targetEvents }) {
      this.title = title;
      this.tempoBpm = tempoBpm;
      this.beatsPerMeasure = beatsPerMeasure;
      this.measures = measures;
      this.targetEvents = targetEvents.map((event) => ({
        ...event,
        frequencyHz: event.frequencyHz ?? midiToHz(event.midiPitch),
        noteName: event.noteName ?? midiToName(event.midiPitch),
      }));
    }

    targetAt(beat) {
      return this.targetEvents.find(
        (event) => event.onsetBeat <= beat && beat < event.onsetBeat + event.durationBeats,
      ) ?? null;
    }

    measureAt(beat) {
      const safeBeat = Math.max(0, beat);
      if (this.measures.length > 0) {
        let startBeat = 0;
        for (const measure of this.measures) {
          const measureBeats = measure.timeSignatureNumerator * (4 / measure.timeSignatureDenominator);
          if (safeBeat < startBeat + measureBeats) {
            return {
              number: measure.number,
              beatInMeasure: (safeBeat - startBeat) + 1,
            };
          }
          startBeat += measureBeats;
        }
      }
      return {
        number: Math.floor(safeBeat / this.beatsPerMeasure) + 1,
        beatInMeasure: (safeBeat % this.beatsPerMeasure) + 1,
      };
    }

    static fromNormalizedScore(payload) {
      const firstTempo = payload.tempo_map?.[0]?.bpm ?? 80;
      const sourceMeasures = payload.measures ?? [];
      const measures = sourceMeasures.map((measure) => ({
        number: measure.number,
        timeSignatureNumerator: measure.time_signature_numerator,
        timeSignatureDenominator: measure.time_signature_denominator,
      }));
      const beatsPerMeasure = measures[0]?.timeSignatureNumerator ?? 4;
      const targetEvents = (payload.target_events ?? []).map((event) => ({
        id: event.id,
        measureNumber: sourceMeasures.find((measure) => measure.id === event.written_measure_id)?.number,
        onsetBeat: event.onset_beats,
        durationBeats: event.duration_beats,
        midiPitch: event.midi_pitch,
        frequencyHz: event.frequency_hz,
        isRest: event.is_rest,
      }));
      return new NormalizedScoreRuntime({
        title: payload.title,
        tempoBpm: firstTempo,
        beatsPerMeasure,
        measures,
        targetEvents: targetEvents.filter((event) => !event.isRest && event.midiPitch != null),
      });
    }
  }

  class PerformanceClock {
    constructor({ tempoBpm }) {
      this.tempoBpm = tempoBpm;
      this.currentBeat = 0;
      this.running = false;
      this.startedAtMs = null;
      this.startBeat = 0;
    }

    start(nowMs) {
      if (this.running) return;
      this.startedAtMs = nowMs;
      this.startBeat = this.currentBeat;
      this.running = true;
    }

    stop(nowMs) {
      if (!this.running) return;
      this.currentBeat = this.beatAt(nowMs);
      this.running = false;
      this.startedAtMs = null;
    }

    reset() {
      this.currentBeat = 0;
      this.running = false;
      this.startedAtMs = null;
      this.startBeat = 0;
    }

    seek(beat, nowMs) {
      this.currentBeat = Math.max(0, beat);
      this.startBeat = this.currentBeat;
      this.startedAtMs = this.running ? nowMs : null;
    }

    beatAt(nowMs) {
      if (!this.running || this.startedAtMs == null) return this.currentBeat;
      return this.startBeat + ((nowMs - this.startedAtMs) / 60000) * this.tempoBpm;
    }

    snapshot(nowMs) {
      const beat = this.beatAt(nowMs);
      return { beat, elapsedSeconds: (beat * 60) / this.tempoBpm, running: this.running };
    }
  }

  // Four measures of two-beat notes. This is a development fixture only.
  function createDemoScore() {
    const midiPitches = [69, 69, 71, 71, 72, 72, 74, 69];
    return new NormalizedScoreRuntime({
      title: 'Development symbolic target · not Gloria Frisina',
      tempoBpm: 80,
      beatsPerMeasure: 4,
      targetEvents: midiPitches.map((midiPitch, index) => ({
        id: `demo-note-${index + 1}`,
        measureNumber: Math.floor((index * 2) / 4) + 1,
        onsetBeat: index * 2,
        durationBeats: 2,
        midiPitch,
      })),
    });
  }

  global.ChoirScore = {
    NormalizedScoreRuntime,
    PerformanceClock,
    createDemoScore,
    midiToHz,
    midiToName,
  };
})(window);
