// Browser adapter for the normalized symbolic-score contract.
// Draft/approval state belongs to the source version, not to this runtime.
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
    constructor({ title, scoreVersionId = null, tempoBpm, tempoMap = [], beatsPerMeasure, measures = [], parts = [], performanceOccurrences = [], targetEvents }) {
      this.title = title;
      this.scoreVersionId = scoreVersionId;
      this.tempoBpm = tempoBpm;
      this.tempoMap = tempoMap.length ? tempoMap : [{ beat: 0, bpm: tempoBpm }];
      this.beatsPerMeasure = beatsPerMeasure;
      this.measures = measures;
      this.parts = parts;
      this.performanceOccurrences = performanceOccurrences;
      this.allTargetEvents = targetEvents.map((event) => ({
        ...event,
        frequencyHz: event.frequencyHz ?? midiToHz(event.midiPitch),
        noteName: event.noteName ?? midiToName(event.midiPitch),
        attackGraceBeats: event.attackGraceBeats ?? 0.18,
      }));
      this.selectedPartId = parts[0]?.id ?? this.allTargetEvents[0]?.partId ?? null;
      this.selectPart(this.selectedPartId);
    }

    selectPart(partId) {
      this.selectedPartId = partId;
      this.targetEvents = this.allTargetEvents.filter((event) => event.partId === partId);
      return this;
    }

    targetAt(beat) {
      return this.targetEvents.find(
        (event) => event.onsetBeat <= beat && beat < event.onsetBeat + event.durationBeats,
      ) ?? null;
    }

    measureAt(beat) {
      const safeBeat = Math.max(0, beat);
      if (this.performanceOccurrences.length > 0) {
        const occurrence = this.performanceOccurrences.find(
          (item) => item.startBeat <= safeBeat && safeBeat < item.endBeat,
        ) ?? this.performanceOccurrences[this.performanceOccurrences.length - 1];
        const measure = this.measures.find((item) => item.id === occurrence.writtenMeasureId);
        return {
          number: measure?.number ?? '?',
          beatInMeasure: Math.max(0, safeBeat - occurrence.startBeat) + 1,
          occurrenceIndex: occurrence.occurrenceIndex,
        };
      }
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

    secondsAtBeat(beat) {
      const safeBeat = Math.max(0, beat);
      let seconds = 0;
      for (let index = 0; index < this.tempoMap.length; index += 1) {
        const tempo = this.tempoMap[index];
        const nextBeat = this.tempoMap[index + 1]?.beat ?? safeBeat;
        const segmentEnd = Math.min(safeBeat, nextBeat);
        if (segmentEnd > tempo.beat) seconds += (segmentEnd - tempo.beat) * 60 / tempo.bpm;
        if (safeBeat <= nextBeat) break;
      }
      return seconds;
    }

    beatAtSeconds(seconds) {
      let remaining = Math.max(0, seconds);
      for (let index = 0; index < this.tempoMap.length; index += 1) {
        const tempo = this.tempoMap[index];
        const nextBeat = this.tempoMap[index + 1]?.beat;
        if (nextBeat == null) return tempo.beat + remaining * tempo.bpm / 60;
        const segmentSeconds = (nextBeat - tempo.beat) * 60 / tempo.bpm;
        if (remaining <= segmentSeconds) return tempo.beat + remaining * tempo.bpm / 60;
        remaining -= segmentSeconds;
      }
      return 0;
    }

    static fromNormalizedScore(payload) {
      const tempoMap = (payload.tempo_map ?? []).map((tempo) => ({ beat: tempo.beat, bpm: tempo.bpm }));
      const firstTempo = tempoMap[0]?.bpm ?? 80;
      const sourceMeasures = payload.measures ?? [];
      const measures = sourceMeasures.map((measure) => ({
        id: measure.id,
        number: measure.number,
        timeSignatureNumerator: measure.time_signature_numerator,
        timeSignatureDenominator: measure.time_signature_denominator,
      }));
      const beatsPerMeasure = measures[0]?.timeSignatureNumerator ?? 4;
      const parts = (payload.parts ?? []).map((part) => ({
        id: part.id,
        name: part.name,
        kind: part.kind,
      }));
      const performanceOccurrences = (payload.performance_occurrences ?? []).map((occurrence) => ({
        id: occurrence.id,
        writtenMeasureId: occurrence.written_measure_id,
        occurrenceIndex: occurrence.occurrence_index,
        startBeat: occurrence.start_beat,
        endBeat: occurrence.end_beat,
      }));
      const targetEvents = (payload.target_events ?? []).map((event) => {
        return ({
        id: event.id,
        partId: event.part_id,
        measureNumber: sourceMeasures.find((measure) => measure.id === event.written_measure_id)?.number,
        onsetBeat: event.onset_beats,
        durationBeats: event.duration_beats,
        midiPitch: event.midi_pitch,
        frequencyHz: event.frequency_hz,
        isRest: event.is_rest,
        lyric: event.lyric ?? null,
        lyricSyllabic: event.lyric_syllabic ?? null,
        lyricExtend: event.lyric_extend ?? false,
        tieStart: event.tie_start ?? false,
        tieStop: event.tie_stop ?? false,
        sourceEventId: event.source_event_id ?? null,
        attackGraceBeats: event.attack_grace_beats ?? 0.18,
      });
      });
      if (targetEvents.some((event) => !event.sourceEventId)) {
        throw new Error('Runtime target event is missing stable source-event provenance');
      }
      return new NormalizedScoreRuntime({
        title: payload.title,
        scoreVersionId: payload.score_version_id,
        tempoBpm: firstTempo,
        tempoMap,
        beatsPerMeasure,
        measures,
        parts,
        performanceOccurrences,
        targetEvents: targetEvents.filter((event) => !event.isRest && event.midiPitch != null),
      });
    }
  }

  class PerformanceClock {
    constructor({ tempoBpm, speed = 1 }) {
      this.tempoBpm = tempoBpm;
      this.speed = speed;
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

    setSpeed(speed, nowMs) {
      const nextSpeed = Number(speed);
      if (!(nextSpeed > 0)) return;
      if (this.running) {
        this.currentBeat = this.beatAt(nowMs);
        this.startBeat = this.currentBeat;
        this.startedAtMs = nowMs;
      }
      this.speed = nextSpeed;
    }

    beatAt(nowMs) {
      if (!this.running || this.startedAtMs == null) return this.currentBeat;
      return this.startBeat + ((nowMs - this.startedAtMs) / 60000) * this.tempoBpm * this.speed;
    }

    snapshot(nowMs) {
      const beat = this.beatAt(nowMs);
      return { beat, elapsedSeconds: (beat * 60) / this.tempoBpm, running: this.running, speed: this.speed };
    }
  }

  class MediaPlaybackClock {
    constructor({ mediaElement, scoreRuntime }) {
      this.media = mediaElement;
      this.scoreRuntime = scoreRuntime;
      this.preRenderedSpeed = null;
    }

    get running() {
      return !this.media.paused && !this.media.ended;
    }

    get speed() {
      return this.media.playbackRate;
    }

    async play() {
      if (this.running) return this.snapshot();
      await this.media.play();
      return this.snapshot();
    }

    pause() {
      this.media.pause();
      return this.snapshot();
    }

    seekPerformanceTime(seconds) {
      const mediaSeconds = this.preRenderedSpeed ? seconds / this.preRenderedSpeed : seconds;
      this.media.currentTime = Math.max(0, Math.min(Number.isFinite(this.media.duration) ? this.media.duration : Infinity, mediaSeconds));
      return this.snapshot();
    }

    seekBeat(beat) {
      return this.seekPerformanceTime(this.scoreRuntime.secondsAtBeat(beat));
    }

    setSpeed(speed) {
      const nextSpeed = Number(speed);
      if (nextSpeed > 0) {
        this.preRenderedSpeed = null;
        this.media.defaultPlaybackRate = nextSpeed;
        this.media.playbackRate = nextSpeed;
        this.media.preservesPitch = true;
      }
      return this.snapshot();
    }

    setPreRenderedSpeed(speed) {
      const nextSpeed = Number(speed);
      if (nextSpeed > 0) {
        this.preRenderedSpeed = nextSpeed;
        this.media.defaultPlaybackRate = 1;
        this.media.playbackRate = 1;
        this.media.preservesPitch = true;
      }
      return this.snapshot();
    }

    snapshot() {
      const mediaTime = this.media.currentTime || 0;
      const performanceTime = mediaTime * (this.preRenderedSpeed || 1);
      return {
        mediaTime,
        performanceTime,
        beat: this.scoreRuntime.beatAtSeconds(performanceTime),
        running: this.running,
        speed: this.preRenderedSpeed || this.speed,
      };
    }
  }

  // Four measures of two-beat notes. This is a development fixture only.
  function createDemoScore() {
    const midiPitches = [69, 69, 71, 71, 72, 72, 74, 69];
    return new NormalizedScoreRuntime({
      title: 'Esercizio simbolico di sviluppo',
      tempoBpm: 80,
      beatsPerMeasure: 4,
      parts: [{ id: 'P1', name: 'Soprano', kind: 'vocal' }],
      targetEvents: midiPitches.map((midiPitch, index) => ({
        id: `demo-note-${index + 1}`,
        partId: 'P1',
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
    MediaPlaybackClock,
    createDemoScore,
    midiToHz,
    midiToName,
  };
})(window);
