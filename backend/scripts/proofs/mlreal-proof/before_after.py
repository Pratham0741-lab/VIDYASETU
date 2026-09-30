import importlib.util, json, sys
sys.path.insert(0, '/src')
from app.services import consistency_service as after
spec = importlib.util.spec_from_file_location('before', '/w/consistency_service_before.py')
before = importlib.util.module_from_spec(spec); spec.loader.exec_module(before)
API_MIN = 0.8  # DOC_CONSISTENCY_MIN_CONFIDENCE; the api's consistencyStatus()
def status(r):
    v, c = r['value'], r['confidence']
    if not v: return 'UNCERTAIN'
    if any(c.get(k, 0) < API_MIN for k in v): return 'UNCERTAIN'
    return 'CONSISTENT' if all(v.values()) else 'INCONSISTENT'
def row(label, docs):
    b, a = before.check_consistency(docs), after.check_consistency(docs)
    print(f"\n## {label}")
    print(f"  BEFORE value={b['value']} confidence={b['confidence']} -> api {status(b)}")
    print(f"  AFTER  value={a['value']} confidence={a['confidence']} similarity={a['details'].get('similarity')} -> api {status(a)}")
    for n in sorted(set(x.split(': ',1)[1] if False else x for x in a['details'].get('name_match_types', [])))[:6]: print('     ', n)
real = json.load(open('/w/consistency-inputs.json'))
by = {d['document_slot']: d for d in real}
pick = lambda *slots: [by[s] for s in slots]
row('REAL clear match: bonafide "Anita Lakra" vs marks doc "Anita Lakra" (two real OCR extractions)',
    pick('bonafide_certificate', 'Last qualified marks [percentage/Equivalent percentage in case of CGPA/OGPA etc.]'))
row('REAL clear mismatch: marks doc "Anita Lakra" vs marksheet "Sunita Munda"',
    pick('Last qualified marks [percentage/Equivalent percentage in case of CGPA/OGPA etc.]', 'marksheet'))
row('REAL borderline: "Anita Lakra District Ranchi" vs "Anita Lakra Category Scheduled Tribe" (overrun tails)',
    pick('Aadhar Number', 'caste_certificate'))
row('REAL borderline: "Anita Lakra" vs "Anita Lakra Percentage"',
    pick('bonafide_certificate', 'Disability certificate (if applicable)'))
row('REAL full set as uploaded (13 docs, one Sunita Munda)', real)
ctrl = [dict(d, candidate_name='Anita Lakra') if d.get('candidate_name') == 'Sunita Munda' else d for d in real]
row('REAL control: same 13 docs, marksheet name corrected (overrun names as extracted)', ctrl)
trim = [{**d, **{k: 'Anita Lakra' for k in ('applicant_name','candidate_name','student_name') if d.get(k)}} for d in ctrl]
row('REAL control, overrun tails trimmed (what a fixed extractor would give)', trim)
row('Example: "Sunita Munda" vs "Sunita Hansda"', [{'name': 'Sunita Munda'}, {'name': 'Sunita Hansda'}])
row('Example: "Ram Kumar Singh" vs "Ram Kumar Verma"', [{'name': 'Ram Kumar Singh'}, {'name': 'Ram Kumar Verma'}])
row('Borderline example: "Anita Lakra" vs "Anita Lakda" (one-letter OCR slip)', [{'name': 'Anita Lakra'}, {'name': 'Anita Lakda'}])
row('DOB: 2006-05-02 vs 02/05/2006 / vs 2005-05-02 / vs 1998-02-15',[{'dob':'2006-05-02'},{'dob':'02/05/2006'}])
row('DOB near-year', [{'dob':'2006-05-02'},{'dob':'2005-05-02'}])
row('DOB clearly different', [{'dob':'2006-05-02'},{'dob':'1998-02-15'}])
