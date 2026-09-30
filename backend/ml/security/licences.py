"""Phase 17 (F3): licence inventory of the installed Python distributions
(offline: importlib.metadata). Writes <out>/licences.csv and licences.txt and
flags copyleft and unknown licences."""
import csv
import re
import sys
from importlib import metadata
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "security-report")
OUT.mkdir(parents=True, exist_ok=True)
# Build tooling present in every Python image, not application dependencies.
TOOLING = {"pip", "setuptools", "wheel", "pip-audit"}
# This project itself (no licence metadata of its own).
OWN = {"vidyasetu-ml"}

PERMISSIVE = [
    (r"\bMIT\b", "MIT"), (r"Apache", "Apache-2.0"), (r"BSD", "BSD"), (r"\bISC\b", "ISC"),
    (r"Python Software Foundation|PSF", "PSF"), (r"HPND|Historical Permission", "HPND"),
    (r"Zlib|zlib", "Zlib"), (r"Unlicense|Public Domain|CC0", "Public-Domain"),
]
COPYLEFT = re.compile(r"\b(A?GPL|LGPL|GNU (Lesser |Affero )?General Public|MPL|Mozilla Public|EPL|CDDL|EUPL)", re.I)


def licence_of(dist: metadata.Distribution) -> str:
    md = dist.metadata
    expr = md.get("License-Expression")
    if expr:
        return expr.strip()
    classifiers = [c.split("::")[-1].strip() for c in md.get_all("Classifier") or [] if c.startswith("License ::")]
    lic = (md.get("License") or "").strip()
    if classifiers:
        return " OR ".join(classifiers)
    return lic.splitlines()[0][:80] if lic else ""


def classify(lic: str) -> str:
    if not lic or lic.upper() in {"UNKNOWN", "OTHER/PROPRIETARY LICENSE"}:
        return "UNKNOWN"
    options = re.split(r"\bOR\b", lic)
    classes = []
    for o in options:
        if COPYLEFT.search(o):
            classes.append("COPYLEFT")
        elif any(re.search(p, o) for p, _ in PERMISSIVE):
            classes.append("PERMISSIVE")
        else:
            classes.append("UNKNOWN")
    if "PERMISSIVE" in classes:
        return "PERMISSIVE"
    return "COPYLEFT" if "COPYLEFT" in classes else "UNKNOWN"


rows = []
for d in metadata.distributions():
    name = d.metadata["Name"]
    if name.lower() in TOOLING or name.lower() in OWN:
        continue
    lic = licence_of(d)
    rows.append((name, d.version, lic, classify(lic)))
rows = sorted(set(rows), key=lambda r: (r[0].lower(), r[1]))
with open(OUT / "licences.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["name", "version", "licence", "class"])
    w.writerows(rows)
count = lambda c: sum(1 for r in rows if r[3] == c)  # noqa: E731
flagged = [r for r in rows if r[3] != "PERMISSIVE"]
lines = [
    f"python distributions: {len(rows)} - permissive {count('PERMISSIVE')}, copyleft {count('COPYLEFT')}, unknown {count('UNKNOWN')}",
    "flagged (copyleft or unknown):",
    *([f"  {r[3]:<9} {r[0]}=={r[1]} \"{r[2]}\"" for r in flagged] or ["  none"]),
]
(OUT / "licences.txt").write_text("\n".join(lines) + "\n")
print("\n".join(lines))
