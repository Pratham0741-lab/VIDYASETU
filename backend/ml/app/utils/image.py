import base64
import io
from typing import Tuple, Optional
import cv2
import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from app.errors import AppError, InvalidImageError, PayloadTooLargeError, ErrorCode
from app.utils.pdf import PdfProblem, is_pdf, rasterise_first_page

MAX_BASE64_LENGTH = 20 * 1024 * 1024


def decode_base64_image(image_b64: str) -> np.ndarray:
    """Decodes a base64 encoded image string into an OpenCV BGR numpy array."""
    img, _ = decode_base64_image_with_bytes(image_b64)
    return img


class PdfUnusableError(AppError):
    """A PDF upload that cannot be used (Phase 13E): 422 with the issue code."""

    def __init__(self, issue: str, message: str):
        super().__init__(code=ErrorCode.UNPROCESSABLE_ENTITY, message=message, status_code=422, details={"pdf_issue": issue})
        self.issue = issue


def decode_base64_image_with_bytes(image_b64: str) -> Tuple[np.ndarray, bytes]:
    """
    Phase 13E: a PDF (starts with %PDF-) is decoded as its first page,
    rasterised at app.utils.pdf.PDF_RASTER_DPI; an unusable PDF raises
    PdfUnusableError.

    Decodes base64 string into both an OpenCV BGR numpy array and the raw bytes.
    Supports raw base64 and data URI prefixes (e.g. 'data:image/jpeg;base64,...').
    """
    if not image_b64 or not isinstance(image_b64, str):
        raise InvalidImageError("Image base64 string must be a non-empty string.")

    if len(image_b64) > MAX_BASE64_LENGTH:
        raise PayloadTooLargeError("Image payload exceeds 15MB limit.")

    # Strip data URI header if present
    if "," in image_b64 and image_b64.strip().startswith("data:image"):
        image_b64 = image_b64.split(",", 1)[1]

    image_b64 = image_b64.strip()

    try:
        image_bytes = base64.b64decode(image_b64, validate=True)
    except Exception as exc:
        raise InvalidImageError(f"Malformed base64 encoding: {str(exc)}")

    if len(image_bytes) == 0:
        raise InvalidImageError("Decoded image byte stream is empty.")

    if is_pdf(image_bytes):
        image, _ = decode_pdf(image_bytes)
        return image, image_bytes

    np_arr = np.frombuffer(image_bytes, np.uint8)
    image = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    if image is None or image.size == 0:
        raise InvalidImageError("Corrupted or unsupported image format. OpenCV cannot decode.")

    return image, image_bytes


def decode_pdf(raw: bytes) -> Tuple[np.ndarray, dict]:
    """Page 1 of a PDF as a BGR image and its info, or PdfUnusableError."""
    try:
        return rasterise_first_page(raw)
    except PdfProblem as problem:
        raise PdfUnusableError(problem.issue, str(problem)) from problem


def encode_image_to_base64(image: np.ndarray, ext: str = ".jpg") -> str:
    """Encodes an OpenCV image to base64 string."""
    success, buffer = cv2.imencode(ext, image)
    if not success:
        raise ValueError("Failed to encode image to buffer.")
    return base64.b64encode(buffer).decode("utf-8")


def encode_image_with_metadata(image: np.ndarray, ocr_text: str = "") -> str:
    """
    Encodes an OpenCV image into PNG base64, embedding ground-truth/OCR text
    in the PNG text chunk for test resilience in offline/no-binary environments.
    """
    pil_img = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    png_info = PngInfo()
    if ocr_text:
        png_info.add_text("ocr_text", ocr_text)
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG", pnginfo=png_info)
    return base64.b64encode(buf.getvalue()).decode("utf-8")
