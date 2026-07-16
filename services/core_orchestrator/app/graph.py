"""The AEGIS CORE-tier LangGraph workflow.

ingest_call -> extract_incident -> apply_triage_rules
  -> [intake_review_gate] -> await_review | load_resources
load_resources -> compute_route_estimates -> rank_assignments -> validate_proposal
  -> [assignment_review_gate] -> await_review | reserve_ambulance
reserve_ambulance -> validate_reservation
  -> [after_validate_reservation] -> simulate_dispatch | replan | fail_safely
replan -> [after_replan] -> validate_proposal | fail_safely
simulate_dispatch -> monitor_or_finish -> END

dispatch_prearrival_guidance (HIGH-VALUE tier CPR coaching) is NOT wired in
here yet — the contract already reserves `prearrival` on DispatchState so
attaching that node later needs no schema change, only one new edge right
after apply_triage_rules.
"""

from __future__ import annotations

from langgraph.graph import END, StateGraph

from aegis_contracts import DispatchState

from .nodes import dispatch_lifecycle, gates, ingest_extract_triage, load_resources, rank_assignments
from .nodes import compute_route_estimates as route_estimates


def build_graph() -> StateGraph:
    graph = StateGraph(DispatchState)

    graph.add_node("ingest_call", ingest_extract_triage.ingest_call)
    graph.add_node("extract_incident", ingest_extract_triage.extract_incident)
    graph.add_node("apply_triage_rules", ingest_extract_triage.apply_triage_rules)
    graph.add_node("await_review", gates.mark_awaiting_review)
    graph.add_node("load_resources", load_resources.load_resources)
    graph.add_node("compute_route_estimates", route_estimates.compute_route_estimates)
    graph.add_node("rank_assignments", rank_assignments.rank_assignments)
    graph.add_node("validate_proposal", dispatch_lifecycle.validate_proposal)
    graph.add_node("reserve_ambulance", dispatch_lifecycle.reserve_ambulance)
    graph.add_node("validate_reservation", dispatch_lifecycle.validate_reservation)
    graph.add_node("simulate_dispatch", dispatch_lifecycle.simulate_dispatch)
    graph.add_node("monitor_or_finish", dispatch_lifecycle.monitor_or_finish)
    graph.add_node("replan", dispatch_lifecycle.replan)
    graph.add_node("fail_safely", dispatch_lifecycle.fail_safely)

    graph.set_entry_point("ingest_call")
    graph.add_edge("ingest_call", "extract_incident")
    graph.add_edge("extract_incident", "apply_triage_rules")

    graph.add_conditional_edges(
        "apply_triage_rules",
        gates.intake_review_gate,
        {"await_review": "await_review", "load_resources": "load_resources", "fail_safely": "fail_safely"},
    )

    graph.add_edge("load_resources", "compute_route_estimates")
    graph.add_edge("compute_route_estimates", "rank_assignments")
    graph.add_edge("rank_assignments", "validate_proposal")

    graph.add_conditional_edges(
        "validate_proposal",
        gates.assignment_review_gate,
        {"await_review": "await_review", "reserve_ambulance": "reserve_ambulance"},
    )

    graph.add_edge("reserve_ambulance", "validate_reservation")

    graph.add_conditional_edges(
        "validate_reservation",
        gates.after_validate_reservation,
        {"simulate_dispatch": "simulate_dispatch", "replan": "replan", "fail_safely": "fail_safely"},
    )

    graph.add_conditional_edges(
        "replan",
        gates.after_replan,
        {"validate_proposal": "validate_proposal", "fail_safely": "fail_safely"},
    )

    graph.add_edge("simulate_dispatch", "monitor_or_finish")
    graph.add_edge("monitor_or_finish", END)
    graph.add_edge("await_review", END)
    graph.add_edge("fail_safely", END)

    return graph


def compiled_app():
    return build_graph().compile()
