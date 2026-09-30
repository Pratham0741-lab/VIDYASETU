"""Append routes to test/rbac-matrix.e2e-spec.ts ROUTES (Phase 14 loose ends).

usage: python rbac_add.py <part>   (part = A | B | C | D | E)
"""
import json
import sys

P = 'D:/PROJECTS/SIH_FELLOWSHIP/vidyasetu/api/test/rbac-matrix.e2e-spec.ts'
ROLES = ['APPLICANT', 'SUPER_ADMIN', 'MINISTRY_OFFICER', 'STATE_NODAL_OFFICER',
         'DISTRICT_NODAL_OFFICER', 'INSTITUTE_NODAL_OFFICER', 'COMMITTEE', 'AUDITOR']
OFFICERS = ROLES[1:]
SA_MO = ['SUPER_ADMIN', 'MINISTRY_OFFICER']

APP = '${APP_ID}'
UUID2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

PARTS = {
    'E': [
        ('get', '/api/v1/document-access', None, 200, ['MINISTRY_OFFICER', 'SUPER_ADMIN', 'STATE_NODAL_OFFICER', 'DISTRICT_NODAL_OFFICER', 'AUDITOR']),
    ],
    'C': [
        ('post', '/api/v1/admin/retention/run', {'dry_run': True}, 200, ['SUPER_ADMIN']),
        ('get', '/api/v1/admin/retention/runs', None, 200, ['SUPER_ADMIN', 'AUDITOR']),
    ],
    'B': [
        ('get', '/api/v1/applicants/me/consents', None, 200, ['APPLICANT']),
        ('post', '/api/v1/applicants/me/consents', {'purpose': 'application_processing', 'status': 'GIVEN', 'notice_version': '2026-10-v1', 'language': 'en'}, 201, ['APPLICANT']),
        ('get', '/api/v1/applicants/me/data-export', None, 200, ['APPLICANT']),
        ('post', '/api/v1/applicants/me/correction-requests', {'field': 'first_name', 'value': 'Asha', 'reason': 'Spelling differs from my certificate.'}, 201, ['APPLICANT']),
        ('get', '/api/v1/applicants/me/correction-requests', None, 200, ['APPLICANT']),
        ('post', '/api/v1/applicants/me/erasure-requests', None, 201, ['APPLICANT']),
        ('get', '/api/v1/applicants/me/erasure-requests', None, 200, ['APPLICANT']),
        ('get', '/api/v1/correction-requests', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER'] + ['AUDITOR']),
        ('post', '/api/v1/correction-requests/:id/decide', {'decision': 'REJECT', 'reason': 'The certificate shows the stored spelling.'}, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER'], '/api/v1/correction-requests/${APP_ID}/decide'),
    ],
}


def entry(method, key, body, ok, allowed, path=None):
    path = path or key
    lines = [f"  '{method.upper()} {key}': {{",
             f"    method: '{method}',",
             f"    path: `{path}`,"]
    if body is not None:
        lines.append(f"    body: {json.dumps(body)},")
    lines.append(f"    okStatus: {ok},")
    lines.append("    matrix: {")
    for r in ROLES:
        lines.append(f"      {r}: {'A' if r in allowed else 'D'},")
    lines.append("    },")
    lines.append("  },")
    return '\n'.join(lines) + '\n'


def main(part):
    s = open(P, encoding='utf8').read()
    marker = '};\n\n// ---------------------------------------------------------------------------\n'
    i = s.find('\nconst CLAIMS')
    j = s.rfind('\n};\n', 0, i)
    assert j > 0
    add = ''.join(entry(*r) for r in PARTS[part])
    for r in PARTS[part]:
        assert f"'{r[0].upper()} {r[1]}'" not in s, r[1]
    s = s[:j + 1] + add + s[j + 1:]
    open(P, 'w', encoding='utf8', newline='\n').write(s)
    print('added', len(PARTS[part]))


main(sys.argv[1])
