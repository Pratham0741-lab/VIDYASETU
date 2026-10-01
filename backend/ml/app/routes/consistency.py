from typing import Any, Dict, List
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.consistency_service import check_consistency

router = APIRouter(tags=["Consistency"])


class ConsistencyRequest(BaseModel):
    extractions: List[Dict[str, Any]] = Field(
        ...,
        description="Extracted field sets of the application's documents (api contract key); "
        "each item is one document's non-sensitive fields, e.g. {document_slot, applicant_name, dob}",
    )


class ConsistencyResponse(BaseModel):
    value: Dict[str, bool] = Field(
        ...,
        description="Boolean match verdicts for evaluated fields (e.g. names_match, dob_match)",
    )
    confidence: Dict[str, float] = Field(
        ...,
        description="Verdict certainty (0.0 to 1.0) per check: how sure the check is that its true/false verdict "
        "is correct - high for a clear match AND for a clear mismatch, low only when ambiguous. "
        "Not a similarity score (that is details.similarity).",
    )
    details: Dict[str, Any] = Field(
        default_factory=dict,
        description="Diagnostic details: similarity (raw similarity per check), compared_values and per-pair explanations",
    )


@router.post("/consistency", response_model=ConsistencyResponse)
def check_consistency_endpoint(payload: ConsistencyRequest):
    """
    Checks cross-document consistency (name matching, date-of-birth matching)
    across two or more documents from the same application.
    """
    result = check_consistency(payload.extractions)
    return result
