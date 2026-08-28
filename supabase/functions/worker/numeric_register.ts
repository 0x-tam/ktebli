// Numeric Register — one structured source of truth for every figure.
//
// THE DEFECT THIS REPLACES. A delivered proposal stated 200 beneficiaries where
// its own components summed to 216, and the deterministic checker passed it. It
// passed because consistencyFindings() never summed anything and was
// one-directional: `n > target * 1.01` cannot see an understatement. Worse, the
// components were never scanned at all — its regex missed "young people",
// "parents" and "mentors", and its 5% floor discarded them anyway.
//
// The deeper cause was that numbers had no identity. The project design object was
// pasted into every generation prompt as prose under the heading "the single
// source of truth", which is an instruction to a language model, not a mechanism.
// Every section then re-emitted its own figures from its own sampling call, and
// consistency was a matter of luck.
//
// Here a figure is a NODE. A leaf carries a value and how it was obtained; a
// derived node carries its members and NEVER its own value. Totals are recomputed
// from the components, and a model's asserted total is checked against the
// recomputation rather than believed. The 200-vs-216 document cannot be built.
//
// This also closes two reject-list items by construction rather than by
// instruction: every leaf must state a basis, so an arbitrary target has nowhere
// to enter; and a large planning estimate given to three significant figures with
// no arithmetic behind it is inadmissible, so pseudo-precision is a parse error.
//
// Pure: no I/O, no model, no network, no clock.

type UnitKind = "count" | "money" | "duration" | "ratio" | "rate";
interface RegBasis { kind: "evidence" | "donor" | "estimate" | "capacity" | "arithmetic"; detail: string }

interface RegNode {
  id: string;            // /^[A-Z]{1,2}[0-9]{1,3}$/  — N4, B12, M1
  label: string;         // the phrase the figure is written as in prose
  unit: string;          // "people" | "months" | "sessions" | an ISO-4217 code for money
  unit_kind: UnitKind;
  kind: "leaf" | "sum" | "product" | "rate";
  value?: number;        // LEAF ONLY
  of?: string[];         // sum: >= 2 ids; product: exactly 2 ids; rate: [numerator, denominator]
  asserted?: number;     // DERIVED ONLY — the model's own claim. Checked, never trusted.
  basis: RegBasis;
}

interface Resolved {
  id: string; label: string; unit: string; unit_kind: UnitKind;
  kind: RegNode["kind"]; value: number; members: string[]; basis: RegBasis;
  derivation: string;    // rendered human form: "N1 + N2 + N3 = 120 + 60 + 36"
}

class RegisterError extends Error {
  constructor(public code: string, public node: string | null, msg: string) {
    super(`${code}${node ? ` [${node}]` : ""}: ${msg}`);
  }
}

const REG_ID = /^[A-Z]{1,2}[0-9]{1,3}$/;
const UNIT_KINDS = ["count", "money", "duration", "ratio", "rate"];
const BASIS_KINDS = ["evidence", "donor", "estimate", "capacity", "arithmetic"];
const EVIDENCE_ID = /^E-(INTAKE|WEB|PROP)-\d+$/;

// PATCH 1. Money closes at the minor unit, not the pound: snapping £47.50 to £48
// made a correct £4,560 line unbuildable and blessed £4,608 instead. Counts and
// durations are cleaned of float error only; a genuinely fractional count is a
// modelling error and is refused below, not rounded away.
const snap = (k: UnitKind, n: number) =>
  k === "money" ? Math.round(n * 100) / 100 : Math.round(n * 1e6) / 1e6;
const WHOLE: UnitKind[] = ["count", "duration"];

