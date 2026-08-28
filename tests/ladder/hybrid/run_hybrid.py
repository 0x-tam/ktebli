#!/usr/bin/env python3
"""Generate the HYBRID (arm H) documents: single-prompt core + deterministic gates.

    export OPENROUTER_API_KEY=...
    python3 tests/ladder/hybrid/run_hybrid.py n12 n06thin

Per reports/phase2-decision.md:
  - generator anthropic/claude-opus-5, reasoning_effort low, max_tokens 12000 — identical
    parameters to every D arm, so the core is the same strength as the naked single prompt;
  - after generation, three deterministic gates (word count, numeric closure, grounding);
  - at most TWO repair rounds; each repair names the exact failures; the defect count must
    strictly decrease or the loop stops; a repair that does not change the document stops
    the loop. The final document ships with its remaining defects recorded in the meta.
Streaming, generation id from the first chunk, cost from the usage field. One file per
document, written the moment it lands.
"""
import json, os, re, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_hybrid_prompt import build as build_prompt  # noqa: E402

DOCS = os.path.join(HERE, "..", "documents")
FIX = os.path.join(HERE, "..", "fixture")
KEY = os.environ.get("OPENROUTER_API_KEY", "")
API = "https://openrouter.ai/api/v1"
MODEL = "anthropic/claude-opus-5"
WORD_LIMIT = 1200
MAX_REPAIRS = 2

# quantity nouns checked for narrative-vs-budget consistency (discipline 2)
QTY_NOUNS = ["trip", "trips", "session", "sessions", "cohort", "cohorts",
             "day", "days", "meal", "meals", "evening", "evenings"]


