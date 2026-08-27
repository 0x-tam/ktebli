#!/usr/bin/env python3
"""Build a blind critic packet for one rung and one document order.

  tests/ladder/build_packet.py <rung> <ORDER> <dest>
  tests/ladder/build_packet.py --verify          # rebuild known packets, compare md5

Adapted from the original scratch builder: paths are repo-relative instead of pointing at
a scratch directory that no longer exists. Nothing else changed, and --verify proves it,
by rebuilding two packets that were actually sent and comparing md5 against MANIFEST.txt.

Header and tail are lifted from `.prompt-n09-critic_a.txt`, the reference packet format, so
every packet carries identical framing and only the document order differs. The order is the
blinding: DO NOT store it next to the packet or pass it to whatever reads the verdict --
derive it with bytematch.py at read time.
"""
import sys, io, os, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS, PKTS = os.path.join(HERE, "documents"), os.path.join(HERE, "packets")
REF = os.path.join(PKTS, ".prompt-n09-critic_a.txt")

def _frame():
    ref = open(REF, encoding="utf-8").read().split("\n")
    return "\n".join(ref[0:83]) + "\n", "\n".join(ref[528:])

def clean(doc):
    lines = doc.split("\n")
    while lines and (lines[0].strip() == "" or lines[0].lstrip().startswith("<!--")):
        lines.pop(0)
    return "\n".join(lines).rstrip("\n")

def build(rung, order):
    header, tail = _frame()
    out = io.StringIO()
    out.write(header)
    for i, arm in enumerate(order, 1):
        doc = clean(open(os.path.join(DOCS, f"out-{rung}-{arm}.md"), encoding="utf-8").read())
        out.write(f"<<<<<<<<<< DOC {i} - BEGINS >>>>>>>>>>\n\n")
        out.write(doc + "\n\n")
        out.write(f"<<<<<<<<<< DOC {i} - ENDS >>>>>>>>>>\n\n\n")
    return out.getvalue() + tail

def verify():
    # (rung, order, packet file it must reproduce byte for byte)
    known = [("n06thin", "BDCA", ".prompt-n06thin-critic_a.txt"),
             ("n06thin", "DCAB", ".prompt-n06thin-critic_b.txt"),
             ("n12",     "BACD", ".prompt-n12-critic_a.txt"),
             ("n12",     "BDAC", ".prompt-n12-critic_b.txt")]
    fail = 0
    for rung, order, name in known:
        built = hashlib.md5(build(rung, order).encode()).hexdigest()
        actual = hashlib.md5(open(os.path.join(PKTS, name), "rb").read()).hexdigest()
        ok = built == actual
        print(f"  {'ok  ' if ok else 'FAIL'} {name}  {rung}/{order}  built {built[:8]} vs sent {actual[:8]}")
        fail |= not ok
    print("BUILDER VERIFIED" if not fail else "BUILDER DOES NOT REPRODUCE THE SENT PACKETS")
    return fail

if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--verify":
        sys.exit(verify())
    if len(sys.argv) != 4:
        print(__doc__); sys.exit(2)
    rung, order, dest = sys.argv[1], list(sys.argv[2]), sys.argv[3]
    open(dest, "w", encoding="utf-8").write(build(rung, order))
    print(f"wrote {dest}")
