"""Small, dependency-free runtime score model.

MusicXML remains the editorial source. This module is the contract that a future
MusicXML compiler will produce for the rehearsal client.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any


class ScoreVersionState(StrEnum):
    DRAFT = "draft"
    REVIEW = "review"
    APPROVED = "approved"
    PUBLISHED = "published"
    SUPERSEDED = "superseded"


@dataclass(frozen=True, slots=True)
class Part:
    id: str
    name: str
    kind: str = "vocal"


@dataclass(frozen=True, slots=True)
class WrittenMeasure:
    id: str
    number: str
    index: int
    time_signature_numerator: int
    time_signature_denominator: int


@dataclass(frozen=True, slots=True)
class MusicalEvent:
    id: str
    measure_id: str
    part_id: str
    kind: str
    onset_beats: float
    duration_beats: float
    midi_pitch: int | None = None
    lyric: str | None = None
    lyric_syllabic: str | None = None
    lyric_extend: bool = False
    tie_start: bool = False
    tie_stop: bool = False
    voice: int | None = None


@dataclass(frozen=True, slots=True)
class PerformanceOccurrence:
    id: str
    written_measure_id: str
    occurrence_index: int
    start_beat: float
    end_beat: float
    start_seconds: float
    end_seconds: float


@dataclass(frozen=True, slots=True)
class TargetEvent:
    id: str
    occurrence_id: str
    written_measure_id: str
    part_id: str
    onset_beats: float
    duration_beats: float
    onset_seconds: float
    duration_seconds: float
    midi_pitch: int | None
    frequency_hz: float | None
    source_event_id: str
    lyric: str | None = None
    lyric_syllabic: str | None = None
    lyric_extend: bool = False
    tie_start: bool = False
    tie_stop: bool = False
    is_rest: bool = False


@dataclass(frozen=True, slots=True)
class TempoChange:
    beat: float
    bpm: float


@dataclass(frozen=True, slots=True)
class NavigationEvent:
    kind: str
    written_measure_id: str | None = None
    label: str | None = None


@dataclass(slots=True)
class NormalizedScore:
    """Runtime score compiled from one approved symbolic score version."""

    score_version_id: str
    title: str
    parts: list[Part] = field(default_factory=list)
    measures: list[WrittenMeasure] = field(default_factory=list)
    events: list[MusicalEvent] = field(default_factory=list)
    performance_occurrences: list[PerformanceOccurrence] = field(default_factory=list)
    target_events: list[TargetEvent] = field(default_factory=list)
    tempo_map: list[TempoChange] = field(default_factory=list)
    navigation: list[NavigationEvent] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def target_at(self, part_id: str, performance_seconds: float) -> TargetEvent | None:
        """Return the active target without inferring anything from audio."""

        for event in self.target_events:
            if event.part_id != part_id or event.is_rest:
                continue
            if event.onset_seconds <= performance_seconds <= (
                event.onset_seconds + event.duration_seconds
            ):
                return event
        return None

    def occurrence_at(self, performance_seconds: float) -> PerformanceOccurrence | None:
        for occurrence in self.performance_occurrences:
            if occurrence.start_seconds <= performance_seconds <= occurrence.end_seconds:
                return occurrence
        return None
