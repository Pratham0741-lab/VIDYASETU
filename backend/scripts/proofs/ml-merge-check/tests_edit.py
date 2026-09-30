import re
from pathlib import Path

for f in sorted(Path('tests').glob('test_*.py')):
    s = f.read_text(encoding='utf8')
    o = s
    # Paths now under the api contract prefix.
    s = re.sub(r'(["\'])/(quality|classify|extract|consistency)\1', r'\1/v1/documents/\2\1', s)
    # Request field names.
    s = s.replace('json={"image":', 'json={"image_base64":').replace("json={'image':", "json={'image_base64':")
    s = re.sub(r'"image": (image_b64|img_b64|b64|blank_b64|small_b64|[a-z_]*b64[a-z_]*)', r'"image_base64": \1', s)
    s = s.replace('"documents":', '"extractions":')
    if f.name == 'test_extract.py':
        s = s.replace('assert vals["certificate_number"] == "CST-MH-2024-88912"',
                      'assert vals["caste_cert_number"] == "CST-MH-2024-88912"')
        s = s.replace('''            assert vals["account_number"] == "30948291048"
            assert vals["ifsc_code"] == "SBIN0001234"''',
                      '''            assert vals["bank_account"] == "SBIN0001234:30948291048"
            assert "account_number" not in vals and "ifsc_code" not in vals''')
    if f.name == 'test_consistency.py':
        s = s.replace('''            json={"extractions": [{"name": "Only One Document"}]},
        )
        assert resp.status_code == 400
        assert resp.json()["code"] == "VALIDATION_ERROR"''',
                      '''            json={"extractions": [{"name": "Only One Document"}]},
        )
        # A "cannot tell" outcome, not a client error: no checks, reason stated.
        assert resp.status_code == 200
        assert resp.json()["value"] == {}
        assert resp.json()["details"]["reason"] == "fewer than two documents to compare"''')
        s = s.replace('''            json={"extractions": [{"field_a": "val1"}, {"field_b": "val2"}]},
        )
        assert resp.status_code == 400
        assert resp.json()["code"] == "VALIDATION_ERROR"
        assert "No comparable applicant fields" in resp.json()["message"]''',
                      '''            json={"extractions": [{"field_a": "val1"}, {"field_b": "val2"}]},
        )
        assert resp.status_code == 200
        assert resp.json()["value"] == {}
        assert "no comparable applicant fields" in resp.json()["details"]["reason"]''')
    if s != o:
        f.write_text(s, encoding='utf8', newline='\n')
        print('updated', f)
