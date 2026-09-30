import sys, base64, numpy as np, cv2
sys.path.insert(0, sys.argv[1]); sys.path.insert(0, '/src')
from tests.test_quality import create_test_image
from app.services.quality_service import assess_image_quality
for kw in [{}, {"slight_blur": True}, {"glare": True}]:
    img = cv2.imdecode(np.frombuffer(base64.b64decode(create_test_image(width=800, height=600, **kw)), np.uint8), cv2.IMREAD_COLOR)
    r = assess_image_quality(img); d = r['details']
    print(kw, r['value'], r['confidence'], {k: d.get(k) for k in ('blur_score', 'glare_ratio', 'glare_peak_excess', 'cut_sides', 'edge_ink_runs')})
