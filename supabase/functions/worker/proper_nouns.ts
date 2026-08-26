// Deterministic proper-noun audit.
//
// The blind critics' most-repeated criticism was the absence of "messy local
// nouns" — place names, venues, vendors, named staff, named partners, dated prior
// results. Diagnosis showed the ledger usually cannot supply them. But filling the
// ledger is only half the fix: nothing made the generator USE what was there, and
// no validator failed a narrative that used none of it.
//
// So the floor is a FUNCTION OF THE LEDGER, not a constant. If the ledger offers
// ten usable proper nouns and the narrative uses one, that is a failure the
// generator can fix. If the ledger offers one, using one is the ceiling and the
// document is as particular as honesty permits — the applicant is not punished for
// evidence nobody has.
//
// The same pass catches the opposite failure: a proper noun in the narrative that
// is in NO ledger item is either fabricated or lifted from another organisation.
// That is the worse outcome and it is reported separately, as blocking.
//
// Nothing here asks a model to count anything (CLAUDE.md: language models cannot
// count words).

// Words that are capitalised for grammar or genre, not because they name anything.
const PN_STOP = new Set([
  "The","This","That","These","Those","A","An","And","But","Or","If","When","While","Where",
  "We","Our","It","Its","They","Their","There","In","On","At","For","To","From","By","With",
  "As","After","Before","During","Over","Under","Between","Each","Every","All","Both","Most",
  "January","February","March","April","May","June","July","August","September","October",
  "November","December","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday",
  "Year","Month","Week","Day","Phase","Output","Outcome","Goal","Objective","Activity","Activities",
  "Indicator","Indicators","Target","Targets","Budget","Risk","Risks","Mitigation","Assumptions",
  "Level","Statement","Means","Verification","Milestone","Total","Subtotal","Note","Notes",
  "Project","Programme","Program","Proposal","Organisation","Organization","Foundation","Fund",
  "Trust","Grant","Donor","Beneficiaries","Participants","Staff","Board","Annex","Appendix",
  "Introduction","Background","Summary","Conclusion","Sustainability","Methodology","Approach",
]);

