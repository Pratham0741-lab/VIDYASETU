from typing import Any, Dict, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.extract_service import extract_document_fields
from app.utils.image import decode_base64_image_with_bytes

router = APIRouter(tags=["Extraction"])


class ExtractRequest(BaseModel):
    image_base64: str = Field(..., description="Base64-encoded image string (api contract field name)")
    document_type: Optional[str] = Field(
        None,
        description="Known or pre-classified document type (e.g. INCOME_CERTIFICATE). If omitted, automatically determined.",
    )


class FieldBox(BaseModel):
    page: int = Field(..., description="1-based page (single images: always 1)")
    x: int
    y: int
    width: int
    height: int
    coordinate_space: str = Field(
        ...,
        description="stored_image_pixels: the original stored file's pixel grid (EXIF orientation undone)",
    )


class ExtractResponse(BaseModel):
    value: Dict[str, Any] = Field(
        ...,
        description="Extracted key-value fields specific to the document type",
    )
    confidence: Dict[str, float] = Field(
        ...,
        description="Per-field confidence scores (0.0 to 1.0) indicating certainty of each extracted field",
    )
    raw_text: str = Field(
        ...,
        description="Full raw OCR text extracted from the document image",
    )
    document_type: str = Field(
        ...,
        description="Resolved document type (either caller-provided or auto-classified)",
    )
    document_type_confidence: float = Field(
        ...,
        description="Confidence in the document type determination (1.0 if caller-specified, or classifier confidence if auto-classified)",
    )
    low_confidence_auto_classification: bool = Field(
        default=False,
        description="Flag indicating if document type was auto-classified below classify_min_confidence (0.40). When True, field confidences are strictly capped.",
    )
    boxes: Optional[Dict[str, Optional[FieldBox]]] = Field(
        default=None,
        description="Phase 13D (optional, backward compatible): per field, the page and box it was read from, or null when it cannot be tied to exactly one place.",
    )


@router.post("/extract", response_model=ExtractResponse)
async def extract_fields_endpoint(payload: ExtractRequest):
    """
    Extracts structured fields from a document image based on its document type.
    Returns per-field values and per-field confidence scores.
    """
    image, raw_bytes = decode_base64_image_with_bytes(payload.image_base64)
    result = extract_document_fields(
        image=image,
        raw_bytes=raw_bytes,
        document_type=payload.document_type,
    )
    return result
