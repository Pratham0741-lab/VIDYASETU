"""
Crop (Phase 13D): the region of a stored document around a field box, for
the deficiency notice's "see the marked area" link. The box is in the stored
image's own pixel grid (extract's `boxes`), so the image is decoded WITHOUT
applying EXIF orientation, cropped with a margin, and only then turned
upright for display. Never the whole page: a region (margin included)
covering more than MAX_AREA_FRACTION of the page is refused. Nothing is
written anywhere; the image and the crop live only for this request.
"""

import base64

import cv2
import numpy as np
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.errors import AppError, ErrorCode, InvalidImageError
from app.services.field_boxes import exif_orientation
from app.utils.image import decode_base64_image_with_bytes
from app.utils.pdf import is_pdf

router = APIRouter(tags=["Crop"])

MAX_AREA_FRACTION = 0.5
MAX_MARGIN = 200


class CropRequest(BaseModel):
    image_base64: str
    page: int = Field(1, ge=1, le=1, description="single images only: page 1")
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    width: int = Field(..., ge=1)
    height: int = Field(..., ge=1)
    margin: int = Field(24, ge=0, le=MAX_MARGIN, description="pixels added on every side")


class CropResponse(BaseModel):
    png_base64: str
    region: dict = Field(..., description="the region cut from the stored image, margin included")


_UPRIGHT = {
    2: lambda a: cv2.flip(a, 1),
    3: lambda a: cv2.rotate(a, cv2.ROTATE_180),
    4: lambda a: cv2.flip(a, 0),
    5: lambda a: cv2.transpose(a),
    6: lambda a: cv2.rotate(a, cv2.ROTATE_90_CLOCKWISE),
    7: lambda a: cv2.rotate(cv2.transpose(a), cv2.ROTATE_180),
    8: lambda a: cv2.rotate(a, cv2.ROTATE_90_COUNTERCLOCKWISE),
}


@router.post("/crop", response_model=CropResponse)
async def crop_endpoint(payload: CropRequest):
    decoded, raw = decode_base64_image_with_bytes(payload.image_base64)
    # Phase 13E: a PDF's boxes are in its page-1 raster - crop that raster.
    pdf = is_pdf(raw)
    stored = decoded if pdf else cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
    if stored is None:
        raise InvalidImageError("Cannot decode the stored image.")
    h, w = stored.shape[:2]
    m = payload.margin
    x0, y0 = max(0, payload.x - m), max(0, payload.y - m)
    x1, y1 = min(w, payload.x + payload.width + m), min(h, payload.y + payload.height + m)
    if x1 <= x0 or y1 <= y0:
        raise AppError(ErrorCode.VALIDATION_ERROR, "The box lies outside the image.", 400)
    if (x1 - x0) * (y1 - y0) > MAX_AREA_FRACTION * w * h:
        raise AppError(
            ErrorCode.UNPROCESSABLE_ENTITY,
            "The region is too large: a crop never shows the whole page.",
            422,
            {"max_area_fraction": MAX_AREA_FRACTION},
        )
    region = stored[y0:y1, x0:x1]
    orientation = 1 if pdf else exif_orientation(raw)
    if orientation in _UPRIGHT:
        region = _UPRIGHT[orientation](region)
    ok, buf = cv2.imencode(".png", region)
    if not ok:
        raise AppError(ErrorCode.INTERNAL_ERROR, "Could not encode the crop.", 500)
    return {
        "png_base64": base64.b64encode(buf.tobytes()).decode("ascii"),
        "region": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0, "page": 1},
    }
