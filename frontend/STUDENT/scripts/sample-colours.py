# Samples the design colours from docs/ui-v2/*.png (PIL only). Output goes to docs/UI_V2_NOTES.md.
from collections import Counter
from PIL import Image
D = "docs/ui-v2/"
def mode(f, box):
    im = Image.open(D + f).convert("RGB").crop(box)
    return Counter(im.getdata()).most_common(1)[0][0]
def darkest(f, box):
    im = Image.open(D + f).convert("RGB").crop(box)
    return min(im.getdata(), key=sum)
def sat(f, box):
    im = Image.open(D + f).convert("RGB").crop(box)
    c = Counter(p for p in im.getdata() if max(p) - min(p) > 60)
    return c.most_common(1)[0][0]
S = {
  "page background": mode("resolve.png", (300, 840, 700, 900)),
  "navy (step bar)": mode("resolve.png", (380, 115, 560, 128)),
  "navy (footer)": mode("resolve.png", (300, 950, 600, 1010)),
  "primary blue (button)": mode("resolve.png", (815, 515, 840, 550)),
  "header rule": sat("resolve.png", (300, 94, 700, 100)),
  "card accent bar": sat("resolve.png", (34, 440, 42, 560)),
  "amber (current step)": sat("complete_application.png", (190, 164, 280, 171)),
  "success green (banner)": mode("selected.png", (400, 420, 800, 445)),
  "success green (step)": mode("complete_application.png", (150, 415, 240, 428)),
  "success green (text)": darkest("complete_application.png", (102, 576, 196, 590)),
  "warning orange (accent)": sat("application_journey.png", (690, 740, 697, 840)),
  "warning orange (text)": sat("complete_application.png", (102, 650, 186, 664)),
  "error red (badge)": mode("complete_application.png", (948, 28, 956, 36)),
  "error red (deadline text)": sat("resolve.png", (735, 250, 940, 265)),
  "error tint (alert bg)": mode("resolve.png", (500, 330, 900, 345)),
  "card border": mode("resolve.png", (300, 427, 700, 429)),
  "card surface": mode("resolve.png", (300, 520, 700, 560)),
  "heading text": darkest("resolve.png", (35, 228, 480, 262)),
  "muted text": darkest("resolve.png", (35, 282, 650, 297)),
  "eyebrow blue": darkest("resolve.png", (35, 192, 165, 205)),
}
for k, v in S.items():
    print(f"| {k} | #{v[0]:02x}{v[1]:02x}{v[2]:02x} |")
