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
        ('get', '/api/v1/analytics/funnel/export.xlsx', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/funnel/export.xlsx?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/funnel/export.pdf', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/funnel/export.pdf?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/sla/export.xlsx', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/sla/export.xlsx?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/sla/export.pdf', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/sla/export.pdf?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/schemes/export.xlsx', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/schemes/export.xlsx?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/schemes/export.pdf', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/schemes/export.pdf?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/disbursements/export.xlsx', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/disbursements/export.xlsx?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/disbursements/export.pdf', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/disbursements/export.pdf?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/fraud/export.xlsx', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/fraud/export.xlsx?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/fraud/export.pdf', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/fraud/export.pdf?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/jurisdiction/export.xlsx', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/jurisdiction/export.xlsx?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/jurisdiction/export.pdf', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/jurisdiction/export.pdf?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/workload', None, 200, ['STATE_NODAL_OFFICER','MINISTRY_OFFICER','AUDITOR','SUPER_ADMIN'], '/api/v1/analytics/workload?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/workload/export.csv', None, 200, ['STATE_NODAL_OFFICER','MINISTRY_OFFICER','AUDITOR','SUPER_ADMIN'], '/api/v1/analytics/workload/export.csv?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/workload/export.xlsx', None, 200, ['STATE_NODAL_OFFICER','MINISTRY_OFFICER','AUDITOR','SUPER_ADMIN'], '/api/v1/analytics/workload/export.xlsx?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/workload/export.pdf', None, 200, ['STATE_NODAL_OFFICER','MINISTRY_OFFICER','AUDITOR','SUPER_ADMIN'], '/api/v1/analytics/workload/export.pdf?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/verification-quality', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/verification-quality?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/verification-quality/export.csv', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/verification-quality/export.csv?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/verification-quality/export.xlsx', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/verification-quality/export.xlsx?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/verification-quality/export.pdf', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR'], '/api/v1/analytics/verification-quality/export.pdf?from=2026-04-01&to=2027-04-01'),
        ('get', '/api/v1/analytics/fairness/export.xlsx', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR','COMMITTEE'], '/api/v1/analytics/fairness/export.xlsx?scheme=NFST&academic_year=2031-32'),
        ('get', '/api/v1/analytics/fairness/export.pdf', None, 200, ['MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','SUPER_ADMIN','AUDITOR','COMMITTEE'], '/api/v1/analytics/fairness/export.pdf?scheme=NFST&academic_year=2031-32'),
    ],
    'C': [
        ('get', '/api/v1/officers/me/preferences', None, 200, ['SUPER_ADMIN','MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','COMMITTEE','AUDITOR']),
        ('put', '/api/v1/officers/me/preferences', {'preferred_language': 'hi'}, 200, ['SUPER_ADMIN','MINISTRY_OFFICER','STATE_NODAL_OFFICER','DISTRICT_NODAL_OFFICER','INSTITUTE_NODAL_OFFICER','COMMITTEE']),
        ('put', '/api/v1/admin/officers/:id/preferences', {'preferred_language': 'hi'}, 200, ['SUPER_ADMIN'], '/api/v1/admin/officers/${APP_ID}/preferences'),
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
