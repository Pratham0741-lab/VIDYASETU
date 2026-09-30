from typing import List
from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.services.classify_service import classify_document
from app.utils.image import decode_base64_image_with_bytes

router = APIRouter(tags=["Classification"])


class ClassifyRequest(BaseModel):
    image_base64: str = Field(..., description="Base64-encoded image string (api contract field name)")


class AlternativeClassification(BaseModel):
    type: str = Field(..., description="Alternative document type from canonical enum")
    confidence: float = Field(..., description="Calibrated likelihood score (0.0 to 1.0)")


class ClassifyResponse(BaseModel):
    value: str = Field(..., description="Predicted DocumentType enum value")
    confidence: float = Field(
        ..., 
        description="Certainty score of the classification verdict (0.0 to 1.0). High score indicates high certainty in the type; low score (<0.70) routes to human reviewer."
    )
    alternatives: List[AlternativeClassification] = Field(
        default_factory=list,
        description="Top alternative candidate document types with confidence scores"
    )


@router.post("/classify", response_model=ClassifyResponse)
async def classify_document_endpoint(payload: ClassifyRequest):
    image, raw_bytes = decode_base64_image_with_bytes(payload.image_base64)
    result = classify_document(image, raw_bytes)
    return result
