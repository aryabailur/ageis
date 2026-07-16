"""
Request/response models for call_intake_agent.

`ExtractedFacts` deliberately reuses the exact field names and vocabulary
from core_orchestrator/app/extractors.py's EXTRACTION_SYSTEM_PROMPT
(chief_complaint in {CARDIAC, BLEEDING, CHOKING, UNKNOWN}, etc.) so that
downstream consumption (apply_triage_rules) doesn't need to know which
path — one-shot extractor or this agent — produced the facts.

This service NEVER decides severity, priority, or routing. It only
gathers and structures stated facts, then hands off a raw_transcript to
core_orchestrator's own /dispatch endpoint, which owns all triage logic.
"""

from typing import Literal, Optional
from pydantic import BaseModel, Field

ChiefComplaint = Literal["CARDIAC", "BLEEDING", "CHOKING", "UNKNOWN"]
TranscriptQuality = Literal["CLEAR", "PARTIAL", "POOR"]


class IntakeRequest(BaseModel):
    call_id: str
    initial_statement: str
    caller_lat: float
    caller_lng: float


class ExtractedFacts(BaseModel):
    chief_complaint: ChiefComplaint = "UNKNOWN"
    breathing_normally: Optional[bool] = None
    major_bleeding: Optional[bool] = None
    conscious: Optional[bool] = None
    transcript_quality: TranscriptQuality = "PARTIAL"


class IntakeResult(BaseModel):
    call_id: str
    path_used: Literal["AGENT_LOOP", "DETERMINISTIC_FALLBACK"]
    follow_up_questions: list[str] = Field(default_factory=list)
    follow_up_answers: list[str] = Field(default_factory=list)
    extracted_facts: Optional[ExtractedFacts] = None
    raw_transcript: str
    dispatch_result: dict
