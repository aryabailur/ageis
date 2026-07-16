"""Design Law 3: every node and every external call appends {step,start,end}
to timing_log. This is the one place that touches the clock, so tests can
freeze it by monkeypatching `clock`.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Iterator

from aegis_contracts.models import DispatchState, TimingEntry


def clock() -> float:
    return time.monotonic()


@contextmanager
def timed_step(state: DispatchState, step: str) -> Iterator[TimingEntry]:
    entry = TimingEntry(step=step, start=clock())
    state.timing_log.append(entry)
    try:
        yield entry
    finally:
        entry.end = clock()
