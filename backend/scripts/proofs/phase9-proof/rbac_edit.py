p = 'test/rbac-matrix.e2e-spec.ts'
s = open(p, encoding='utf8').read()

M = "{ APPLICANT: A, SUPER_ADMIN: D, MINISTRY_OFFICER: A, STATE_NODAL_OFFICER: D, DISTRICT_NODAL_OFFICER: D, INSTITUTE_NODAL_OFFICER: D }"
MIN_ONLY = "{ APPLICANT: D, SUPER_ADMIN: D, MINISTRY_OFFICER: A, STATE_NODAL_OFFICER: D, DISTRICT_NODAL_OFFICER: D, INSTITUTE_NODAL_OFFICER: D }"
APP_ONLY = "{ APPLICANT: A, SUPER_ADMIN: D, MINISTRY_OFFICER: D, STATE_NODAL_OFFICER: D, DISTRICT_NODAL_OFFICER: D, INSTITUTE_NODAL_OFFICER: D }"
INO_ONLY = "{ APPLICANT: D, SUPER_ADMIN: D, MINISTRY_OFFICER: D, STATE_NODAL_OFFICER: D, DISTRICT_NODAL_OFFICER: D, INSTITUTE_NODAL_OFFICER: A }"
APP_REV = "{ APPLICANT: A, SUPER_ADMIN: D, MINISTRY_OFFICER: A, STATE_NODAL_OFFICER: A, DISTRICT_NODAL_OFFICER: A, INSTITUTE_NODAL_OFFICER: A }"
REV = "{ APPLICANT: D, SUPER_ADMIN: D, MINISTRY_OFFICER: A, STATE_NODAL_OFFICER: A, DISTRICT_NODAL_OFFICER: A, INSTITUTE_NODAL_OFFICER: A }"
ALL = "{ APPLICANT: A, SUPER_ADMIN: A, MINISTRY_OFFICER: A, STATE_NODAL_OFFICER: A, DISTRICT_NODAL_OFFICER: A, INSTITUTE_NODAL_OFFICER: A }"
del M