def stream_call(messages, max_tokens=12000):
    body = json.dumps({
        "model": MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "reasoning": {"effort": "low"},
        "stream": True,
        "usage": {"include": True},
    }).encode()
    req = urllib.request.Request(f"{API}/chat/completions", data=body, headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    text, gen_id, usage = [], None, None
    with urllib.request.urlopen(req, timeout=900) as r:
        for raw in r:
            line = raw.decode("utf8", "replace").strip()
            if not line.startswith("data: "):
                continue
            payload = line[6:]
            if payload == "[DONE]":
                break
            try:
                chunk = json.loads(payload)
            except json.JSONDecodeError:
                continue
            if gen_id is None and chunk.get("id"):
                gen_id = chunk["id"]
            if chunk.get("usage"):
                usage = chunk["usage"]
            for ch in chunk.get("choices", []):
                piece = (ch.get("delta") or {}).get("content")
                if piece:
                    text.append(piece)
    return "".join(text), gen_id, usage


# ---------------------------------------------------------------- gates
def q_span(doc):
    """The Q1–Q5 answer span: from the Q1 heading to the first budget/declaration
    heading, heading lines removed. Same method as the referent-ladder table."""
    m = re.search(r"^#+ *Q1\b.*$", doc, re.M)
    start = m.start() if m else 0
    m2 = re.search(r"^#+ *(Budget|Declaration)\b.*$", doc[start:], re.M | re.I)
    span = doc[start:start + m2.start()] if m2 else doc[start:]
    return "\n".join(l for l in span.split("\n") if not l.lstrip().startswith("#"))


def gate_words(doc):
    n = len(q_span(doc).split())
    if n > WORD_LIMIT:
        return [f"WORD LIMIT: the Q1-Q5 answers count {n} words against the hard limit of "
                f"{WORD_LIMIT}. Cut at least {n - WORD_LIMIT} words from the answers. Do not "
                f"cut by truncation; rewrite."]
    return []


def _num(s):
    return float(s.replace(",", ""))


def gate_numeric(doc):
    """Budget closure: GBP line amounts must sum to the stated total; overhead <= 12% of
    direct. Also narrative-vs-budget quantity conflicts for QTY_NOUNS."""
    findings = []
    m = re.search(r"^#+ *Budget.*$", doc, re.M | re.I)
    budget = doc[m.start():] if m else ""
    m2 = re.search(r"^#+ *Declaration.*$", budget, re.M | re.I)
    if m2:
        budget = budget[:m2.start()]
    amounts = []   # (label, value) per table row with a GBP amount
    total = None
    overhead = None
    for line in budget.split("\n"):
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        nums = [c for c in cells if re.fullmatch(r"£?[\d,]+(\.\d+)?", c.replace("£", "").strip() and c or "x") or re.fullmatch(r"£[\d,]+(\.\d+)?", c)]
        gbp = None
        for c in cells:
            mm = re.fullmatch(r"£\s*([\d,]+(?:\.\d+)?)", c)
            if mm:
                gbp = _num(mm.group(1))
        if gbp is None:
            continue
        label = cells[0].lower()
        if "total" in label:
            total = gbp
        elif "overhead" in label:
            overhead = gbp
            amounts.append((label, gbp))
        else:
            amounts.append((label, gbp))
    if total is not None and amounts:
        s = sum(v for _, v in amounts)
        if abs(s - total) > 0.005:
            findings.append(f"BUDGET DOES NOT CLOSE: the lines sum to £{s:,.2f} but the "
                            f"stated total is £{total:,.2f}. Every total must equal the sum "
                            f"of its stated parts.")
    if overhead is not None and amounts:
        direct = sum(v for l, v in amounts if "overhead" not in l)
        if direct > 0 and overhead > 0.12 * direct + 0.005:
            findings.append(f"OVERHEAD CAP: overhead £{overhead:,.2f} exceeds 12% of direct "
                            f"costs £{direct:,.2f} (cap £{0.12 * direct:,.2f}).")
    # narrative vs budget quantities. Number words count: "twelve trips" is 12 trips.
    WORDNUM = {"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,
               "nine":9,"ten":10,"eleven":11,"twelve":12,"fifteen":15,"sixteen":16,
               "eighteen":18,"twenty":20,"twenty-four":24}
    narrative = q_span(doc).lower()
    for w, v in WORDNUM.items():
        narrative = re.sub(rf"\b{w}\b", str(v), narrative)
    for noun in set(n.rstrip("s") for n in QTY_NOUNS):
        nn = set(int(x) for x in re.findall(rf"\b(\d+)\s+(?:[a-z-]+\s+)?(?:{noun}s?)\b", narrative))
        bb = set(int(x) for x in re.findall(rf"\b(\d+)\s+(?:[a-z-]+\s+)?(?:{noun}s?)\b", budget.lower()))
        conflict = bb - nn
        if nn and conflict:
            findings.append(f"QUANTITY MISMATCH: the budget mentions {sorted(conflict)} "
                            f"{noun}(s) but the narrative mentions {sorted(nn)}. The same "
                            f"quantity must appear in both places.")
    return findings


def gate_grounding(doc, rung):
    """Every multi-word capitalised name in the document must appear in the ledger, the
    org identity, or the grant text."""
    ledger = json.load(open(os.path.join(FIX, f"ledger-{rung}.json"), encoding="utf8"))
    grant = json.load(open(os.path.join(FIX, "grant.json"), encoding="utf8"))
    org = json.load(open(os.path.join(FIX, "org.json"), encoding="utf8"))
    whitelist = (" ".join(it["fact"] for it in ledger) + " " +
                 grant["grant"]["full_guidelines_text"] + " " +
                 json.dumps(org)).lower()
    # words that never make a name on their own: calendar terms, governance vocabulary,
    # sentence-initial gerunds and connectives. Same intent as worker/proper_nouns.ts,
    # including its "split names joined by and" fix (commit ece4c06).
    STOP = {"january","february","march","april","may","june","july","august","september",
            "october","november","december","monday","tuesday","wednesday","thursday",
            "friday","saturday","sunday","chair","board","trustee","trustees","trust",
            "declaration","budget","total","overhead","english","maths","the","of","and",
            "running","completing","if","we","our","this","q1","q2","q3","q4","q5"}
    findings = []
    seen = set()
    for m in re.finditer(r"\b([A-Z][a-z]+(?:['’][A-Za-z]+)?(?: (?:[A-Z][a-z]+|of|the|and)['’]?[a-z]*)+)\b", doc):
        # split on " and " first: two ledgered names joined by a conjunction are not a
        # third, unledgered name
        for name in re.split(r"\s+and\s+", m.group(1).strip()):
            words = name.strip().split()
            while words and words[-1].lower() in ("of", "the", "and"):
                words.pop()          # trailing connectives are packet artefacts, not names
            words = [re.sub(r"['\u2019]s?$", "", w) for w in words]   # possessives
            name = " ".join(words)
            if not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            content = [w for w in words if w[0:1].isupper() and w.lower() not in STOP]
            if len(content) < 2:
                continue          # role titles, months, sentence-initial fragments
            if name.lower() in whitelist:
                continue
            # a name made ENTIRELY of words the sources already use is a label or heading,
            # not an invented particular ("Target Number", "Total Project Budget")
            def known(w):
                lw = w.lower()
                return (lw in whitelist or lw in STOP or lw.rstrip("s") in whitelist
                        or lw + "s" in whitelist)
            if all(known(w) for w in words):
                continue
            findings.append(f"UNLEDGERED NAME: \"{name}\" does not trace to the evidence "
                            f"ledger, the applicant identity or the funder guidance. Remove it "
                            f"or replace it with a ledger-backed fact.")
    return findings


def gates(doc, rung):
    return gate_words(doc) + gate_numeric(doc) + gate_grounding(doc, rung)


# ---------------------------------------------------------------- main
def run_rung(rung):
    prompt = build_prompt(rung)
    pfile = os.path.join(HERE, f"prompt-{rung}-H.txt")
    open(pfile, "w", encoding="utf8").write(prompt)
    print(f"{rung}: prompt written ({len(prompt.split())} words) -> {pfile}")

    messages = [{"role": "user", "content": prompt}]
    calls = []
    doc, gid, usage = stream_call(messages)
    calls.append({"generation_id": gid, "cost_usd": (usage or {}).get("cost"),
                  "kind": "generate"})
    print(f"  generated: id={gid} cost={(usage or {}).get('cost')} chars={len(doc)}")

    findings = gates(doc, rung)
    prev_count = len(findings)
    repairs = 0
    while findings and repairs < MAX_REPAIRS:
        print(f"  gate findings ({len(findings)}):")
        for f in findings:
            print(f"    - {f}")
        repair_msg = ("The application below failed mechanical verification. Fix EXACTLY "
                      "the named failures, changing as little else as possible, and return "
                      "the complete corrected application in the same format.\n\nFAILURES:\n"
                      + "\n".join(f"- {f}" for f in findings)
                      + "\n\nAPPLICATION:\n" + doc)
        new_doc, gid2, usage2 = stream_call(
            [{"role": "user", "content": prompt},
             {"role": "assistant", "content": doc},
             {"role": "user", "content": repair_msg}])
        calls.append({"generation_id": gid2, "cost_usd": (usage2 or {}).get("cost"),
                      "kind": "repair", "findings_fed": findings})
        repairs += 1
        if new_doc.strip() == doc.strip():
            print("  repair did not change the document; stopping the loop")
            break
        doc = new_doc
        findings = gates(doc, rung)
        if len(findings) >= prev_count:
            print(f"  defect count did not improve ({prev_count} -> {len(findings)}); stopping")
            break
        prev_count = len(findings)

    out = os.path.join(DOCS, f"out-{rung}-H.md")
    open(out, "w", encoding="utf8").write(doc)
    words = len(q_span(doc).split())
    meta = {
        "rung": rung, "arm": "H", "mode": "hybrid-single-prompt-plus-gates",
        "model": MODEL, "calls": calls,
        "total_cost_usd": sum(c["cost_usd"] or 0 for c in calls),
        "word_count_q1_q5_only": words, "word_limit": WORD_LIMIT,
        "remaining_gate_findings": findings,
        "notes": ("Hybrid arm per reports/phase2-decision.md. Single-prompt core at the D "
                  "arms' exact parameters; deterministic word/numeric/grounding gates with "
                  "named repairs, max 2, defect count must strictly decrease."),
    }
    mfile = os.path.join(FIX, f"meta-{rung}-H.json")
    json.dump(meta, open(mfile, "w", encoding="utf8"), indent=1)
    print(f"  wrote {out} ({words} answer words) and {mfile}; "
          f"remaining findings: {len(findings)}")


if __name__ == "__main__":
    if not KEY:
        sys.exit("OPENROUTER_API_KEY is not set")
    for rung in (sys.argv[1:] or ["n12", "n06thin"]):
        run_rung(rung)
