import cv2, json
from doc_render import render_document_layout, true_region


def cert(name, date, no):
    return "\n".join([
        "GOVERNMENT OF JHARKHAND REVENUE DEPARTMENT",
        "INCOME CERTIFICATE",
        f"Certificate No: {no}",
        f"This is to certify that annual family income from all sources of Shri {name}",
        "is Rs. 1,80,000 (Rupees One Lakh Eighty Thousand Only) per annum.",
        f"Issued by: Tahsildar, Ranchi Sadar Date: {date}",
        "Office of the Circle Officer, Ranchi Sadar, Jharkhand",
        "Seal and signature of the issuing authority",
        "This certificate is issued on the basis of the enquiry report.",
        "Verify at the district e-District portal.",
    ])


out = {}
for key, name, date, no in [("expired", "Mangal Oraon", "01/06/2024", "INC-JH-2024-13D01"),
                            ("valid", "Mangal Oraon", "05/05/2026", "INC-JH-2026-13D02"),
                            ("expired2", "Sunil Bara", "03/02/2024", "INC-JH-2024-13D03"),
                            ("valid2", "Sunil Bara", "07/04/2026", "INC-JH-2026-13D04")]:
    img, words = render_document_layout(cert(name, date, no))
    cv2.imwrite(f"/p/{key}.png", img)
    out[key] = {"size": [img.shape[1], img.shape[0]], "date_region": true_region(words, date)}
json.dump(out, open("/p/docs.json", "w"))
print(json.dumps(out))
