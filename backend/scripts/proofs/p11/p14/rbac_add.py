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
    'A': [
        ('get', '/api/v1/admin/schemes', None, 200, OFFICERS),
        ('post', '/api/v1/admin/schemes', {
            'code': 'NEW_SCHEME', 'name': 'New scheme', 'department': 'Dept',
            'type': 'CENTRAL_SECTOR'}, 201, SA_MO),
        ('get', '/api/v1/admin/schemes/:code/diff', None, 200, OFFICERS,
         '/api/v1/admin/schemes/NFST/diff?from=4&to=5'),
        ('get', '/api/v1/admin/schemes/:code/versions/:version', None, 200, OFFICERS,
         '/api/v1/admin/schemes/NFST/versions/5'),
        ('post', '/api/v1/admin/schemes/:code/versions', {'based_on_version': 5}, 201, SA_MO,
         '/api/v1/admin/schemes/NFST/versions'),
        ('patch', '/api/v1/admin/schemes/:code/versions/:version', {'source_url': 'x'}, 200, SA_MO,
         '/api/v1/admin/schemes/NFST/versions/6'),
        ('post', '/api/v1/admin/schemes/:code/versions/:version/validate', None, 200, SA_MO,
         '/api/v1/admin/schemes/NFST/versions/6/validate'),
        ('post', '/api/v1/admin/schemes/:code/versions/:version/preview', {'applicant': {}}, 200,
         SA_MO, '/api/v1/admin/schemes/NFST/versions/6/preview'),
        ('post', '/api/v1/admin/schemes/:code/versions/:version/publish', {}, 200, SA_MO,
         '/api/v1/admin/schemes/NFST/versions/6/publish'),
        ('post', '/api/v1/admin/schemes/:code/versions/:version/retire', None, 200, SA_MO,
         '/api/v1/admin/schemes/NFST/versions/5/retire'),
    ],
    'B': [
        ('get', '/api/v1/applications/sla-breaches/recorded', None, 200,
         ['MINISTRY_OFFICER', 'STATE_NODAL_OFFICER', 'DISTRICT_NODAL_OFFICER',
          'INSTITUTE_NODAL_OFFICER', 'AUDITOR']),
        ('post', '/api/v1/applications/sla-breaches/sweep', None, 200, ['SUPER_ADMIN']),
    ],
    'C': [
        ('post', '/api/v1/application-drafts', {'academic_year': '2026-27'}, 201, ['APPLICANT']),
        ('get', '/api/v1/application-drafts', None, 200, ['APPLICANT']),
        ('get', '/api/v1/application-drafts/:id', None, 200, ['APPLICANT'],
         '/api/v1/application-drafts/${APP_ID}'),
        ('patch', '/api/v1/application-drafts/:id', {'course_year': 2}, 200, ['APPLICANT'],
         '/api/v1/application-drafts/${APP_ID}'),
        ('post', '/api/v1/application-drafts/:id/submit', None, 201, ['APPLICANT'],
         '/api/v1/application-drafts/${APP_ID}/submit'),
    ],
    'E': [
        ('post', '/api/v1/applicants/me/aadhaar-authentication',
         {'aadhaar_number': '0999 0000 0017', 'consent': True}, 200, ['APPLICANT']),
        ('get', '/api/v1/applicants/me/aadhaar-authentication', None, 200, ['APPLICANT']),
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
