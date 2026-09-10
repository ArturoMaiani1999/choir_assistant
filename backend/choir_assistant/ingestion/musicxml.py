"""Dependency-free MusicXML partwise compiler.

This is the first symbolic compiler in the ingestion pipeline. It intentionally
compiles a conservative subset into the existing NormalizedScore contract; it
does not claim to solve OMR or performance navigation yet.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from typing import Iterable
from xml.etree import ElementTree as ET

from ..domain.models import (
    MusicalEvent,
    NavigationEvent,
    NormalizedScore,
    Part,
    PerformanceOccurrence,
    TargetEvent,
    TempoChange,
    WrittenMeasure,
)
from .navigation import MeasureNavigationHint, flatten_navigation


class MusicXmlCompileError(ValueError):
    """Raised when the input is not a supported MusicXML document."""


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _children(element: ET.Element, name: str) -> Iterable[ET.Element]:
    return (child for child in list(element) if _local_name(child.tag) == name)


def _child(element: ET.Element, name: str) -> ET.Element | None:
    return next(iter(_children(element, name)), None)


def _text(element: ET.Element | None, name: str) -> str | None:
    child = _child(element, name) if element is not None else None
    return child.text.strip() if child is not None and child.text else None


def _number(element: ET.Element | None, name: str, default: float) -> float:
    value = _text(element, name)
    return float(value) if value is not None else default


_STEP_TO_SEMITONE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def _midi_pitch(note: ET.Element) -> int | None:
    pitch = _child(note, "pitch")
    if pitch is None:
        return None
    step = _text(pitch, "step")
    octave = _text(pitch, "octave")
    if step not in _STEP_TO_SEMITONE or octave is None:
        return None
    alter = int(float(_text(pitch, "alter") or "0"))
    return (int(octave) + 1) * 12 + _STEP_TO_SEMITONE[step] + alter


def _lyric(note: ET.Element) -> tuple[str | None, str | None, bool]:
    lyric = _child(note, "lyric")
    if lyric is None:
        return None, None, False
    return _text(lyric, "text"), _text(lyric, "syllabic"), _child(lyric, "extend") is not None


def _ties(note: ET.Element) -> tuple[bool, bool]:
    tie_types = {tie.get("type") for tie in _children(note, "tie")}
    return "start" in tie_types, "stop" in tie_types


def _tempo_from_direction(direction: ET.Element) -> float | None:
    sound = _child(direction, "sound")
    if sound is not None and sound.get("tempo"):
        return float(sound.get("tempo"))
    direction_type = _child(direction, "direction-type")
    metronome = _child(direction_type, "metronome") if direction_type is not None else None
    return _number(metronome, "per-minute", 0) or None


def _ending_numbers(value: str | None) -> tuple[int, ...]:
    if not value:
        return ()
    numbers: set[int] = set()
    for token in value.replace(" ", "").split(","):
        if "-" in token:
            start, end = token.split("-", 1)
            if start.isdigit() and end.isdigit():
                numbers.update(range(int(start), int(end) + 1))
        elif token.isdigit():
            numbers.add(int(token))
    return tuple(sorted(numbers))


def _navigation_hint(measure: ET.Element, index: int) -> MeasureNavigationHint:
    repeat_forward = False
    repeat_backward_times: int | None = None
    ending_numbers: set[int] = set()
    words: list[str] = []
    has_segno = False
    has_coda = False
    for child in list(measure):
        kind = _local_name(child.tag)
        if kind == "barline":
            repeat = _child(child, "repeat")
            if repeat is not None:
                direction = (repeat.get("direction") or "").lower()
                if direction == "forward":
                    repeat_forward = True
                elif direction == "backward":
                    raw_times = repeat.get("times")
                    repeat_backward_times = int(raw_times) if raw_times and raw_times.isdigit() else 2
            ending = _child(child, "ending")
            if ending is not None:
                ending_numbers.update(_ending_numbers(ending.get("number")))
        elif kind == "direction":
            direction_type = _child(child, "direction-type")
            if direction_type is None:
                continue
            for word in _children(direction_type, "words"):
                if word.text:
                    words.append(word.text.strip())
            has_segno = has_segno or _child(direction_type, "segno") is not None
            has_coda = has_coda or _child(direction_type, "coda") is not None
    words_text = " ".join(words).lower()
    jump = None
    if "d.c" in words_text or "da capo" in words_text:
        jump = "dc"
    elif "d.s" in words_text or "dal segno" in words_text:
        jump = "ds"
    return MeasureNavigationHint(
        index=index,
        repeat_forward=repeat_forward,
        repeat_backward_times=repeat_backward_times,
        ending_numbers=tuple(sorted(ending_numbers)),
        words=tuple(words),
        has_segno=has_segno,
        has_coda=has_coda,
        jump=jump,
        has_fine="fine" in words_text and jump is None,
        has_to_coda="to coda" in words_text,
    )


def _beat_to_seconds(beat: float, tempo_map: list[TempoChange]) -> float:
    if beat <= 0:
        return 0.0
    seconds = 0.0
    cursor = 0.0
    bpm = tempo_map[0].bpm
    for change in tempo_map[1:]:
        if change.beat >= beat:
            break
        seconds += (change.beat - cursor) * 60.0 / bpm
        cursor = change.beat
        bpm = change.bpm
    return seconds + (beat - cursor) * 60.0 / bpm


def compile_musicxml(
    source: str | Path,
    *,
    score_version_id: str = "musicxml-score-v1",
    title: str | None = None,
) -> NormalizedScore:
    path = Path(source)
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError) as exc:
        raise MusicXmlCompileError(f"Cannot read MusicXML: {path}") from exc
    if _local_name(root.tag) != "score-partwise":
        raise MusicXmlCompileError("Only score-partwise MusicXML is supported")

    work = _child(root, "work")
    resolved_title = title or _text(work, "work-title") or _text(root, "movement-title") or path.stem
    part_list = _child(root, "part-list")
    part_names = {
        part.get("id"): _text(part, "part-name") or part.get("id") or "Part"
        for part in _children(part_list if part_list is not None else root, "score-part")
    }
    xml_parts = list(_children(root, "part"))
    if not xml_parts:
        raise MusicXmlCompileError("MusicXML contains no parts")

    parts: list[Part] = []
    measures: list[WrittenMeasure] = []
    events: list[MusicalEvent] = []
    target_events: list[TargetEvent] = []
    raw_tempo_changes: list[TempoChange] = [TempoChange(0.0, 80.0)]
    measure_spans: dict[str, tuple[float, float]] = {}
    navigation_hints: list[MeasureNavigationHint] = []

    for part_index, xml_part in enumerate(xml_parts):
        part_id = xml_part.get("id") or f"part-{part_index + 1}"
        parts.append(Part(part_id, part_names.get(part_id, part_id)))
        divisions = 1.0
        numerator = 4
        denominator = 4
        part_beat = 0.0

        for measure_index, measure in enumerate(_children(xml_part, "measure")):
            measure_id = f"measure-{measure_index + 1}"
            measure_number = measure.get("number") or str(measure_index + 1)
            attributes = _child(measure, "attributes")
            if attributes is not None:
                divisions = _number(attributes, "divisions", divisions)
                time = _child(attributes, "time")
                if time is not None:
                    numerator = int(float(_text(time, "beats") or numerator))
                    denominator = int(float(_text(time, "beat-type") or denominator))
            measure_beats = numerator * (4.0 / denominator)
            measure_start = part_beat
            measure_spans.setdefault(measure_id, (measure_start, measure_start + measure_beats))
            if part_index == 0:
                navigation_hints.append(_navigation_hint(measure, measure_index))
                measures.append(
                    WrittenMeasure(
                        id=measure_id,
                        number=measure_number,
                        index=measure_index,
                        time_signature_numerator=numerator,
                        time_signature_denominator=denominator,
                    )
                )

            cursor = measure_start
            last_note_onset = measure_start
            occurrence_id = f"occurrence-{measure_index + 1}"
            for child in list(measure):
                kind = _local_name(child.tag)
                if kind == "direction":
                    tempo = _tempo_from_direction(child)
                    if tempo and tempo > 0:
                        raw_tempo_changes.append(TempoChange(cursor, tempo))
                    continue
                if kind in {"backup", "forward"}:
                    offset = _number(child, "duration", 0.0) / divisions
                    cursor += offset if kind == "forward" else -offset
                    continue
                if kind != "note":
                    continue

                duration_beats = _number(child, "duration", 0.0) / divisions
                if duration_beats <= 0 and _child(child, "grace") is not None:
                    continue
                is_chord = _child(child, "chord") is not None
                onset = last_note_onset if is_chord else cursor
                if not is_chord:
                    cursor += duration_beats
                    last_note_onset = onset
                is_rest = _child(child, "rest") is not None
                midi_pitch = None if is_rest else _midi_pitch(child)
                voice_text = _text(child, "voice")
                voice = int(voice_text) if voice_text and voice_text.isdigit() else None
                source_note_id = child.get("id")
                event_id = source_note_id or f"{part_id}-event-{len(events) + 1}"
                lyric, lyric_syllabic, lyric_extend = _lyric(child)
                tie_start, tie_stop = _ties(child)
                events.append(
                    MusicalEvent(
                        id=event_id,
                        measure_id=measure_id,
                        part_id=part_id,
                        kind="rest" if is_rest else "note",
                        onset_beats=onset,
                        duration_beats=duration_beats,
                        midi_pitch=midi_pitch,
                        lyric=lyric,
                        lyric_syllabic=lyric_syllabic,
                        lyric_extend=lyric_extend,
                        tie_start=tie_start,
                        tie_stop=tie_stop,
                        voice=voice,
                    )
                )
                target_events.append(
                    TargetEvent(
                        id=f"target-{event_id}",
                        occurrence_id=occurrence_id,
                        written_measure_id=measure_id,
                        part_id=part_id,
                        onset_beats=onset,
                        duration_beats=duration_beats,
                        onset_seconds=0.0,
                        duration_seconds=0.0,
                        midi_pitch=midi_pitch,
                        frequency_hz=(440.0 * 2 ** ((midi_pitch - 69) / 12)) if midi_pitch is not None else None,
                        source_event_id=event_id,
                        lyric=lyric,
                        lyric_syllabic=lyric_syllabic,
                        lyric_extend=lyric_extend,
                        tie_start=tie_start,
                        tie_stop=tie_stop,
                        is_rest=is_rest,
                    )
                )
            part_beat = max(measure_start + measure_beats, cursor)

    tempo_by_beat: dict[float, float] = {}
    for change in raw_tempo_changes:
        tempo_by_beat[change.beat] = change.bpm
    written_tempo_map = [TempoChange(beat, tempo_by_beat[beat]) for beat in sorted(tempo_by_beat)]
    measure_order = flatten_navigation(navigation_hints)
    performance_tempo_changes: list[TempoChange] = [
        TempoChange(0.0, written_tempo_map[0].bpm)
    ]
    occurrences: list[PerformanceOccurrence] = []
    occurrence_targets: list[TargetEvent] = []
    occurrence_counts: dict[str, int] = {}
    performance_beat = 0.0
    targets_by_measure: dict[str, list[TargetEvent]] = {}
    for target in target_events:
        targets_by_measure.setdefault(target.written_measure_id, []).append(target)

    for position, measure_index in enumerate(measure_order):
        measure = measures[measure_index]
        measure_start, measure_end = measure_spans[measure.id]
        measure_duration = measure_end - measure_start
        occurrence_counts[measure.id] = occurrence_counts.get(measure.id, 0) + 1
        occurrence_id = f"occurrence-{position + 1}"
        occurrences.append(
            PerformanceOccurrence(
                id=occurrence_id,
                written_measure_id=measure.id,
                occurrence_index=occurrence_counts[measure.id],
                start_beat=performance_beat,
                end_beat=performance_beat + measure_duration,
                start_seconds=0.0,
                end_seconds=0.0,
            )
        )
        for change in written_tempo_map:
            if measure_start <= change.beat < measure_end:
                performance_tempo_changes.append(
                    TempoChange(performance_beat + change.beat - measure_start, change.bpm)
                )
        for target in targets_by_measure.get(measure.id, []):
            occurrence_targets.append(
                replace(
                    target,
                    id=f"{target.id}-{position + 1}",
                    occurrence_id=occurrence_id,
                    onset_beats=performance_beat + target.onset_beats - measure_start,
                )
            )
        performance_beat += measure_duration

    performance_tempo_by_beat: dict[float, float] = {}
    for change in performance_tempo_changes:
        performance_tempo_by_beat[change.beat] = change.bpm
    tempo_map = [
        TempoChange(beat, performance_tempo_by_beat[beat])
        for beat in sorted(performance_tempo_by_beat)
    ]
    timed_occurrences = [
        replace(
            occurrence,
            start_seconds=_beat_to_seconds(occurrence.start_beat, tempo_map),
            end_seconds=_beat_to_seconds(occurrence.end_beat, tempo_map),
        )
        for occurrence in occurrences
    ]
    timed_targets = [
        replace(
            target,
            onset_seconds=_beat_to_seconds(target.onset_beats, tempo_map),
            duration_seconds=(
                _beat_to_seconds(target.onset_beats + target.duration_beats, tempo_map)
                - _beat_to_seconds(target.onset_beats, tempo_map)
            ),
        )
        for target in occurrence_targets
    ]
    navigation: list[NavigationEvent] = []
    for hint in navigation_hints:
        measure_id = f"measure-{hint.index + 1}"
        if hint.repeat_forward:
            navigation.append(NavigationEvent("repeat_forward", measure_id))
        if hint.repeat_backward_times is not None:
            navigation.append(
                NavigationEvent("repeat_backward", measure_id, str(hint.repeat_backward_times))
            )
        if hint.ending_numbers:
            navigation.append(
                NavigationEvent("ending", measure_id, ",".join(map(str, hint.ending_numbers)))
            )
        for word in hint.words:
            navigation.append(NavigationEvent("direction", measure_id, word))
        if hint.has_segno:
            navigation.append(NavigationEvent("segno", measure_id))
        if hint.has_coda:
            navigation.append(NavigationEvent("coda", measure_id))
        if hint.jump:
            navigation.append(NavigationEvent(hint.jump, measure_id, " ".join(hint.words)))
        if hint.has_fine:
            navigation.append(NavigationEvent("fine", measure_id))
        if hint.has_to_coda:
            navigation.append(NavigationEvent("to_coda", measure_id))
    navigation.append(NavigationEvent("timeline_flattened", label=f"{len(occurrences)} occurrences"))
    return NormalizedScore(
        score_version_id=score_version_id,
        title=resolved_title,
        parts=parts,
        measures=measures,
        events=events,
        performance_occurrences=timed_occurrences,
        target_events=timed_targets,
        tempo_map=tempo_map,
        navigation=navigation,
    )
