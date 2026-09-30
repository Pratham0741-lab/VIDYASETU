from pathlib import Path

ROOT = Path('D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/ml/app')


def edit(rel, pairs):
    p = ROOT / rel
    s = p.read_text(encoding='utf8')
    s = __import__('re').sub(r'[ \t]+\n', '\n', s)
    for old, new in pairs:
        assert s.count(old) == 1, (rel, old[:70])
        s = s.replace(old, new)
    p.write_text(s, encoding='utf8', newline='\n')
    print('edited', p)


edit('services/quality_service.py', [
    ('''from typing import Any, Dict, List
import cv2''', '''from typing import Any, Dict, List, Tuple
import cv2'''),
    ('''def assess_image_quality(image: np.ndarray) -> Dict[str, Any]:''',
     '''def _paper_map(gray: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
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
    keep = np.ones(z.shape, dtype=bool)
    for _ in range(4):  # refit without outliers, so a hotspot cannot pull the surface up
        coef, *_ = np.linalg.lstsq(basis[keep], z[keep], rcond=None)
        resid = z - basis @ coef
        spread = max(1.0, 1.4826 * float(np.median(np.abs(resid[keep]))))
        keep = np.abs(resid) <= 2.5 * spread
    excess = resid.reshape(hs, ws)
    hotspot = (paper >= settings.glare_pixel_threshold) & (excess >= settings.glare_excess_threshold)
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


def assess_image_quality(image: np.ndarray) -> Dict[str, Any]:'''),
    ('''    - Glare/overexposure via saturated white pixel histogram''',
     '''    - Glare via saturated hotspots standing out above the page's own shading'''),
    ('''    - Crop/completeness via edge margin heuristics''',
     '''    - Crop/completeness via printed content crossing the image border'''),
    ('''    # 3. Glare / Overexposure check
    glare_mask = gray >= settings.glare_pixel_threshold
    glare_ratio = round(float(np.sum(glare_mask) / gray.size), 4)
    glare_dist''', '''    # 3. Glare: localized saturated hotspots, not uniformly bright paper
    closed, paper = _paper_map(gray)
    glare = _glare_hotspots(paper)
    glare_ratio = glare["ratio"]
    glare_dist'''),
    ('''    # 5. Crop / Completeness check
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
''', '''    # 5. Crop / completeness: printed content crossing the image border. Blank
    #    margins (however wide) are what a complete page looks like.
    edges = _edge_ink_runs(gray, closed)
    cut_sides = [
        side for side, e in edges.items()
        if e["runs"] >= settings.cut_off_min_runs and 0.005 <= e["coverage"] <= 0.9
    ]
    if cut_sides:
        issues.append("cut_off_edge")
'''),
    ('''        if "glare_detected" in issues:
            glare_defect_margin = min(abs(glare_dist), 2.0) / 2.0''',
     '''        if "glare_detected" in issues:
            glare_defect_margin = min(abs(glare_dist), 1.0)'''),
    ('''            "glare_ratio": glare_ratio
        }''', '''            "glare_ratio": glare_ratio,
            "glare_peak_excess": glare["peak_excess"],
            "paper_level": glare["paper_level"],
            "cut_sides": cut_sides,
            "edge_ink_runs": {side: e["runs"] for side, e in edges.items()},
        }'''),
])