routes = [
    ('POST /api/v1/selections/:id/confirm', 'post', '`/api/v1/selections/${APP_ID}/confirm`', "{ override_reason: 'Committee sign-off' }", 200, MIN_ONLY),
    ('POST /api/v1/selections/:id/sanction-order', 'post', '`/api/v1/selections/${APP_ID}/sanction-order`', None, 201, MIN_ONLY),
    ('GET /api/v1/sanction-orders/:id', 'get', '`/api/v1/sanction-orders/${APP_ID}`', None, 200, APP_REV),
    ('GET /api/v1/sanction-orders/:id/pdf', 'get', '`/api/v1/sanction-orders/${APP_ID}/pdf`', None, 200, APP_REV),
    ('POST /api/v1/sanction-orders/verify', 'post', "'/api/v1/sanction-orders/verify'", "{ content: { sanction_order_id: APP_ID } }", 200, ALL),
    ('POST /api/v1/selections/:id/disbursements', 'post', '`/api/v1/selections/${APP_ID}/disbursements`', None, 201, MIN_ONLY),
    ('GET /api/v1/applications/:id/disbursements', 'get', '`/api/v1/applications/${APP_ID}/disbursements`', None, 200, APP_REV),
    ('POST /api/v1/disbursements/:id/initiate', 'post', '`/api/v1/disbursements/${APP_ID}/initiate`', None, 200, MIN_ONLY),
    ('POST /api/v1/disbursements/:id/reconcile', 'post', '`/api/v1/disbursements/${APP_ID}/reconcile`', None, 200, MIN_ONLY),
    ('GET /api/v1/applications/:id/renewals', 'get', '`/api/v1/applications/${APP_ID}/renewals`', None, 200, APP_REV),
    ('POST /api/v1/applications/:id/renewals', 'post', '`/api/v1/applications/${APP_ID}/renewals`', "{ academic_year: '2027-28', academic_year_number: 2, passed_previous_year: true, progress_report: 'Chapter 2 complete.' }", 201, APP_ONLY),
    ('POST /api/v1/renewals/:id/endorse', 'post', '`/api/v1/renewals/${APP_ID}/endorse`', "{ remarks: 'Endorsed.' }", 200, INO_ONLY),
    ('POST /api/v1/renewals/:id/continuation-check', 'post', '`/api/v1/renewals/${APP_ID}/continuation-check`', None, 200, MIN_ONLY),
    ('POST /api/v1/renewals/:id/decide', 'post', '`/api/v1/renewals/${APP_ID}/decide`', "{ decision: 'APPROVE' }", 200, MIN_ONLY),
    ('POST /api/v1/grievances', 'post', "'/api/v1/grievances'", "{ application_id: APP_ID, subject_type: 'APPLICATION', description: 'Stipend not received.' }", 201, APP_ONLY),
    ('GET /api/v1/grievances', 'get', "'/api/v1/grievances'", None, 200, APP_REV),
    ('GET /api/v1/grievances/:id', 'get', '`/api/v1/grievances/${APP_ID}`', None, 200, APP_REV),
    ('POST /api/v1/grievances/:id/start', 'post', '`/api/v1/grievances/${APP_ID}/start`', None, 200, REV),
    ('POST /api/v1/grievances/:id/resolve', 'post', '`/api/v1/grievances/${APP_ID}/resolve`', "{ outcome: 'RESOLVED', note: 'Paid.' }", 200, REV),
]
block = ''
for name, method, path, body, ok, matrix in routes:
    block += "  '%s': {\n    method: '%s',\n    path: %s,\n%s    okStatus: %d,\n    matrix: %s,\n  },\n" % (
        name, method, path, ('    body: %s,\n' % body) if body else '', ok, matrix)
anchor = "};\n\n// A representative, valid identity per role"
assert anchor in s
s = s.replace(anchor, block + anchor, 1)

imp = "import { NotificationsService } from '../src/notifications/notifications.service';\n"
assert imp in s
s = s.replace(imp, imp + "import { DisbursementService } from '../src/post-selection/disbursement.service';\nimport { GrievanceService } from '../src/post-selection/grievance.service';\nimport { RenewalService } from '../src/post-selection/renewal.service';\nimport { SanctionService } from '../src/post-selection/sanction.service';\n", 1)
ov = "      .overrideProvider(AdminService)"
assert ov in s
s = s.replace(ov, """      .overrideProvider(SanctionService)
      .useValue({
        confirm: () => Promise.resolve({}),
        generate: () => Promise.resolve({}),
        get: () => Promise.resolve({}),
        pdf: () => Promise.resolve(Buffer.from('%PDF-1.4 matrix')),
        verify: () => Promise.resolve({ match: true }),
      })
      .overrideProvider(DisbursementService)
      .useValue({
        createSchedule: () => Promise.resolve({}),
        list: () => Promise.resolve([]),
        initiate: () => Promise.resolve({}),
        reconcile: () => Promise.resolve({}),
      })
      .overrideProvider(RenewalService)
      .useValue({
        listForApplication: () => Promise.resolve({}),
        submit: () => Promise.resolve({}),
        endorse: () => Promise.resolve({}),
        continuationCheck: () => Promise.resolve({}),
        decide: () => Promise.resolve({}),
      })
      .overrideProvider(GrievanceService)
      .useValue({
        raise: () => Promise.resolve({}),
        list: () => Promise.resolve([]),
        get: () => Promise.resolve({}),
        start: () => Promise.resolve({}),
        resolve: () => Promise.resolve({}),
      })
""" + ov, 1)
open(p, 'w', encoding='utf8', newline='\n').write(s)
print('rbac matrix extended with', len(routes), 'routes')
