#!/bin/sh
# Phase 17 (F3): pip-audit of the pinned runtime environment, at image build
# time. If pip-audit cannot be installed or the vulnerability service cannot be
# reached, the report says NOT RUN with the reason - nothing is invented.
OUT="${1:-security-report}"
mkdir -p "$OUT"
LOCK="$OUT/requirements.lock"
pip freeze --exclude-editable | grep -v -i -E '^(pip|setuptools|wheel|vidyasetu-ml)[=@ ]' > "$LOCK"
{
  echo "pip-audit (runtime environment, $(wc -l < "$LOCK") pinned distributions) at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if ! python -m venv /tmp/audit-venv >/dev/null 2>&1 || ! /tmp/audit-venv/bin/pip install --no-cache-dir -q pip-audit >/tmp/pip-audit-install.log 2>&1; then
    echo "STATUS: NOT RUN - pip-audit could not be installed ($(tail -n 1 /tmp/pip-audit-install.log 2>/dev/null))"
  else
    /tmp/audit-venv/bin/pip-audit -r "$LOCK" --no-deps --disable-pip --progress-spinner off -f json -o "$OUT/pip-audit.json" >/tmp/pip-audit.log 2>&1
    rc=$?
    if [ -s "$OUT/pip-audit.json" ]; then
      echo "STATUS: RAN (exit $rc)"
      python - "$OUT/pip-audit.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
deps = d.get("dependencies", d if isinstance(d, list) else [])
vulns = [(x["name"], x["version"], v["id"], ",".join(v.get("fix_versions") or []) or "no fix") for x in deps for v in x.get("vulns", [])]
print(f"vulnerabilities: {len(vulns)} in {len({v[0] for v in vulns})} distributions ({len(deps)} audited)")
for n, ver, vid, fix in vulns:
    print(f"  {n}=={ver} {vid} fix: {fix}")
PY
    else
      echo "STATUS: NOT RUN - the vulnerability service could not be queried ($(grep -m1 -i -E 'error|connection|timed out' /tmp/pip-audit.log || tail -n 1 /tmp/pip-audit.log))"
    fi
  fi
} > "$OUT/pip-audit.txt"
rm -rf /tmp/audit-venv
cat "$OUT/pip-audit.txt"
