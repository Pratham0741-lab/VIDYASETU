from typing import List
from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.services.quality_service import assess_image_quality
from app.utils.image import decode_base64_image

router = APIRouter(tags=["Quality Gate"])


class QualityRequest(BaseModel):
    image_base64: str = Field(..., description="Base64-encoded image string (api contract field name)")


class QualityValue(BaseModel):
    usable: bool = Field(..., description="Whether the image meets minimal quality standards for OCR processing")
    issues: List[str] = Field(..., description="Actionable defect list (e.g. 'blurred', 'underexposed', 'glare_detected')")


class QualityDetails(BaseModel):
    blur_score: float = Field(..., description="Laplacian variance blur measure")
    resolution: List[int] = Field(..., description="[width, height] dimensions in pixels")
    glare_ratio: float = Field(..., description="Proportion of saturated white pixels")


class QualityResponse(BaseModel):
    value: QualityValue
    confidence: float = Field(
        ...,
        description="Certainty of the verdict (0.0 to 1.0). High score indicates high certainty in the verdict (whether usable or defective); borderline cases score lower (<0.70) to prompt human review."
    )
    details: QualityDetails


@router.post("/quality", response_model=QualityResponse)
async def check_image_quality(payload: QualityRequest):
    image = decode_base64_image(payload.image_base64)
    result = assess_image_quality(image)
    return result
