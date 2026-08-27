#!/usr/bin/env python3
"""Derive each critic packet's blinding AT READ TIME and check the landed verdicts.

Two independent checks, neither of which trusts a .map file:

  1. STRUCTURAL. Split every packet into its DOC blocks and match each block against
     all 20 ladder documents under whitespace normalisation. The derived permutation
     must equal the packet's recorded .map- file. Matching runs against every rung's
     documents, not just the packet's own, so a packet paired with the wrong rung is
     detected rather than silently decoded.

  2. CONTENT FINGERPRINT. For each verdict that actually landed, take a figure the
     critic quoted about a specific Doc n and check it appears in exactly the source
     document that the recorded decoding assigns to Doc n. This is the only check
     that establishes which packet a critic really READ, as opposed to which packet
     a file says was sent -- and on rung n06 the two disagreed.

  tests/ladder/bytematch.py            # check, exit non-zero on any mismatch
"""
import re, sys, glob, os, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS_DIR, PKT_DIR = os.path.join(HERE, "documents"), os.path.join(HERE, "packets")
norm = lambda s: re.sub(r"\s+", " ", s).strip()

docs = {os.path.basename(p)[4:-3]: norm(open(p, encoding="utf-8").read())
        for p in sorted(glob.glob(os.path.join(DOCS_DIR, "out-*.md")))}

# Four delimiter styles were used across the packet generations; all are accepted.
PATTERNS = [re.compile(r"^=+ DOC (\d+) =+\s*$", re.M),
            re.compile(r"^<+ DOC (\d+) - BEGINS >+\s*$", re.M),
            re.compile(r"^#+ Doc (\d+)\s*$", re.M),
            re.compile(r"^DOC (\d+)\s*$", re.M)]

def blocks(text):
    for pat in PATTERNS:
        parts = pat.split(text)
        if len(parts) >= 5:
            return [(int(parts[i]),
                     norm(re.split(r"^<+ DOC \d+ - ENDS >+\s*$", parts[i + 1], flags=re.M)[0]))
                    for i in range(1, len(parts), 2)]
    return []

def shingles(s, k=12):
    w = s.split()
    return {" ".join(w[i:i + k]) for i in range(max(1, len(w) - k + 1))}

def match(block):
    exact = [k for k, v in docs.items() if v == block]
    if len(exact) == 1:
        return exact[0], "exact"
    contained = [k for k, v in docs.items() if block and (block in v or v in block)]
    if len(contained) == 1:
        return contained[0], "containment"
    bs = shingles(block)
    ranked = sorted(((len(bs & shingles(v)) / max(1, len(bs | shingles(v))), k)
                     for k, v in docs.items()), reverse=True)
    return ranked[0][1], f"shingle j={ranked[0][0]:.3f} (next {ranked[1][1]} {ranked[1][0]:.3f})"

# Figures each landed verdict quoted about a specific Doc, and the arm the recorded
# decoding assigns to that Doc. Sources are the verdict files under
# reports/design/ladder-critics/. A figure must appear in that arm's document AND in
# no other arm at the same rung, or the decoding is not established.
FINGERPRINTS = [
    # rung,      critic,     doc, arm, figure quoted by the critic about that doc
    ("n06",      "critic_b", 4, "B", r"55,?385"),      # "budget does not add up"
    ("n06",      "critic_b", 1, "D", r"38,?840"),      # "38,840 + 4,660 = 43,500"
    ("n12",      "critic_b", 1, "B", r"67,?200"),
    ("n12",      "critic_b", 2, "D", r"54,?920"),
    ("n12",      "critic_b", 3, "A", r"44,?424"),
    ("n12",      "critic_b", 4, "C", r"37,?930"),
    ("n06thin",  "critic_a", 1, "B", r"51,?250"),
    ("n06thin",  "critic_b", 1, "D", r"56,?112"),
    ("n06thin",  "critic_b", 2, "C", r"37,?356"),
    ("n06thin",  "critic_b", 3, "A", r"59,?360"),
    ("n06thin",  "critic_b", 4, "B", r"57,?400"),
]

def main():
    if len(docs) != 20:
        print(f"FAIL: expected 20 ladder documents, found {len(docs)}")
        return 1
    print(f"loaded {len(docs)} ladder documents\n")
    fail = 0

    print("== 1. structural: every packet decodes to its own recorded map ==")
    packets = sorted(glob.glob(os.path.join(PKT_DIR, ".packet-*.txt")) +
                     glob.glob(os.path.join(PKT_DIR, ".prompt-*.txt")))
    for path in packets:
        base = os.path.basename(path)
        text = open(path, encoding="utf-8").read()
        bl = blocks(text)
        if not bl:
            print(f"  FAIL {base}: no DOC blocks found"); fail = 1; continue
        derived, rungs = "", set()
        for _, body in bl:
            key, _how = match(body)
            rung, arm = key.rsplit("-", 1)
            rungs.add(rung); derived += arm
        mapfile = os.path.join(PKT_DIR, ".map-" + base.split("-", 1)[1])
        recorded = open(mapfile).read().strip().replace(" ", "") if os.path.exists(mapfile) else None
        md5 = hashlib.md5(text.encode()).hexdigest()
        if recorded is None:
            print(f"  WARN {base}: no map file; derived {derived}")
        elif derived != recorded:
            print(f"  FAIL {base}: derived {derived} != recorded {recorded}"); fail = 1
        elif len(rungs) != 1:
            print(f"  FAIL {base}: documents span rungs {sorted(rungs)}"); fail = 1
        else:
            print(f"  ok   {base}  {derived}  (rung {rungs.pop()}, md5 {md5[:8]})")

    print("\n== 2. content fingerprints: which document each critic actually read ==")
    for rung, critic, doc_n, arm, pattern in FINGERPRINTS:
        hits = [a for a in "ABCD"
                if re.search(pattern, open(os.path.join(DOCS_DIR, f"out-{rung}-{a}.md"),
                                           encoding="utf-8").read())]
        label = f"{rung}/{critic} Doc {doc_n} = {arm}"
        if hits == [arm]:
            print(f"  ok   {label:34s} /{pattern}/ appears only in out-{rung}-{arm}.md")
        else:
            print(f"  FAIL {label:34s} /{pattern}/ appears in {hits or 'no document'}, not {arm} alone")
            fail = 1

    print("\nBYTEMATCH FAILED" if fail else "\nBYTEMATCH OK")
    return fail

if __name__ == "__main__":
    sys.exit(main())
