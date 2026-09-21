#!/usr/bin/env python3
"""Build the HYBRID (arm H) generation prompt for one rung. Deterministic.

The hybrid, per reports/phase2-decision.md: the strong single-prompt generation core fed
the FULL Evidence Ledger, carrying the wrapper's disciplines as instructions. The
deterministic gates in run_hybrid.py then verify what the prompt asked for and trigger
named repairs — the prompt asks, the gate checks, and only the gate is trusted.

  tests/ladder/hybrid/build_hybrid_prompt.py <rung>     # prints the prompt to stdout
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, "..", "fixture")


def build(rung):
    grant = json.load(open(os.path.join(FIX, "grant.json"), encoding="utf8"))
    org = json.load(open(os.path.join(FIX, "org.json"), encoding="utf8"))
    ledger = json.load(open(os.path.join(FIX, f"ledger-{rung}.json"), encoding="utf8"))
    # E-META-0 is metadata, not evidence: filter, as its own text instructs.
    items = [it for it in ledger if it.get("source") != "fixture-meta"]

    g = grant["grant"]
    lines = []
    a = lines.append
    a("You are writing a grant application on behalf of the applicant organisation below.")
    a("You write plainly, in the first person plural, as the organisation itself.")
    a("")
    a("=========================")
    a("FUNDER GUIDANCE (the only document this application is assessed against)")
    a("=========================")
    a(g["full_guidelines_text"])
    a("")
    a("=========================")
    a("THE APPLICANT")
    a("=========================")
    a(f"Legal name: {org['legal_name']}")
    a(f"Country: {org['country']}")
    a(f"Town: {org['town_or_city']}")
    a(f"Website: {org['website']}")
    a("")
    a("=========================")
    a("EVIDENCE LEDGER — the complete set of facts you may use")
    a("=========================")
    a("Every factual assertion in the application must trace to one of these items. Nothing")
    a("else about the applicant, its place, its partners, its people or its results may be")
    a("asserted, implied, or dressed as an example. If the ledger does not carry it, the")
    a("application does not say it. Where the ledger is silent, say so plainly — honesty")
    a("about a limit reads better than language that papers over it, and an invented or")
    a("embellished fact is the worst failure this document can contain.")
    a("")
    for it in items:
        a(f"[{it['id']}] {it['fact']}")
    a("")
    a("=========================")
    a("DISCIPLINES (each is verified mechanically after you write; failures come back to you named)")
    a("=========================")
    a("1. WORD LIMIT. The five answers together must not exceed 1,200 words. Headings, the")
    a("   budget table and the declaration are outside the count. The limit is hard: over it,")
    a("   the application is returned unread. Write to roughly 1,100 words of answers so an")
    a("   honest count clears the limit with room.")
    a("2. EVERY NUMBER DERIVED ONCE. Each figure in the document must be derived from ledger")
    a("   facts or from arithmetic shown in the document, and every total must equal the sum")
    a("   of its stated parts, in the same units. The budget table must sum exactly: direct")
    a("   cost lines, one overhead line at no more than 12 per cent of direct costs, and a")
    a("   total that equals direct plus overhead. Any quantity that appears both in the")
    a("   narrative and in the budget (trips, sessions, cohorts, days, meals) must be the")
    a("   same number in both places.")
    a("3. NO INVENTED PARTICULARS. Do not name any person, place, organisation, venue,")
    a("   vendor, date or result the ledger does not carry. Do not convert a ledger fact")
    a("   into a stronger claim than it makes.")
    a("4. STRUCTURE. Use exactly the five question headings as written in the guidance, in")
    a("   order, each as a markdown '##' heading, followed by '## Budget table' (a markdown")
    a("   table) and '## Declaration'. No other top-level sections, no horizontal rules, no")
    a("   code blocks, no placeholders.")
    a("")
    a("Write the complete application now.")
    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.stdout.write(build(sys.argv[1]))
