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

// counts, durations and money close exactly at whole units; ratios and rates at 1e-6.
const snap = (k: UnitKind, n: number) =>
  k === "ratio" || k === "rate" ? Math.round(n * 1e6) / 1e6 : Math.round(n);

// significant digits of the integer part: 216 -> 3, 200 -> 1, 1250 -> 3
function sigFigs(n: number): number {
  const s = Math.abs(Math.round(n)).toString().replace(/0+$/, "");
  return s.length || 1;
}

function numbersIn(s: string): Set<number> {
  const out = new Set<number>();
  for (const m of s.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) out.add(Math.round(n));
  }
  return out;
}

function resolveRegister(
  raw: unknown,
  currency: string,
  evidenceNums: Set<number>,
  donorNums: Set<number>,
  opts: { frozen?: Map<string, Resolved> } = {},
): Map<string, Resolved> {
  const list = Array.isArray(raw) ? (raw as RegNode[]) : null;
  if (!list || !list.length) throw new RegisterError("register_missing", null, "the design carries no numeric_register");
  if (list.length > 200) throw new RegisterError("register_too_large", null, `${list.length} nodes`);

  // ---------- 1. shape ----------
  const byId = new Map<string, RegNode>();
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

    if (n.kind === "leaf") {
      if (!Number.isFinite(n.value as number)) throw new RegisterError("leaf_no_value", n.id, "a leaf must carry a numeric value");
      if ((n.value as number) < 0) throw new RegisterError("negative", n.id, String(n.value));
      if (n.of !== undefined) throw new RegisterError("leaf_has_of", n.id, "a leaf cannot have members");
      if (n.asserted !== undefined) throw new RegisterError("leaf_has_asserted", n.id, "asserted belongs to derived nodes only");
      if (n.basis.kind === "arithmetic") throw new RegisterError("leaf_arithmetic_basis", n.id, "a leaf is not computed; give its real source");
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
      value = num.value / den.value;
      derivation = `${members[0]} / ${members[1]} = ${num.value} / ${den.value}`;
    }

    value = snap(n.unit_kind, value);
    if (!Number.isFinite(value)) throw new RegisterError("not_finite", n.id, "resolved to a non-finite value");

    // ---------- 3. THE CLOSURE CHECK ----------
    // Recompute every total; fail on any mismatch with what the model asserted.
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
  for (const r of done.values()) admissible(r, evidenceNums, donorNums);

  return done;
}

export { resolveRegister, admissible, RegisterError, numbersIn, sigFigs };
export type { RegNode, Resolved, RegBasis, UnitKind };

function admissible(r: Resolved, evidenceNums: Set<number>, donorNums: Set<number>): void {
  const b = r.basis;

  // (i) A figure attributed to the Evidence Ledger must actually be in it.
  if (b.kind === "evidence") {
    if (!EVIDENCE_ID.test(b.detail.trim())) {
      throw new RegisterError("evidence_basis_malformed", r.id, `basis.detail must be an Evidence Ledger id, got "${b.detail}"`);
    }
    if (!evidenceNums.has(Math.round(r.value))) {
      throw new RegisterError("evidence_basis_unverified", r.id,
        `${r.value} is attributed to ${b.detail} but that figure does not appear in the Evidence Ledger`);
    }
  }

  // (ii) A figure attributed to the donor must appear in the grant intelligence.
  if (b.kind === "donor" && !donorNums.has(Math.round(r.value))) {
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

  // (iv) Money leaves are unit costs and are explicitly planning estimates (:1591), so they are
  // exempt from (iii) — but they must be positive and must not themselves be totals.
  if (r.kind === "leaf" && r.unit_kind === "money" && r.value <= 0) {
    throw new RegisterError("nonpositive_cost", r.id, `${r.value} ${r.unit}`);
  }
}
