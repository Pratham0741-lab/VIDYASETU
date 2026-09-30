from typing import List, Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.services.quality_service import assess_image_quality
from app.utils.image import PdfUnusableError, decode_base64_image_with_bytes
from app.utils.pdf import is_pdf, pdf_info

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
    pdf: Optional[dict] = Field(
        default=None,
        description="Phase 13E, PDFs only: {page_count, page_used, page_size_pt, dpi} - only page 1 is read",
    )


class QualityResponse(BaseModel):
    value: QualityValue
    confidence: float = Field(
        ...,
        description="Certainty of the verdict (0.0 to 1.0). High score indicates high certainty in the verdict (whether usable or defective); borderline cases score lower (<0.70) to prompt human review."
    )
    details: QualityDetails


@router.post("/quality", response_model=QualityResponse)
async def check_image_quality(payload: QualityRequest):
    # Phase 13E: a PDF is judged on its rasterised page 1; an unusable PDF
    # (encrypted / unreadable / too large) is a clean "not usable" verdict,
    # so the api records it like any rejected scan - never an error.
    try:
        image, raw = decode_base64_image_with_bytes(payload.image_base64)
    except PdfUnusableError as err:
        return {
            "value": {"usable": False, "issues": [err.issue]},
            "confidence": 1.0,
            "details": {"blur_score": 0.0, "resolution": [0, 0], "glare_ratio": 0.0},
        }
    result = assess_image_quality(image)
    if is_pdf(raw):
        result["details"]["pdf"] = pdf_info(raw)
    return result
