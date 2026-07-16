"""The locked AEGIS contract: DispatchState and everything it is built from.

Design Law 1 (the LLM only listens, the protocol decides) and Design Law 4
(degrade gracefully, visibly) are encoded here as data shape, not comments:
every field that could come from a real system or a fallback carries a
`data_source` tag, and nothing in this file computes anything — it only
describes shapes.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class DispatchStatus(str, Enum):
    IN_PROGRESS = "IN_PROGRESS"
    AWAITING_REVIEW = "AWAITING_REVIEW"
    DISPATCHED = "DISPATCHED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class Priority(str, Enum):
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"
    UNKNOWN = "UNKNOWN"


class TranscriptQuality(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class TimingEntry(BaseModel):
    step: str
    start: float
    end: Optional[float] = None

    @property
    def duration_ms(self) -> Optional[float]:
        if self.end is None:
            return None
        return (self.end - self.start) * 1000


class Incident(BaseModel):
    """Facts extracted from the transcript. LLM extraction fills this in
    verbatim from stated facts only — no inference, no severity scoring."""

    raw_transcript: str
    chief_complaint: str = "UNKNOWN"
    breathing_normally: Optional[bool] = None
    major_bleeding: Optional[bool] = None
    conscious: Optional[bool] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    transcript_quality: TranscriptQuality = TranscriptQuality.MEDIUM
    extraction_data_source: str = "llm_extraction"


class TriageResult(BaseModel):
    """Output of apply_triage_rules — deterministic, rule-table driven."""

    priority: Priority = Priority.UNKNOWN
    rule_ids: list[str] = Field(default_factory=list)
    requires_als: bool = False
    required_hospital_specialty: Optional[str] = None


class PrearrivalGuidance(BaseModel):
    """Reserved by the contract for the HIGH-VALUE tier CPR/coaching node.
    Not populated by the CORE-tier workflow; kept here so the contract
    never needs a breaking change when that node is attached."""

    protocol_id: str
    chief_complaint: str
    steps: list[str]
    metronome_bpm: Optional[int] = None
    started_at: float
    data_source: str = "protocol"


class Ambulance(BaseModel):
    id: str
    lat: float
    lng: float
    capability: str  # "BLS" | "ALS"
    status: str = "AVAILABLE"


class Hospital(BaseModel):
    id: str
    lat: float
    lng: float
    bed_count: int
    specialties: list[str] = Field(default_factory=list)
    status: str = "OPEN"  # "OPEN" | "DIVERSION"


class RejectionReason(BaseModel):
    reason_code: str
    human_text: str


class CandidateAssignment(BaseModel):
    ambulance: Ambulance
    hospital: Hospital
    ambulance_eta_minutes: Optional[float] = None
    hospital_eta_minutes: Optional[float] = None
    score: Optional[float] = None
    rejected: bool = False
    rejection: Optional[RejectionReason] = None
    route_data_source: str = "unknown"


class Reservation(BaseModel):
    reservation_id: str
    ambulance_id: str
    hospital_id: str
    idempotency_key: str
    confirmed: bool = False


class DispatchState(BaseModel):
    """The single source of truth threaded through every LangGraph node.

    Locked per Part 2 of the AEGIS master prompt: rename only with
    agreement across every attached microservice.
    """

    call_id: str
    status: DispatchStatus = DispatchStatus.IN_PROGRESS

    raw_transcript: str = ""
    caller_lat: Optional[float] = None
    caller_lng: Optional[float] = None

    incident: Optional[Incident] = None
    triage: Optional[TriageResult] = None
    prearrival: Optional[PrearrivalGuidance] = None

    available_ambulances: list[dict] = Field(default_factory=list)
    available_hospitals: list[dict] = Field(default_factory=list)
    resource_data_source: Optional[tuple[str, str]] = None

    candidates: list[CandidateAssignment] = Field(default_factory=list)
    selected: Optional[CandidateAssignment] = None
    reservation: Optional[Reservation] = None

    complexity_score: Optional[float] = None
    spawned_workers: int = 0

    replan_count: int = 0
    max_replans: int = 2

    review_reason: Optional[str] = None
    failure_reason: Optional[str] = None

    timing_log: list[TimingEntry] = Field(default_factory=list)

    model_config = ConfigDict(use_enum_values=False)