// PATCH 2. unit and unit_kind are cross-checked. Every rule in this module is
// keyed on unit_kind, which the model chooses; unchecked, one word ("people" as a
// ratio, "GBP" as a count) opts out of currency, precision and rounding at once.
const CURRENCY = /^[A-Z]{3}$/;
const DURATION = /^(hour|day|week|month|quarter|year)s?$/i;
const RATIO_UNIT = /^(ratio|share|proportion|%|percent)$/i;
function unitKindOf(unit: string): UnitKind {
  const u = unit.trim();
  if (CURRENCY.test(u)) return "money";
  if (DURATION.test(u)) return "duration";
  if (RATIO_UNIT.test(u)) return "ratio";
  if (u.includes("/")) return "rate";
  return "count";
}
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
// 77 -> 0.77 without float dust, on the same 1e-6 grid snap() uses for ratios: the
// fraction a number that WORE a "%" stands for. (The old asPercent(), 0.77 -> 77, is
// gone: a ratio is now confirmed by its fraction registered from a real "%", never by
// a bare integer that merely equals its percentage — adv2 A10.)
const asFraction = (n: number) => Math.round((n / 100) * 1e6) / 1e6;
// Words that may sit immediately before the denominator's label inside the rate's
// label without changing which quantity is named: prepositions, articles and the
// share/rate connectives. A CONTENT word before the denominator label ("total" or
// "project" before "cost"/"project cost") extends it into a DIFFERENT quantity, and
// that is the "right about the wrong denominator" escape PATCH 6 must refuse.
const RATE_LABEL_CONNECTIVES = new Set([
  "of", "per", "the", "a", "an", "to", "as", "over", "by", "into", "from", "on",
  "for", "and", "or", "out", "with", "in", "at", "share", "proportion", "percentage",
  "fraction", "ratio", "rate", "versus", "vs", "each",
]);

// significant digits of the integer part: 216 -> 3, 200 -> 1, 1250 -> 3
function sigFigs(n: number): number {
  const s = Math.abs(Math.round(n)).toString().replace(/0+$/, "");
  return s.length || 1;
}

function numbersIn(s: string): Set<number> {
  const out = new Set<number>();
  for (const m of s.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    // PATCH 3. Keep the raw value as well as the rounded one. Rounding first made
    // the evidence check dimensionless: a 0.77 ratio was looked up as "1".
    if (Number.isFinite(n) && n > 0) {
      out.add(n); out.add(Math.round(n));
      // PATCH 11 (adv2 A10). %-PROVENANCE. A ratio (0.11) used to be "verified" by any
      // bare integer equal to asPercent(it): "11 staff" confirmed a 0.11 ratio because
      // 11 was in the pooled set. A percentage may only be confirmed by a number that
      // actually WORE a "%". So a number written as a percentage ("29%", "29 per cent")
      // also stands for its FRACTION (0.29) here — and only such a number does — and the
      // ratio is checked against that fraction directly, never against a raw headcount.
      const after = s.slice((m.index ?? 0) + m[0].length);
      if (/^\s*(%|per\s?cent\b)/i.test(after)) out.add(asFraction(n));
    }
  }
  return out;
}

