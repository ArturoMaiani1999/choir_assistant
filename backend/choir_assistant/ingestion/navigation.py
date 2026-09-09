"""MusicXML navigation hints and conservative performance-order flattening."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class MeasureNavigationHint:
    index: int
    repeat_forward: bool = False
    repeat_backward_times: int | None = None
    ending_numbers: tuple[int, ...] = ()
    words: tuple[str, ...] = ()
    has_segno: bool = False
    has_coda: bool = False
    jump: str | None = None
    has_fine: bool = False
    has_to_coda: bool = False


def flatten_repeats(hints: list[MeasureNavigationHint]) -> list[int]:
    """Return written measure indexes in performance order.

    The algorithm supports non-nested forward/backward repeats and simple
    ending labels. A missing forward repeat starts at measure zero. Navigation
    jumps such as D.C. and D.S. are intentionally not executed here yet.
    """

    if not hints:
        return []
    backward_by_start: dict[int, tuple[int, int]] = {}
    forward_indexes = [hint.index for hint in hints if hint.repeat_forward]
    for hint in hints:
        if hint.repeat_backward_times is None:
            continue
        starts = [index for index in forward_indexes if index <= hint.index]
        start = max(starts) if starts else 0
        backward_by_start[start] = (hint.index, max(2, hint.repeat_backward_times))

    order: list[int] = []
    index = 0
    while index < len(hints):
        block = backward_by_start.get(index)
        if block is None:
            order.append(index)
            index += 1
            continue
        end, passes = block
        for pass_number in range(1, passes + 1):
            for measure_index in range(index, end + 1):
                endings = hints[measure_index].ending_numbers
                if endings and pass_number not in endings:
                    continue
                order.append(measure_index)
        index = end + 1
    return order


def flatten_navigation(hints: list[MeasureNavigationHint]) -> list[int]:
    """Flatten repeats and one explicit D.C./D.S. navigation pass.

    The initial pass uses the repeat-aware order. When a D.C. or D.S. marker is
    reached, a second linear pass starts at the beginning or at Segno. During
    that pass Fine stops playback; for an ``al Coda`` marker, To Coda jumps to
    the Coda measure before Fine is evaluated.
    """

    base_order = flatten_repeats(hints)
    jump_position = next(
        (position for position, index in enumerate(base_order) if hints[index].jump),
        None,
    )
    if jump_position is None:
        return base_order

    jump_index = base_order[jump_position]
    jump_kind = hints[jump_index].jump
    if jump_kind == "ds":
        start_index = next(
            (hint.index for hint in hints if hint.has_segno),
            0,
        )
    else:
        start_index = 0
    jump_to_coda = "coda" in " ".join(hints[jump_index].words).lower()
    coda_index = next((hint.index for hint in hints if hint.has_coda), None)

    second_pass: list[int] = []
    index = start_index
    coda_used = False
    while index < len(hints):
        hint = hints[index]
        if jump_to_coda and not coda_used and hint.has_to_coda and coda_index is not None:
            index = coda_index
            coda_used = True
            continue
        second_pass.append(index)
        if hint.has_fine:
            break
        index += 1

    return base_order[: jump_position + 1] + second_pass
