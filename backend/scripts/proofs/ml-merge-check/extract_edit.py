p = 'app/services/extract_service.py'
s = open(p, encoding='utf8').read()

# --- caste certificate: certificate_number -> caste_cert_number (inside this class only)
i = s.index('class CasteCertificateExtractor(FieldExtractor):')
j = s.index('\nclass ', i + 10)
blk = s[i:j]
n = blk.count('"certificate_number"')
blk = blk.replace('"certificate_number"', '"caste_cert_number"')
blk = blk.replace('''            "category": None,
            "caste_cert_number": None,''', '''            "category": None,
            # api contract: the key on Phase 3's sensitive-field list (redacted/encrypted at rest).
            "caste_cert_number": None,''')
s = s[:i] + blk + s[j:]
print('caste renames:', n)

# --- bank passbook: account_number + ifsc_code -> bank_account "IFSC:ACCOUNT"
i = s.index('class BankPassbookExtractor(FieldExtractor):')
j = s.index('\nclass ', i + 10)
blk = s[i:j]
old_vals = '''        values: Dict[str, Any] = {
            "account_number": None,
            "ifsc_code": None,
            "account_holder_name": None,
            "bank_name": None,
        }'''
assert old_vals in blk, 'values block'
blk = blk.replace(old_vals, '''        # api contract: one "bank_account" field ("IFSC:ACCOUNT", the format used
        # at registration) - the key on Phase 3's sensitive-field list, so the
        # api redacts/encrypts it. Separate account/IFSC keys would be stored
        # as plain text.
        values: Dict[str, Any] = {
            "bank_account": None,
            "account_holder_name": None,
            "bank_name": None,
        }''')
old_acc = r'''        if acc_match:
            values["account_number"] = acc_match.group(1).strip()
            confs["account_number"] = round(min(0.97, max(0.72, ocr_conf * 0.98)), 2)

        # 2. IFSC Code
        ifsc_match = re.search(r"\b([A-Z]{4}0[A-Z0-9]{6})\b", text)
        if ifsc_match:
            values["ifsc_code"] = ifsc_match.group(1).strip()
            confs["ifsc_code"] = round(min(0.98, max(0.75, ocr_conf * 0.99)), 2)
'''
assert old_acc in blk, 'acc block'
blk = blk.replace(old_acc, r'''        # 2. IFSC Code
        ifsc_match = re.search(r"\b([A-Z]{4}0[A-Z0-9]{6})\b", text)

        # Combined: an account needs the number; the IFSC qualifies it when read.
        if acc_match:
            account = acc_match.group(1).strip()
            acc_conf = round(min(0.97, max(0.72, ocr_conf * 0.98)), 2)
            if ifsc_match:
                ifsc_conf = round(min(0.98, max(0.75, ocr_conf * 0.99)), 2)
                values["bank_account"] = f"{ifsc_match.group(1).strip()}:{account}"
                confs["bank_account"] = min(acc_conf, ifsc_conf)
            else:
                values["bank_account"] = account
                confs["bank_account"] = acc_conf
''')
s = s[:i] + blk + s[j:]
open(p, 'w', encoding='utf8', newline='\n').write(s)
print('bank combined')