function resolveRegister(
  raw: unknown,
  currency: string,
  evidence: Map<string, Set<number>>,   // PATCH 4. per ledger item, not one pooled set
  donorNums: Set<number>,
  opts: { frozen?: Map<string, Resolved> } = {},
): Map<string, Resolved> {
  const list = Array.isArray(raw) ? (raw as RegNode[]) : null;
  if (!list || !list.length) throw new RegisterError("register_missing", null, "the design carries no numeric_register");
  if (list.length > 200) throw new RegisterError("register_too_large", null, `${list.length} nodes`);

  // ---------- 1. shape ----------
  const byId = new Map<string, RegNode>();
  const byLabel = new Map<string, string>();
  for (const n of list) {
    if (!n || typeof n !== "object") throw new RegisterError("bad_node", null, "non-object entry");
    if (typeof n.id !== "string" || !REG_ID.test(n.id)) throw new RegisterError("bad_id", String(n?.id ?? ""), "ids must match [A-Z]{1,2}[0-9]{1,3}");
    if (byId.has(n.id)) throw new RegisterError("duplicate_id", n.id, "declared twice");
    if (typeof n.label !== "string" || n.label.trim().length < 3) throw new RegisterError("no_label", n.id, "every figure needs the phrase it is written as");
    if (typeof n.unit !== "string" || !n.unit.trim()) throw new RegisterError("no_unit", n.id, "unit required");
    if (!UNIT_KINDS.includes(n.unit_kind)) throw new RegisterError("bad_unit_kind", n.id, String(n.unit_kind));
    if (!n.basis || !BASIS_KINDS.includes(n.basis.kind)) throw new RegisterError("no_basis", n.id, "every figure must state how it was derived");
    if (typeof n.basis.detail !== "string" || n.basis.detail.trim().length < 3) throw new RegisterError("empty_basis", n.id, "basis.detail is the derivation and cannot be blank");
    if (n.unit_kind === "money" && n.unit !== currency) throw new RegisterError("currency_mismatch", n.id, `node is in ${n.unit}; this proposal is denominated in ${currency}`);
    // PATCH 2 (cont). Refusal by default: the unit decides the kind, not the model.
    // The match is exact. A "ratio" unit declared unit_kind "rate" would be a share
    // that skips the numerator/denominator unit check below, which is the same escape
    // in a different word: a rate between two different quantities must say so in its
    // unit ("GBP/person"), and then it is a rate by derivation, not by assertion.
    const implied = unitKindOf(n.unit);
    if (implied !== n.unit_kind) {
      throw new RegisterError("unit_kind_mismatch", n.id,
        `unit "${n.unit}" is a ${implied}, but this node declares unit_kind "${n.unit_kind}". ` +
        `Every check in the register is keyed on unit_kind; it is not yours to choose.`);
    }
    // PATCH 5. "the phrase the figure is written as in prose" must name one figure.
    const lab = norm(n.label);
    const prior = byLabel.get(lab);
    if (prior) throw new RegisterError("duplicate_label", n.id, `"${n.label}" is already ${prior}; one phrase, one figure`);
    byLabel.set(lab, n.id);

    if (n.kind === "leaf") {
      if (!Number.isFinite(n.value as number)) throw new RegisterError("leaf_no_value", n.id, "a leaf must carry a numeric value");
      if ((n.value as number) < 0) throw new RegisterError("negative", n.id, String(n.value));
      if (n.of !== undefined) throw new RegisterError("leaf_has_of", n.id, "a leaf cannot have members");
      if (n.asserted !== undefined) throw new RegisterError("leaf_has_asserted", n.id, "asserted belongs to derived nodes only");
      if (n.basis.kind === "arithmetic") throw new RegisterError("leaf_arithmetic_basis", n.id, "a leaf is not computed; give its real source");
      if (WHOLE.includes(n.unit_kind) && !Number.isInteger(n.value as number)) {
        throw new RegisterError("fractional_count", n.id, `${n.value} ${n.unit} is not a whole ${n.unit_kind}`);
      }
    } else if (n.kind === "sum" || n.kind === "product" || n.kind === "rate") {
      if (n.value !== undefined) throw new RegisterError("derived_has_value", n.id, "a derived node may not assert its own value; use 'asserted' and it will be recomputed");
      if (!Array.isArray(n.of) || n.of.some((x) => typeof x !== "string")) throw new RegisterError("derived_no_of", n.id, "members required");
      if (n.kind === "sum" && n.of.length < 2) throw new RegisterError("sum_arity", n.id, `a sum needs 2+ members, got ${n.of.length}`);
      if (n.kind !== "sum" && n.of.length !== 2) throw new RegisterError("binary_arity", n.id, `${n.kind} takes exactly 2 members, got ${n.of.length}`);
      if (n.asserted !== undefined && !Number.isFinite(n.asserted)) throw new RegisterError("bad_asserted", n.id, String(n.asserted));
      if (n.basis.kind !== "arithmetic") throw new RegisterError("derived_basis", n.id, "a derived node's basis.kind must be 'arithmetic'");
      if (n.of.includes(n.id)) throw new RegisterError("self_reference", n.id, "a node cannot include itself");
    } else {
      throw new RegisterError("bad_kind", n.id, String(n.kind));
    }
    byId.set(n.id, n);
  }

  // ---------- 2. resolution, with cycle and dangling detection ----------
  const done = new Map<string, Resolved>();
  const mark = new Map<string, 0 | 1>();   // 0 = in progress, 1 = resolved

  const walk = (id: string, path: string[]): Resolved => {
    const hit = done.get(id);
    if (hit) return hit;
    if (mark.get(id) === 0) throw new RegisterError("cycle", id, `cycle: ${[...path, id].join(" -> ")}`);
    const n = byId.get(id);
    if (!n) throw new RegisterError("dangling_ref", id, `referenced from ${path.at(-1) ?? "?"} but never declared`);
    mark.set(id, 0);

    let value: number;
    let derivation: string;
    const members = n.kind === "leaf" ? [] : (n.of as string[]);
    const kids = members.map((m) => walk(m, [...path, id]));

    if (n.kind === "leaf") {
      value = n.value as number;
      derivation = `${value} (${n.basis.kind}: ${n.basis.detail})`;
    } else if (n.kind === "sum") {
      for (const k of kids) {
        if (k.unit !== n.unit) throw new RegisterError("sum_unit_mismatch", n.id, `member ${k.id} is in "${k.unit}", the sum is in "${n.unit}"`);
        if (k.unit_kind !== n.unit_kind) throw new RegisterError("sum_kind_mismatch", n.id, `member ${k.id} is ${k.unit_kind}, the sum is ${n.unit_kind}`);
      }
      value = kids.reduce((a, k) => a + k.value, 0);
      derivation = `${members.join(" + ")} = ${kids.map((k) => k.value).join(" + ")}`;
    } else if (n.kind === "product") {
      // exactly one member carries the result unit; the other is a dimensionless multiplier.
      const same = kids.filter((k) => k.unit === n.unit);
      if (same.length !== 1) throw new RegisterError("product_unit", n.id, `exactly one member must be in "${n.unit}" (got ${same.length}): ${members.join(", ")}`);
      const mult = kids.find((k) => k.unit !== n.unit)!;
      if (mult.unit_kind !== "count" && mult.unit_kind !== "ratio") throw new RegisterError("product_multiplier", n.id, `multiplier ${mult.id} must be a count or a ratio, not ${mult.unit_kind}`);
      value = kids[0].value * kids[1].value;
      derivation = `${members.join(" x ")} = ${kids.map((k) => k.value).join(" x ")}`;
    } else { // rate
      const [num, den] = kids;
      if (!den.value) throw new RegisterError("divide_by_zero", n.id, `denominator ${den.id} is 0`);
      // PATCH 6. A rate had no unit checking of any kind. A ratio is a share of ONE
      // quantity, so numerator and denominator must be the same quantity; and the
      // phrase the figure is written as must name the denominator it is taken over,
      // which is how "75% of total project cost" divided by the grant gets caught.
      if (n.unit_kind !== "ratio" && n.unit_kind !== "rate") {
        throw new RegisterError("rate_unit_kind", n.id, `a rate resolves to a ratio or a rate, not a ${n.unit_kind}`);
      }
      if (n.unit_kind === "ratio" && num.unit !== den.unit) {
        throw new RegisterError("ratio_unit_mismatch", n.id,
          `a ratio is a share of one quantity, but ${num.id} is in "${num.unit}" and ${den.id} is in "${den.unit}"`);
      }
      // PATCH 6 (revised — adv2 A9). The label must NAME THE DENOMINATOR NODE, not
      // merely contain its label as a substring. "share of total project cost" divided
      // by the "cost" node (the grant, £108k) passed the old includes() test because
      // "cost" is a substring — but the label names a LARGER quantity ("total project
      // cost", the register's own £120k total, a different node) than the denominator
      // it divides by, certifying 75% of the grant as 75% of the total. Match by
      // IDENTITY: the denominator's label must appear as a WHOLE token-run in the rate
      // label, bounded on BOTH sides by the start/end or a connective. A content word on
      // either side extends the run into a DIFFERENT quantity and is refused — whether it
      // sits on the left ("total"/"project" before "cost") or the right ("cost overrun",
      // "budget shortfall", "cost recovery" all point at a "cost" node yet mean something
      // else). Left-anchoring alone let the right-extension through.
      const rateToks = norm(n.label).split(" ").filter(Boolean);
      const denToks = norm(den.label).split(" ").filter(Boolean);
      // A SCOPE qualifier immediately after the denominator run reframes it into a
      // LARGER quantity than the node it names: "share of cost OF THE WHOLE PROJECT"
      // matches the "cost" node (the grant, 108k) by token-run, but means the total
      // project cost (the register's own 120k node), certifying 75% of the grant as 75%
      // of the total (adv2 A13). "of" is a legal connective, so rightOk alone accepts it;
      // this refuses the match when the connective run after the denominator introduces a
      // scope word. Discard-on-doubt: a rate must name the EXACT node it divides by.
      const SCOPE_REFRAME = new Set(["whole", "total", "entire", "overall", "combined",
        "full", "gross", "aggregate", "all"]);
      const namesDenominator = denToks.length > 0 && rateToks.some((_, i) => {
        if (i + denToks.length > rateToks.length) return false;
        for (let j = 0; j < denToks.length; j++) if (rateToks[i + j] !== denToks[j]) return false;
        const leftOk = i === 0 || RATE_LABEL_CONNECTIVES.has(rateToks[i - 1]);
        const end = i + denToks.length;
        const rightOk = end === rateToks.length || RATE_LABEL_CONNECTIVES.has(rateToks[end]);
        // Walk the connective run after the denominator; if a scope word appears in it,
        // the denominator has been reframed into a different quantity — refuse.
        let k = end;
        while (k < rateToks.length && RATE_LABEL_CONNECTIVES.has(rateToks[k])) k++;
        const reframed = k < rateToks.length && k > end && SCOPE_REFRAME.has(rateToks[k]);
        return leftOk && rightOk && !reframed;
      });
      if (!namesDenominator) {
        throw new RegisterError("rate_denominator_label", n.id,
          `"${n.label}" is taken over ${den.id} ("${den.label}") but does not name it as its own ` +
          `denominator — the label is absent, or a content word extends it into a different quantity. ` +
          `A rate must name the exact quantity it is divided by, or it is right about the wrong one.`);
      }
      value = num.value / den.value;
      derivation = `${members[0]} / ${members[1]} = ${num.value} / ${den.value}`;
    }

    value = snap(n.unit_kind, value);
    if (!Number.isFinite(value)) throw new RegisterError("not_finite", n.id, "resolved to a non-finite value");
    // PATCH 7. 280 places x 0.77 attendance is 215.6 people. That is not a number of
    // people, and rounding it let 216 and 215 both "close". Decompose it instead.
    if (WHOLE.includes(n.unit_kind) && !Number.isInteger(value)) {
      throw new RegisterError("fractional_count", n.id,
        `${derivation} = ${value}, which is not a whole number of ${n.unit}. ` +
        `Express the quantity you actually mean; do not round a fraction into a headcount.`);
    }

    // ---------- 3. THE CLOSURE CHECK ----------
    // Recompute every total; fail on any mismatch with what the model asserted.
    // PATCH 8. `asserted` was optional, so the closure check — this module's whole
    // purpose — was opt-in, chosen by the model whose arithmetic it exists to police.
    // Omit it and the 200-vs-216 register in tests/numeric-register builds cleanly.
    if (n.kind !== "leaf" && n.asserted === undefined) {
      throw new RegisterError("derived_no_asserted", n.id,
        `"${n.label}" is a total and must state the figure you believe it comes to, so it can be contradicted. ` +
        `It will be recomputed: ${derivation} = ${value}.`);
    }
    if (n.asserted !== undefined) {
      const asserted = snap(n.unit_kind, n.asserted);
      if (asserted !== value) {
        throw new RegisterError("closure_mismatch", n.id,
          `you stated ${asserted} ${n.unit} for "${n.label}", but its components come to ${value}: ` +
          `${derivation}. Either the components are wrong or the total is wrong — fix the design, do not restate it.`);
      }
    }

    const r: Resolved = { id: n.id, label: n.label, unit: n.unit, unit_kind: n.unit_kind, kind: n.kind, value, members, basis: n.basis, derivation };
    mark.set(id, 1);
    done.set(id, r);
    return r;
  };

  for (const id of byId.keys()) walk(id, []);

  // ---------- 4. admissibility ----------
  // PATCH 9. Which figures are USED by another figure. A money leaf that nothing
  // consumes is not a unit cost, whatever the exemption at (iv) assumes.
  const referenced = new Set<string>();
  for (const n of list) for (const m of n.of ?? []) referenced.add(m);
  for (const r of done.values()) admissible(r, evidence, donorNums, referenced);

  // ---------- 5. immutability when extending ----------
  // PATCH 10. `opts.frozen` was declared in the signature and never read, so a
  // caller passing it — which is exactly what gen:budget is specified to do — got
  // silent acceptance of a revised or vanished design figure.
  if (opts.frozen) {
    for (const [id, prev] of opts.frozen) {
      const now = done.get(id);
      if (!now) throw new RegisterError("register_shrank", id, `"${prev.label}" was dropped; the register may only grow`);
      if (now.value !== prev.value || now.unit !== prev.unit) {
        throw new RegisterError("register_revised", id,
          `"${prev.label}" was ${prev.value} ${prev.unit} and is now ${now.value} ${now.unit}; ` +
          `the register may only grow, never be revised`);
      }
    }
  }

  return done;
}

