"""Rebuild the teammate's ORIGINAL test expectations in a temp dir (reverse of tests_edit.py)."""
import re
import shutil
from pathlib import Path

src = Path('D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/ml/tests')
dst = Path('D:/PROJECTS/SIH_FELLOWSHIP/.ml-merge-check/tests-original')
shutil.rmtree(dst, ignore_errors=True)
shutil.copytree(src, dst, ignore=shutil.ignore_patterns('__pycache__'))
for f in sorted(dst.glob('test_*.py')):
    s = f.read_text(encoding='utf8')
    s = re.sub(r'(["\'])/v1/documents/(quality|classify|extract|consistency)\1', r'\1/\2\1', s)
    s = s.replace('"image_base64":', '"image":').replace("'image_base64':", "'image':")
    s = s.replace('"extractions":', '"documents":')
    s = s.replace('assert vals["caste_cert_number"] == "CST-MH-2024-88912"',
                  'assert vals["certificate_number"] == "CST-MH-2024-88912"')
    s = s.replace('''            assert vals["bank_account"] == "SBIN0001234:30948291048"
            assert "account_number" not in vals and "ifsc_code" not in vals''',
                  '''            assert vals["account_number"] == "30948291048"
            assert vals["ifsc_code"] == "SBIN0001234"''')
    s = s.replace('''        # A "cannot tell" outcome, not a client error: no checks, reason stated.
        assert resp.status_code == 200
        assert resp.json()["value"] == {}
        assert resp.json()["details"]["reason"] == "fewer than two documents to compare"''',
                  '''        assert resp.status_code == 400
        assert resp.json()["code"] == "VALIDATION_ERROR"''')
    s = s.replace('''        assert resp.status_code == 200
        assert resp.json()["value"] == {}
        assert "no comparable applicant fields" in resp.json()["details"]["reason"]''',
                  '''        assert resp.status_code == 400
        assert resp.json()["code"] == "VALIDATION_ERROR"
        assert "No comparable applicant fields" in resp.json()["message"]''')
    f.write_text(s, encoding='utf8', newline='\n')
print('original expectations rebuilt in', dst)
