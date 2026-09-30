from typing import Any, Dict, List
import cv2
import numpy as np
from app.config import settings


def assess_image_quality(image: np.ndarray) -> Dict[str, Any]:
    """
    Evaluates image quality for OCR processing using OpenCV:
    - Blur via Laplacian variance
    - Resolution check (minimum width & height)
    - Glare/overexposure via saturated white pixel histogram
    - Underexposure via mean luminance
    - Crop/completeness via edge margin heuristics

    CONFIDENCE SEMANTICS:
    The 'confidence' score (0.0 to 1.0) strictly measures the certainty of the verdict.
    - A clearly usable image (sharp text, ample resolution, zero glare) has high confidence (~0.90 - 0.99).
    - A clearly defective image (heavy blur, severe glare, tiny resolution) ALSO has high confidence (~0.90 - 0.99)
      in the verdict that it is unusable with those specific issues.
    - Borderline cases (e.g. blur variance very close to threshold) yield low confidence (<0.70), signalling
      to the routing engine that a human reviewer should make the final call.
    """
    h, w = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    issues: List[str] = []

    # 1. Blur check (Laplacian variance)
    laplacian = cv2.Laplacian(gray, cv2.CV_64F)
    blur_score = round(float(laplacian.var()), 2)
    blur_distance = (blur_score - settings.blur_threshold) / settings.blur_threshold
    if blur_score < settings.blur_threshold:
        issues.append("blurred")

    # 2. Resolution check
    resolution = [int(w), int(h)]
    w_dist = (w - settings.min_width) / settings.min_width
    h_dist = (h - settings.min_height) / settings.min_height
    min_res_dist = min(w_dist, h_dist)
    if w < settings.min_width or h < settings.min_height:
        issues.append("low_resolution")

    # 3. Glare / Overexposure check
    glare_mask = gray >= settings.glare_pixel_threshold
    glare_ratio = round(float(np.sum(glare_mask) / gray.size), 4)
    glare_dist = (settings.glare_ratio_threshold - glare_ratio) / settings.glare_ratio_threshold
    if glare_ratio > settings.glare_ratio_threshold:
        issues.append("glare_detected")

    # 4. Underexposure / Darkness check
    mean_luminance = float(np.mean(gray))
    if mean_luminance < 40.0:
        issues.append("underexposed")

    # 5. Crop / Completeness check
    top_strip = gray[:max(1, int(h * 0.05)), :]
    bottom_strip = gray[int(h * 0.95):, :]
    left_strip = gray[:, :max(1, int(w * 0.05))]
    right_strip = gray[:, int(w * 0.95):]

    strips = [top_strip, bottom_strip, left_strip, right_strip]
    blank_strips = sum(
        1 for s in strips 
        if s.size > 0 and float(np.std(s)) < settings.border_blank_variance_threshold
    )

    sobel_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    edge_mag = np.hypot(sobel_x, sobel_y)
    
    border_energy = (
        np.mean(edge_mag[0:2, :]) +
        np.mean(edge_mag[-2:, :]) +
        np.mean(edge_mag[:, 0:2]) +
        np.mean(edge_mag[:, -2:])
    ) / 4.0

    if border_energy > 55.0 or blank_strips >= 3:
        issues.append("cut_off_edge")

    usable = len(issues) == 0

    # Calculate certainty of the verdict based on distance from decision thresholds
    if usable:
        # Distance margin above thresholds
        blur_margin = min(max(blur_distance, 0.0), 1.5) / 1.5
        res_margin = min(max(min_res_dist, 0.0), 1.5) / 1.5
        glare_margin = min(max(glare_dist, 0.0), 1.0)
        
        min_margin = min(blur_margin, res_margin, glare_margin)
        base_conf = 0.55 + 0.40 * (0.5 * blur_margin + 0.3 * res_margin + 0.2 * glare_margin)
        if min_margin < 0.20:
            confidence = round(min(0.68, base_conf), 2)
        else:
            confidence = round(min(0.99, base_conf), 2)
    else:
        # Distance margin beyond failure thresholds (how obvious is the defect)
        max_defect_margin = 0.0
        if "blurred" in issues:
            blur_defect_margin = min(abs(blur_distance), 1.0)
            max_defect_margin = max(max_defect_margin, blur_defect_margin)
        if "low_resolution" in issues:
            res_defect_margin = min(abs(min_res_dist), 1.0)
            max_defect_margin = max(max_defect_margin, res_defect_margin)
        if "glare_detected" in issues:
            glare_defect_margin = min(abs(glare_dist), 2.0) / 2.0
            max_defect_margin = max(max_defect_margin, glare_defect_margin)
        if "underexposed" in issues:
            dark_margin = (40.0 - mean_luminance) / 40.0
            max_defect_margin = max(max_defect_margin, dark_margin)
        if "cut_off_edge" in issues:
            max_defect_margin = max(max_defect_margin, 0.8)

        # Baseline certainty for borderline fail is 0.58, scaling to 0.98 for clear defect
        confidence = round(min(0.98, 0.58 + 0.39 * max_defect_margin), 2)

    return {
        "value": {
            "usable": usable,
            "issues": issues
        },
        "confidence": confidence,
        "details": {
            "blur_score": blur_score,
            "resolution": resolution,
            "glare_ratio": glare_ratio
        }
    }