function properNouns(md: string): string[] {
  // Strip markdown furniture that would otherwise read as capitalised prose.
  const text = md
    .replace(/^#{1,6}\s+.*$/gm, "\n")        // headings are genre, not content
    .replace(/^\s*\|.*\|\s*$/gm, "\n")       // table rows
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

  const out = new Set<string>();
  // A run of capitalised words. Three continuations are allowed, because real
  // names are messier than "Two Capitalised Words":
  //   ... of/and/the/de/van ... Capitalised   -> "Church of St Mark"
  //   al-Tabbaneh, d'Ivoire                   -> a lowercase particle bound by a
  //                                              hyphen or apostrophe to a capital
  //   plain Capitalised                       -> "Tower Hamlets"
  const re = /([A-Z][\w'’-]*(?:\s+(?:of|and|the|de|al|bin|van|von|du|la|le|el)\s+[A-Z][\w'’-]*|\s+[a-z]{1,3}[-'’][A-Z][\w'’-]*|\s+[A-Z][\w'’-]*)*)/g;

  for (const m of text.matchAll(re)) {
    let words = m[1].trim().split(/\s+/);

    // English capitalises the first word of every sentence, so a match that starts
    // at a sentence boundary carries one word of pure grammar. Drop it: "Through
    // capacity transfer" is not a place, and "Employs Rana Haddad" is a verb plus
    // a person. Whatever survives is capitalised for a reason.
    const before = text.slice(0, m.index ?? 0);
    if (/(^|[.!?:;\n]|^\s*[-*]\s*)\s*$/.test(before)) words = words.slice(1);

    while (words.length && PN_STOP.has(words[0])) words = words.slice(1);
    while (words.length && PN_STOP.has(words[words.length - 1])) words = words.slice(0, -1);
    if (!words.length) continue;

    const cleaned = words.join(" ");
    if (cleaned.length < 3) continue;
    if (words.every((w) => PN_STOP.has(w))) continue;
    out.add(cleaned);
  }
  return [...out];
}

function normPN(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Order-insensitive key: "Municipality of Tripoli" and "Tripoli Municipality" are
// the same referent, and a ledger written one way must match prose written the
// other. Short connectives are dropped so they cannot make two spellings differ.
const PN_GLUE = new Set(["of", "and", "the", "de", "la", "le", "du", "el", "al"]);
function pnKey(s: string): Set<string> {
  return new Set(normPN(s).split(" ").filter((w) => w && !PN_GLUE.has(w)));
}
function pnOverlap(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let hit = 0;
  for (const w of small) if (big.has(w)) hit++;
  // Every word of the shorter name appears in the longer one: "Tower Hamlets"
  // matches "Tower Hamlets Council", and word order is irrelevant.
  return hit === small.size;
}

interface PNAudit {
  ledger_offers: number;      // distinct proper nouns the ledger could supply
  used: number;               // of those, how many the narrative actually uses
  unsourced: string[];        // proper nouns in the narrative that no ledger item supports
  findings: string[];
}

// applicantName is always legitimate and is excluded from both counts: using your
// own name is not particularity, and it is never unsourced.
function properNounAudit(narrative: string, ledger: Array<Record<string, unknown>>, applicantName: string): PNAudit {
  const ledgerText = ledger.map((e) => String(e.claim ?? "")).join("\n");
  const ledgerNouns = new Map<string, string>();
  for (const p of properNouns(ledgerText)) ledgerNouns.set(normPN(p), p);

  const own = new Set<string>();
  for (const p of properNouns(applicantName || "")) own.add(normPN(p));
  for (const k of own) ledgerNouns.delete(k);

  const inNarrative = properNouns(narrative);
  const used = new Set<string>();
  const unsourced: string[] = [];
  const ledgerKeys = [...ledgerNouns.keys()].map((k) => [k, pnKey(k)] as const);
  const ownKeys = [...own].map((k) => pnKey(k));

  for (const p of inNarrative) {
    const n = normPN(p);
    if (!n) continue;
    const key = pnKey(p);
    if (own.has(n) || ownKeys.some((o) => pnOverlap(key, o))) continue;

    const hit = ledgerKeys.find(([k, kk]) => k === n || pnOverlap(key, kk));
    if (hit) { used.add(hit[0]); continue; }

    // Only MULTI-WORD names are reported as unsourced. A lone capitalised word is
    // overwhelmingly document furniture — a heading fragment, a table label, a
    // sentence-initial noun the stop list does not carry — and flagging those
    // buries the real signal. An invented entity is almost always multi-word
    // ("Cedar Valley Trust"), so the cost of this is small and the noise removed
    // is large. All-caps runs are headings, never names.
    const words = p.split(/\s+/);
    if (words.length < 2) continue;
    if (p === p.toUpperCase()) continue;
    unsourced.push(p);
  }

  const offers = ledgerNouns.size;
  const findings: string[] = [];

  if (unsourced.length) {
    findings.push(
      `UNSOURCED PROPER NOUNS: ${unsourced.slice(0, 8).join(", ")}` +
      (unsourced.length > 8 ? ` (+${unsourced.length - 8} more)` : "") +
      ` — no evidence ledger item supports these. Remove them or replace them with a ledger-backed referent.`,
    );
  }

  // The floor: use most of what exists. Below half, with at least three on offer,
  // the generator is writing around its own evidence.
  if (offers >= 3 && used.size * 2 < offers) {
    findings.push(
      `SPECIFICITY: the evidence ledger offers ${offers} concrete named referents and the narrative uses only ${used.size}. ` +
      `Name the places, partners, people and prior results the ledger already supports, in the body of the argument rather than in a list.`,
    );
  }

  return { ledger_offers: offers, used: used.size, unsourced, findings };
}

export { properNouns, properNounAudit, normPN };
export type { PNAudit };