export { resolveRegister, admissible, RegisterError, numbersIn, sigFigs };
export type { RegNode, Resolved, RegBasis, UnitKind };

function admissible(
  r: Resolved,
  evidence: Map<string, Set<number>>,
  donorNums: Set<number>,
  referenced: Set<string>,
): void {
  const b = r.basis;

  // (i) A figure attributed to the Evidence Ledger must be in THE ITEM IT NAMES.
  // PATCH 4 (cont). This was set membership over every integer in every ledger item
  // pooled together, with the value rounded first. On a real identity-only ledger
  // that pool is {registration number, a year, a stray 1} — enough to "verify" a
  // service statistic against a charity number and a percentage against nothing.
  if (b.kind === "evidence") {
    const id = b.detail.trim();
    if (!EVIDENCE_ID.test(id)) {
      throw new RegisterError("evidence_basis_malformed", r.id, `basis.detail must be an Evidence Ledger id, got "${b.detail}"`);
    }
    const item = evidence.get(id);
    if (!item) {
      throw new RegisterError("evidence_basis_unknown_item", r.id,
        `${b.detail} is not an item in this order's Evidence Ledger`);
    }
    // A ratio may be verified against an item that states it AS A PERCENTAGE, but
    // ONLY a percentage. numbersIn() records the fraction (0.29) for a number that
    // wore a "%" ("29%") and for no other, so item.has(r.value) matches a real "29%"
    // and rejects a 0.11 ratio that merely collides with a headcount ("11 staff") —
    // asPercent(0.11)=11 no longer verifies anything (adv2 A10). Exactness, not
    // tolerance: the fraction is snapped onto the same 1e-6 grid the module closes on.
    if (!item.has(r.value)) {
      throw new RegisterError("evidence_basis_wrong_item", r.id,
        `${r.value} is attributed to ${id}, but ${id} does not state that figure. ` +
        `Cite the item that does, or drop the claim — do not attach a real id to a number it does not carry.`);
    }
  }

  // (ii) A figure attributed to the donor must appear in the grant intelligence.
  // Same %-provenance as (i): a donor percentage ("20%") registers its fraction (0.20)
  // through numbersIn, so a ratio matches r.value directly; a bare "20 sites" in the
  // grant no longer verifies a 0.20 ratio via asPercent.
  // Exactness, mirroring the evidence branch (i): a ratio's fraction (0.75) matches the
  // grant only if the grant states that percentage, which numbersIn records as 0.75.
  // The old code also accepted Math.round(r.value): for a ratio that rounds a share
  // (0.75->1, any share >=0.5->1) onto a bare "1", and a stray "1" is near-universal in
  // the analysis blob, so a FABRICATED "the fund covers 75% of costs" verified against
  // that "1" — an ungrounded figure certified as the donor's own (adv2 A12). Rounding is
  // only ever meaningful for a COUNT, which is already integral, so donorNums.has(r.value)
  // covers it; the round disjunct only ever admitted the ratio collision. Dropped.
  if (b.kind === "donor" && !donorNums.has(r.value)) {
    throw new RegisterError("donor_basis_unverified", r.id,
      `${r.value} is attributed to the grant guidelines ("${b.detail}") but no such figure appears in them`);
  }

  // (iii) ANTI-PSEUDO-PRECISION / ANTI-ARBITRARY-TARGET.
  // A planning estimate cannot be a large precise standalone count. If you know it to three
  // significant figures you know how you got it, so express the arithmetic; if you do not, you are
  // choosing a number that sounds right. Either way the leaf is inadmissible.
  if (r.kind === "leaf" && r.unit_kind === "count" && r.value >= 100 &&
      (b.kind === "estimate" || b.kind === "capacity") && sigFigs(r.value) > 2) {
    throw new RegisterError("pseudo_precision", r.id,
      `${r.value} ${r.unit} ("${r.label}") is a planning estimate stated to ${sigFigs(r.value)} significant figures ` +
      `with no arithmetic behind it. Express it as a sum or product of the quantities that produce it, ` +
      `cite an Evidence Ledger item, or remove it.`);
  }

  // (iv) Money leaves are exempt from (iii) on the ground that they are unit costs.
  // PATCH 9 (cont). That ground is now tested rather than assumed: a unit cost is
  // consumed by something. A large, precise money leaf that no other figure uses is
  // an undecomposed headline total, which is the very thing (iii) exists to refuse.
  if (r.kind === "leaf" && r.unit_kind === "money" && r.value <= 0) {
    throw new RegisterError("nonpositive_cost", r.id, `${r.value} ${r.unit}`);
  }
  if (r.kind === "leaf" && r.unit_kind === "money" && r.value >= 1000 && sigFigs(r.value) > 2 &&
      (b.kind === "estimate" || b.kind === "capacity") && !referenced.has(r.id)) {
    throw new RegisterError("money_leaf_total", r.id,
      `${r.value} ${r.unit} ("${r.label}") is a precise planning figure that no other figure uses, ` +
      `so it is a total, not a unit cost. Decompose it into the quantities that produce it.`);
  }
}
