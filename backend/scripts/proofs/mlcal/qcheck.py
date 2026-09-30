import sys, glob, os, json
import cv2
sys.path.insert(0, sys.argv[1])
from app.services.quality_service import assess_image_quality
for f in sorted(glob.glob('/w/quality/*.png')):
    r = assess_image_quality(cv2.imread(f))
    d = r['details']
    extra = {k: d[k] for k in ('glare_peak_excess', 'paper_level', 'cut_sides', 'edge_ink_runs') if k in d}
    print(f"{os.path.basename(f)[:-4]:28s} usable={str(r['value']['usable']):5s} issues={str(r['value']['issues']):36s} conf={r['confidence']:<5} glare_ratio={d['glare_ratio']:<7} blur={d['blur_score']:<8} {json.dumps(extra) if extra else ''}")
