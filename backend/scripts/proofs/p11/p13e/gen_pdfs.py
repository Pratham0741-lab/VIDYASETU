import json
from doc_render import render_pdf, handmade_pdf, true_region
cert = "\n".join([
    "GOVERNMENT OF JHARKHAND REVENUE DEPARTMENT", "INCOME CERTIFICATE", "Certificate No: INC-JH-2024-13E01",
    "This is to certify that annual family income from all sources of Shri Karma Oraon",
    "is Rs. 1,80,000 (Rupees One Lakh Eighty Thousand Only) per annum.",
    "Issued by: Tahsildar, Ranchi Sadar Date: 01/06/2024",
    "Office of the Circle Officer, Ranchi Sadar, Jharkhand", "Seal and signature of the issuing authority",
    "This certificate is issued on the basis of the enquiry report.", "Verify at the district e-District portal."])
pdf, words = render_pdf(cert)
open("/p/cert.pdf", "wb").write(pdf)
open("/p/encrypted.pdf", "wb").write(handmade_pdf(encrypt=True))
json.dump({"date_region": true_region(words, "01/06/2024")}, open("/p/pdfs.json", "w"))
print(len(pdf), "bytes; date region", true_region(words, "01/06/2024"))
