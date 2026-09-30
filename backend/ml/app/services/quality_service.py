from typing import Any, Dict, List, Tuple
import cv2
import numpy as np
from app.config import settings


def _paper_map(gray: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """The paper itself with the printing removed: a morphological closing wider
    than text strokes (full resolution), and the same at 1/8 scale."""
    h, w = gray.shape
    k = max(15, int(round(min(h, w) * 0.02))) | 1
    closed = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    small = cv2.resize(closed, (max(8, w // 8), max(8, h // 8)), interpolation=cv2.INTER_AREA)
    return closed, small.astype(np.float32)


def _glare_hotspots(paper: np.ndarray) -> Dict[str, float]:
    """Saturated paper that stands out above the page's smooth shading.

    A smooth quadratic surface (uniform paper, lighting gradients, vignetting)
    is fitted robustly to the paper map; hotspots are saturated pixels whose
    brightness exceeds that surface by glare_excess_threshold. A clean white
    scan is saturated everywhere but has no excess, so it is not glare.
    """
    hs, ws = paper.shape
    yy, xx = np.mgrid[0:hs, 0:ws]
    x = xx.ravel() / ws - 0.5
    y = yy.ravel() / hs - 0.5
    basis = np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], axis=1)
    z = paper.ravel()
    # Only the page itself: a dark surround (a desk around a photographed page)
    # is far below the page's bright level and would bend the surface.
    page = z >= float(np.percentile(z, 90)) - settings.ink_contrast_threshold
    keep = page if page.mean() >= 0.10 else np.ones(z.shape, dtype=bool)
    for _ in range(4):  # refit without outliers, so a hotspot cannot pull the surface up
        coef, *_ = np.linalg.lstsq(basis[keep], z[keep], rcond=None)
        resid = z - basis @ coef
        spread = max(1.0, 1.4826 * float(np.median(np.abs(resid[keep]))))
        keep = page & (np.abs(resid) <= 2.5 * spread)
    excess = resid.reshape(hs, ws)
    hotspot = (
        (paper >= settings.glare_pixel_threshold)
        & (excess >= settings.glare_excess_threshold)
        & page.reshape(hs, ws)
    )
    return {
        "ratio": round(float(hotspot.mean()), 4),
        "peak_excess": round(float(excess.max()), 1),
        "paper_level": round(float(np.median(paper)), 1),
    }


def _edge_ink_runs(gray: np.ndarray, closed: np.ndarray) -> Dict[str, Dict[str, float]]:
    """Per border: how printed content crosses the outermost pixels.

    Ink = clearly darker than the local paper (the closing), so a dark
    surround (desk) is not ink. Content cut by the image border crosses it as
    several separate ink runs; blank margins cross it with none.
    """
    h, w = gray.shape
    ink = (closed.astype(np.int16) - gray.astype(np.int16)) >= settings.ink_contrast_threshold
    bh, bw = max(3, int(round(h * 0.005))), max(3, int(round(w * 0.005)))
    bands = {
        "top": ink[:bh, :].any(axis=0),
        "bottom": ink[h - bh:, :].any(axis=0),
        "left": ink[:, :bw].any(axis=1),
        "right": ink[:, w - bw:].any(axis=1),
    }
    out = {}
    for side, profile in bands.items():
        p = profile.astype(np.int8)
        runs = int(p[0]) + int(np.count_nonzero(np.diff(p) == 1))
        out[side] = {"runs": runs, "coverage": round(float(p.mean()), 4)}
    return out


def assess_image_quality(image: np.ndarray) -> Dict[str, Any]:
    """
    Evaluates image quality for OCR processing using OpenCV:
    - Blur via Laplacian variance
    - Resolution check (minimum width & height)
    - Glare via saturated hotspots standing out above the page's own shading
    - Underexposure via mean luminance
    - Crop/completeness via printed content crossing the image border

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

    # 3. Glare: localized saturated hotspots, not uniformly bright paper
    closed, paper = _paper_map(gray)
    glare = _glare_hotspots(paper)
    glare_ratio = glare["ratio"]
    glare_dist = (settings.glare_ratio_threshold - glare_ratio) / settings.glare_ratio_threshold
    if glare_ratio > settings.glare_ratio_threshold:
        issues.append("glare_detected")

    # 4. Underexposure / Darkness check
    mean_luminance = float(np.mean(gray))
    if mean_luminance < 40.0:
        issues.append("underexposed")

    # 5. Crop / completeness: printed content crossing the image border. Blank
    #    margins (however wide) are what a complete page looks like.
    edges = _edge_ink_runs(gray, closed)
    cut_sides = [
        side for side, e in edges.items()
        if e["runs"] >= settings.cut_off_min_runs and 0.005 <= e["coverage"] <= 0.9
    ]
    if cut_sides:
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
            glare_defect_margin = min(abs(glare_dist), 1.0)
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
            "glare_ratio": glare_ratio,
            "glare_peak_excess": glare["peak_excess"],
            "paper_level": glare["paper_level"],
            "cut_sides": cut_sides,
            "edge_ink_runs": {side: e["runs"] for side, e in edges.items()},
        }
    }
