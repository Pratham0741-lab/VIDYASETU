import sys, cv2
sys.path.insert(0, sys.argv[1])
from app.services.ocr_service import extract_raw_text
for i in sys.argv[2:]:
    t, c = extract_raw_text(cv2.imread(f'/w/set/docs/{i}.png'))
    print(f'--- {i} (ocr_conf {c})'); print(t)
