# Design — numeric integrity, cost accounting, currency, drift monitoring

Design document only. This track writes no code into `supabase/functions/worker/index.ts` and no
migration. Everything below is specified against the real source so that whoever owns those files can
apply it mechanically.

---

## 0. Line-number convention, and what is already in the tree

Line numbers are against the **working tree** copy of
`/home/user/ktebli/supabase/functions/worker/index.ts`, which is **1995 lines**, not the 1929-line
byte-verified v26 at `HEAD`. Another track has already inserted `notifyTerminal()` (:1052-1100) plus a
`release_stranded_claim` call and a `final` branch in the dispatcher catch, so everything after
:1045 in this tree sits ~51 lines below the numbers quoted in `audit-integrity.md`. Where the audit
and this document disagree on a number, **this document is the one that was read against the tree**.
Every anchor below is quoted verbatim as well as numbered, so a further shift cannot invalidate it.

Already committed by sibling tracks and depended on here:

* `supabase/migrations/20260826150000_stranded_claims_and_alerting.sql` — `job_stages.notified_at`,
  `escalations.order_id`, `escalations.order_proposal_id`, `escalations.due_at` default, and the
  `escalations_kind_check` list `stage_failed | stage_held | order_stalled | delivery_failed`.
  **Part D extends that CHECK**; it does not replace it.
* `design-resumability-and-alerts.md` proposes `20260826160000_resumable_stages.sql`
  (`job_stages.progress`, `job_stages.yields`, `yield_stage()`), and modifies `done()` at :1179.
  **This design also modifies `done()`** (Part B.4). Those two edits touch the same three lines and
  must be applied as one combined edit — see §E.2.

This design adds exactly one migration, `20260826170000_numeric_register_costs_currency_drift.sql`,
applied after `…160000`. No new service. No new edge function. Stages stay strictly sequential and
each still consumes only the ones before it.

---

# PART A — NUMERIC DERIVATION

## A.1 What the code does today, verified

**One number in the whole pipeline is derived rather than restated.** It is the budget total, at
:1594-1595 inside the `gen:budget` branch:

```ts
1594:      const total = (lines: Array<{ qty?: number; unit_cost?: number }>) =>
1595:        Math.round(lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0));
```

Everything else is a sampler instruction. The design object is pasted into every generation prompt as
prose, at :1219 inside `baseCtx()`:

```ts
1219:    (design ? `\n\nPROJECT DESIGN (the single source of truth — every number, activity, phase, indicator and cost in every document must derive from this):\n${JSON.stringify(design.project ?? design)}` : "") +
```

"single source of truth" is a phrase in a prompt. Nothing downstream reads a field. Each
`gen:*` stage re-emits every figure from an independent sampling call, and the design object itself
carries no composite structure to derive from — :1546-1550:

```ts
1546:      `"activities":[{"n":number,"activity":string,"months":string,"leads_to":string}],` +
1547:      `"phases":[{"phase":string,"months":string}],"duration_months":number,` +
1548:      `"participants_total":number|null,"staffing":[string],...
1552:      `"indicators":[{"indicator":string,"type":"output"|"outcome","baseline":string,"target":string,...}],` +
1550:      `"budget_envelope_usd":number|null,"budget_drivers":[string]},` +
```

`participants_total` is one scalar with **no components in the data model**. `indicators[].target` is
a `string`. So the 120 / 60 / 36 that sum to 216 exist only inside prose the model wrote at
generation time; nothing in the system knows they are addends, and nothing can add them.

The single numeric validator is `consistencyFindings()` at :307-336, called once per correction round
from `validate` at :1662:

```ts
1662:      detFindings.push(...consistencyFindings(docs, dn, budget?.total_usd ?? null, evidenceNums));
```

It performs three tests and **never adds anything**. It is also one-directional:

```ts
316:        if (n > dn.participants * 1.01 && !numbersNear(n, dn.participants)) {
326:        if (n > dn.duration_months && n <= 60 && !numbersNear(n, dn.duration_months)) {
```

A design carrying `participants_total: 216` with a headline of "200 beneficiaries" evaluates
`200 > 216 * 1.01` → false → **pass**. That is the observed defect, and it is invisible by
construction. `numbersNear(a,b) { return a === b; }` (:292) is dead: it is only reached from a branch
that has already proved `n !== dn.participants`. The unit regex at :313
(`/participants|beneficiaries|people (?:reached|served|trained)|individuals/`) does not match "young
people", "parents" or "peer mentors", so the components are never scanned; and the 5% floor at :314
would discard them anyway. No currency amount in any document is ever scanned — `scanNumbers` is
called exactly twice, at :313 and :323. The document set is a hardcoded four at :1629, so
`risk_table`, `board_summary` and `cover_email` are never scanned at all. On the `draft` tier there is
no `gen:budget` stage (`stripe-webhook/index.ts:63-69`), so the budget test never runs either.

## A.2 The mechanism, in one paragraph

The `design` stage stops emitting scalars and emits a **Numeric Register**: a flat list of typed
nodes, each with an id, a unit, a derivation, and either a literal value (leaf) or an operation over
other nodes (`sum` / `product` / `rate`). A pure TypeScript function `resolveRegister()` topologically
resolves it, **recomputes every derived node, and throws if the model's own asserted total disagrees
with the computed one** — that is the 200-vs-216 catch, and it fires before a single word of narrative
exists. The resolved register is persisted on the design stage output, rendered into `baseCtx()` as a
labelled table with an explicit "never compute a new figure" rule, and extended (never revised) by
`gen:budget`. At `validate`, `registerConformance()` replaces `consistencyFindings()`: it extracts
every figure from **every** generated document and requires each one to trace to a register id, to the
Evidence Ledger, or to the donor's own guidelines. Anything else is a blocking finding.

Nothing about the stage sequence changes. Nothing new is called over the network. The register lives
in `job_stages.output` jsonb, so **Part A needs no migration at all**.

## A.3 The register type, and the design-call schema change

```ts
// ================= Numeric Register — the single structured source of truth =================
// Every figure that will appear in any delivered document is declared here once, with the
// derivation that produced it. Later stages REFERENCE ids; they never originate figures.
type UnitKind = "count" | "money" | "duration" | "ratio" | "rate";
type BasisKind = "evidence" | "donor" | "estimate" | "capacity" | "arithmetic";

interface RegBasis {
  kind: BasisKind;
  // evidence  -> an Evidence Ledger id, e.g. "E-WEB-4"
  // donor     -> a reference into the grant text, e.g. "sec 4.2 ceiling"
  // estimate  -> a planning assumption, e.g. "trainer day rate, planning estimate"
  // capacity  -> a stated constraint, e.g. "one youth worker can hold 15 in a group"
  // arithmetic-> mandatory and only legal on derived nodes
  detail: string;
}

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
```

The `design` prompt at :1541-1553 gains one field and loses three scalars. Replace

```ts
1548:      `"participants_total":number|null,` ...
1550:      `"budget_envelope_usd":number|null,"budget_drivers":[string]},` +
1552:      `"indicators":[{...,"baseline":string,"target":string,...}],` +
```

with

```ts
      `"numeric_register":[{"id":string,"label":string,"unit":string,` +
      `"unit_kind":"count"|"money"|"duration"|"ratio"|"rate",` +
      `"kind":"leaf"|"sum"|"product"|"rate","value":number,"of":[string],"asserted":number,` +
      `"basis":{"kind":"evidence"|"donor"|"estimate"|"capacity"|"arithmetic","detail":string}}],` +
      `"participants_total":{"ref":string},"duration_months":{"ref":string},` +
      `"budget_envelope":{"ref":string},"budget_categories":[{"category":string,"ref":string}],` +
      `"indicators":[{"indicator":string,"type":"output"|"outcome","baseline":string,` +
      `"target":{"ref":string},"method":string,"frequency":string}],` +
```

and add these rules to the `Rules (strict):` block at :1554-1560:

```
- numeric_register: EVERY number that will appear anywhere in any document is declared here once,
  and nowhere else. A figure with no entry cannot be written.
- A leaf carries "value" and NEVER "of" or "asserted". A sum/product/rate carries "of" and NEVER
  "value"; it may carry "asserted" — your own belief about the result — which will be RECOMPUTED and
  rejected if it disagrees. Do not state a total you have not decomposed.
- basis is mandatory and is the derivation, not a restatement of the label. "evidence" must name an
  Evidence Ledger id and its value must appear in that ledger. "donor" must name where in the grant
  text the figure is stated, and its value must appear in the grant intelligence. A target that you
  cannot derive from activities, capacity, evidence or the donor's own text CANNOT BE ENTERED — write
  the design without it rather than choosing a number that sounds right.
- Counts of 100 or more that are planning estimates must be expressed as a sum or a product of the
  quantities that produce them (4 cohorts x 30 places), not as a single figure. A precise-looking
  standalone count with no arithmetic behind it will be rejected.
- All money nodes are in the proposal currency and only that currency. Never mix currencies.
```

**Backward compatibility.** In-flight orders hold design outputs with the old scalar shape. Every
reader goes through one helper so both shapes work and no order is stranded mid-pipeline:

```ts
function refValue(project: Record<string, unknown>, field: string, reg: Map<string, Resolved> | null): number | null {
  const v = project[field];
  if (v && typeof v === "object" && typeof (v as { ref?: string }).ref === "string") {
    return reg?.get((v as { ref: string }).ref)?.value ?? null;   // new shape
  }
  if (typeof v === "number") return v;                             // legacy scalar
  const legacy = project[field + "_usd"];                          // budget_envelope -> budget_envelope_usd
  return typeof legacy === "number" ? legacy : null;
}
```

## A.4 `resolveRegister()` — the deterministic closure check

Pure function. No I/O, no model, no network. Lives beside `consistencyFindings()` at :291-336 (which
it replaces).

```ts
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

  // ---------- 4. admissibility of derivations (see A.5) ----------
  for (const r of done.values()) admissible(r, evidenceNums, donorNums);

  // ---------- 5. immutability when extending (see A.6) ----------
  if (opts.frozen) {
    for (const [id, prev] of opts.frozen) {
      const now = done.get(id);
      if (!now) throw new RegisterError("register_shrank", id, "an existing register entry was dropped");
      if (now.value !== prev.value || now.unit !== prev.unit) {
        throw new RegisterError("register_revised", id,
          `"${prev.label}" was ${prev.value} ${prev.unit} and is now ${now.value} ${now.unit}; the register may only grow, never be revised`);
      }
    }
  }
  return done;
}
```

**The observed failure, exactly.** A design whose beneficiary components are 120 / 60 / 36 and whose
headline total is 200 produces:

```
closure_mismatch [N4]: you stated 200 people for "total direct beneficiaries", but its components
come to 216: N1 + N2 + N3 = 120 + 60 + 36. Either the components are wrong or the total is wrong —
fix the design, do not restate it.
```

thrown from the `design` stage, before any narrative exists.

## A.5 Admissibility — why an arbitrary target cannot enter the register

This is where "pseudo-precise figures with no derivation" and "arbitrary targets" die. It is not a
prompt instruction; it is a gate on entry.

```ts
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
```

Three consequences, stated explicitly because they are the point of the design:

1. **An arbitrary target cannot enter.** Every leaf needs a `basis`, and each of the four leaf bases
   is *checkable*: `evidence` against `evidenceNums`, `donor` against `donorNums`, `estimate` and
   `capacity` against rule (iii). There is no basis that means "it seemed reasonable". A target the
   model cannot derive has nowhere to go, and since **only register figures may be written** (A.7,
   A.8), it cannot appear in a document either.
2. **A pseudo-precise figure cannot enter.** "1,247 young people" as a planning estimate throws
   `pseudo_precision`. The model's only escapes are legitimate ones: decompose it into a product
   (`83 per cohort x 15 cohorts`), or cite the ledger item that actually says 1,247.
3. **A round-and-impressive figure is not exempt either.** Rule (iii) polices precision, but rules
   (i) and (ii) plus the mandatory non-empty `basis.detail` police roundness: "500 beneficiaries" with
   `basis: {kind:"estimate", detail:"target"}` fails `empty_basis` in spirit and, more usefully,
   fails conformance downstream unless it is decomposed. This is `reports/quality-standard.md`
   disqualifier 6 ("Targets feel arbitrary. Round numbers with no derivation") turned into a throw.

## A.6 Wiring into the `design` stage, and extension at `gen:budget`

**`design` (after the structural guard at :1562-1565, before the ceiling guard at :1566-1570):**

```ts
    // Evidence and donor number sets, hoisted out of validate (currently built at :1647-1654).
    const evidenceNums = evidenceNumbers(allowedEvidence);
    const donorNums = numbersIn(JSON.stringify(analysis ?? {}));
    const cur = currencyOf(analysis, c.order);          // Part C

    let register: Map<string, Resolved>;
    try {
      register = resolveRegister(project.numeric_register, cur.code, evidenceNums, donorNums);
    } catch (e) {
      if (e instanceof RegisterError) throw new Error(`numeric register rejected — ${e.message}`);
      throw e;
    }

    // the three former scalars now resolve THROUGH the register
    const participants = refValue(project, "participants_total", register);
    const months       = refValue(project, "duration_months", register);
    const envelope     = refValue(project, "budget_envelope", register);
    const ceiling      = analysisAmount(analysis, "funding_ceiling");   // Part C
    if (ceiling && envelope && envelope > ceiling) {
      throw new Error(`design over ceiling: envelope ${envelope} ${cur.code} exceeds donor ceiling ${ceiling} ${cur.code}`);
    }
    return done({
      project, assumptions: d.assumptions ?? [], logic_check: d.logic_check ?? null,
      register: [...register.values()],
      resolved: { participants, duration_months: months, budget_envelope: envelope },
      currency: cur,
    });
```

The retry path already exists: a throw here leaves the dispatcher catch at :1970-1988 to set the
stage back to `pending` with `attempt` incremented, up to `max_attempts = 3`. **One improvement is
required for the retry to be worth anything** — today it re-samples blind. The design call must be
told why the last attempt was rejected. `stage.attempt` is already in scope (it is used at :1878):

```ts
    const priorReject = (stage.attempt ?? 0) > 1
      ? `\n\nYOUR PREVIOUS ATTEMPT WAS REJECTED BY THE ARITHMETIC CHECK: ${lastError}\nFix the cause, do not restate the same figures.`
      : "";
```

with `lastError` read from the row's `error` column, which the catch at :1979 already writes
(`await sel('job_stages?id=eq.…&select=error')` inside `ctx()`'s existing stage fetch — add `error`
to the select list at :1174 in `ctx()`). This turns three blind samples into one sample and two
corrections, which is what makes a hard gate affordable.

**`gen:budget` extension.** The register is created once and may only **grow**. The design-time
register carries the budget at *category* level (`budget_categories[].ref`, which the design already
reasons about via `budget_drivers` at :1550). `gen:budget` appends one money leaf per budget line and
one `sum` per category, then re-resolves the union against the frozen design register:

```ts
      // the model now returns a ref per line, and the register additions that back them
      // {"currency":"GBP","lines":[{...,"ref":"B14"}],"register_additions":[...]}
      const frozen = designRegister(c.out);                     // Map<string, Resolved> from design.output.register
      let ext: Map<string, Resolved>;
      ext = resolveRegister(
        [...frozen.values().map(toNode), ...(bj.register_additions as RegNode[] ?? [])],
        cur.code, evidenceNums, donorNums, { frozen });

      // deterministic closure between the JSON lines and the register
      const lineTotal = total(lines);                            // :1594-1595, unchanged
      const envelopeNode = ext.get(envelopeRef)!;
      if (Math.round(lineTotal) !== Math.round(envelopeNode.value)) {
        throw new Error(`budget lines total ${lineTotal} ${cur.code} but the register's "${envelopeNode.label}" is ${envelopeNode.value}`);
      }
      for (const l of lines) {
        const n = ext.get(String(l.ref));
        if (!n) throw new Error(`budget line "${l.item}" carries no register ref`);
        if (Math.round((Number(l.qty)||0) * (Number(l.unit_cost)||0)) !== Math.round(n.value)) {
          throw new Error(`budget line "${l.item}": ${l.qty} x ${l.unit_cost} = ${(Number(l.qty)||0)*(Number(l.unit_cost)||0)} but register ${n.id} says ${n.value}`);
        }
      }
      return done({ json: bj, total_amount: lineTotal, total_usd: lineTotal /* legacy key, kept */,
                    ceiling_amount: ceiling, envelope_amount: envelope, currency: cur,
                    register: [...ext.values()] });
```

The `register_revised` check inside `resolveRegister` is what enforces "derived once, referenced
later": if the budget stage tries to change the envelope it declared at design time, the stage throws.

**Draft tier.** There is no `gen:budget` on `draft` (`stripe-webhook/index.ts:63-69`), so the money
nodes stay at category level. Conformance (A.8) still checks every money figure in the narrative
against them, which is strictly more than v26 does on that tier today — where the budget test is
skipped entirely because `budget?.total_usd` is `undefined` (:1662, guard at :333).

## A.7 The prompt side: reference, do not generate

`baseCtx()` at :1219 currently dumps the whole design object. Replace that single line with the
design object **minus** the register, plus a rendered table:

```ts
const registerTable = (rows: Resolved[], cur: string) =>
  `\n\nNUMERIC REGISTER — the ONLY numbers you may write about this project. Each row has already been derived and checked.\n` +
  `| id | figure | unit | what it is | how it was derived |\n|---|---|---|---|---|\n` +
  rows.map((r) => `| ${r.id} | ${r.unit_kind === "money" ? fmtMoney(r.value, cur) : r.value} | ${r.unit} | ${r.label} | ${r.derivation} |`).join("\n") +
  `\n\nRULES FOR NUMBERS (absolute):\n` +
  `- Write each figure exactly as it appears above, in digits, with the meaning its label gives it.\n` +
  `- NEVER compute a new total, subtotal, average, percentage, per-unit or per-year figure. If a number you want is not in this table, it does not exist: write the sentence without it.\n` +
  `- Do not round, scale, approximate ("over 200", "nearly 250") or re-express a register figure.\n` +
  `- The only numbers permitted that are NOT in this table are calendar years, ordinals that index the project's own structure (Month 3, Output 2, Phase 1), and figures quoted from the Evidence Ledger or the donor's guidelines with their source named in the sentence.\n`;
```

Two amplifiers in the current code are fixed at the same time, because they are what makes sibling
documents disagree:

* **Ordering.** `gen:narrative` runs before `gen:budget` (`stripe-webhook:60,67`), so the narrative
  invents cost language before a budget exists. With the register, it no longer can: the money nodes
  it may cite are the design-time category envelopes, which the budget stage is then bound to.
* **Truncation.** :1580 — `priorNarrative.slice(0, 12_000)` — hides the last ~20% of a 2,500-word
  narrative from every sibling document that is told to "be consistent with it". Consistency is now
  carried by the register, which is complete and small, so this slice stops mattering. Keep the slice
  (it bounds prompt size) but move the register **above** it in `baseCtx()` so it is never the thing
  that gets cut.

## A.8 `registerConformance()` — every figure traceable, or hard fail

Replaces `consistencyFindings()` (:307-336) and its helpers `numbersNear` (:292) and `scanNumbers`
(:293-300), which are all deleted.

```ts
const CUR_SYM: Record<string, string> = { "£": "GBP", "$": "USD", "€": "EUR", "₹": "INR", "¥": "JPY", "₦": "NGN", "R": "ZAR" };
const MULT: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };

// unit lexicon — deliberately much wider than v26's four alternatives at :313
const UNIT_WORDS: Array<[RegExp, UnitKind]> = [
  [/^(?:people|persons?|participants?|beneficiaries|individuals|youth|young people|children|pupils|students|parents|carers|families|households|women|men|adults|staff|volunteers|mentors|trainees|graduates|clients|patients|residents|members|attendees)\b/i, "count"],
  [/^(?:sessions?|workshops?|cohorts?|groups?|classes|events?|trainings?|visits?|meetings?|placements?|referrals?|units?|centres?|centers?|sites?|schools?|partners?|organisations?|organizations?|posts?|fte)\b/i, "count"],
  [/^(?:months?|weeks?|years?|days?|hours?|quarters?)\b/i, "duration"],
  [/^%/, "ratio"],
];

interface Figure { raw: string; value: number; unitKind: UnitKind | null; unitWord: string; before: string; doc: string; }

function extractFigures(doc: string, md: string, currency: string): Figure[] {
  const out: Figure[] = [];
  const RE = new RegExp(
    String.raw`([£$€₹¥₦]|\b(?:USD|EUR|GBP|CHF|SEK|NOK|DKK|AUD|CAD|NZD|JPY|INR|ZAR|KES|NGN|GHS|EGP|MAD|AED|SAR|QAR|JOD|LBP|TRY|BRL|MXN|PHP|IDR|BDT|PKR|LKR|NPR|UGX|TZS|RWF|ETB|XOF|XAF)\s*)?` +
    String.raw`(\d[\d,]*(?:\.\d+)?)\s*` +
    String.raw`(k\b|m\b|bn\b|thousand|million|billion)?\s*` +
    String.raw`(%|[A-Za-z][A-Za-z-]*(?:\s+[a-z][a-z-]*)?)?`, "g");
  for (const m of md.matchAll(RE)) {
    const [all, curTok, digits, multTok, tail] = m;
    let v = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(v)) continue;
    if (multTok) v *= MULT[multTok.toLowerCase().replace(/\b$/, "")] ?? 1;
    let kind: UnitKind | null = null;
    if (curTok) kind = "money";
    else if (tail) for (const [re, k] of UNIT_WORDS) if (re.test(tail)) { kind = k; break; }
    out.push({
      raw: all.trim(), value: v, unitKind: kind, unitWord: (tail ?? "").trim(),
      before: md.slice(Math.max(0, (m.index ?? 0) - 24), m.index ?? 0), doc,
    });
  }
  return out;
}

// ordinals that index the project's own structure: "Month 3", "Output 2", "Q4"
const ORDINAL_BEFORE = /\b(month|year|week|day|quarter|q|phase|stage|step|output|outcome|objective|activity|indicator|section|annex|appendix|table|figure|round|cohort|version|page)\s*[.:#-]?\s*$/i;

function resolvesAsRatio(pct: number, reg: Resolved[]): boolean {
  for (const a of reg) for (const b of reg) {
    if (a.id === b.id || b.value === 0 || a.unit_kind !== b.unit_kind) continue;
    if (Math.round((a.value / b.value) * 100) === Math.round(pct)) return true;
  }
  return false;
}

interface ConformanceResult { blocking: string[]; warnings: string[]; scanned: number; matched: number }

function registerConformance(
  docs: Record<string, string>,
  reg: Resolved[],
  currency: string,
  evidenceNums: Set<number>,
  donorNums: Set<number>,
): ConformanceResult {
  const values = new Set(reg.map((r) => Math.round(r.value)));
  const blocking: string[] = [];
  const warnings: string[] = [];
  let scanned = 0, matched = 0;

  for (const [name, md] of Object.entries(docs)) {
    if (!md) continue;
    const seen = new Set<string>();                        // one finding per distinct figure per doc
    for (const f of extractFigures(name, md, currency)) {
      scanned++;
      const v = Math.round(f.value);

      if (values.has(v)) { matched++; continue; }                      // (1) a register figure
      if (evidenceNums.has(v)) { matched++; continue; }                // (2) an Evidence Ledger citation (:1647-1654)
      if (donorNums.has(v)) { matched++; continue; }                   // (3) the donor's own figure
      if (!f.unitKind && v >= 1900 && v <= 2100) { matched++; continue; }        // (4) calendar year
      if (ORDINAL_BEFORE.test(f.before) && v <= 120) { matched++; continue; }    // (5) structural ordinal
      if (f.unitKind === "ratio" && resolvesAsRatio(f.value, reg)) { matched++; continue; } // (6) derivable percentage

      const key = `${v}|${f.unitKind ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const msg = `${name}: the figure "${f.raw}" is not in the numeric register and is not cited from ` +
        `the Evidence Ledger or the donor's guidelines. Every number in this document must be one of the register figures, ` +
        `stated with its register meaning. Remove it or replace it with the correct register figure.`;

      // A figure that carries a project unit — people, money, time, a percentage — is a claim.
      // Anything else (a bare number in prose) is a warning so the loop cannot deadlock on noise.
      if (f.unitKind) blocking.push(msg); else warnings.push(msg);
    }
  }
  return { blocking, warnings, scanned, matched };
}
```

**The inversion.** v26 asks "does any scanned number contradict one of three scalars, upward?".
This asks "**is every number in every document traceable to a derived entry?**". The 200-vs-216
narrative fails on the second question even if the register is internally sound, because 200 is not a
register value; and the design that produced it never got that far, because `closure_mismatch` threw.

## A.9 Wiring into `validate`

At :1626-1637 the document set is a hardcoded four plus the narrative. Replace it with every `gen:*`
output that carries `.text`, so `risk_table`, `board_summary` and `cover_email` are scanned too:

```ts
    const docs: Record<string, string> = { narrative };
    for (const [k, v] of Object.entries(c.out)) {
      if (!k.startsWith("gen:")) continue;
      const t = (v as { text?: string }).text;
      if (t) docs[k.slice(4)] = t;
    }
    const reg = [...(budgetRegister(c.out) ?? designRegister(c.out) ?? new Map()).values()];
```

and at :1662 replace the `consistencyFindings` call:

```ts
      const conf = registerConformance(docs, reg, cur.code, evidenceNums, donorNums);
      detFindings.push(...conf.blocking);
      softFindings.push(...conf.warnings);
```

The `blocking` count at :1704 already excludes jargon findings by prefix; conformance blocking
findings are counted, warnings are not:

```ts
      const blocking = groundingProblems.length + missingMandatory.length +
        detFindings.filter((f) => !f.startsWith("repeated development jargon") && !f.startsWith("heavy development jargon")).length;
```

and the correction prompt at :1725 gains the warnings as advisory lines. The existing deadlock
protection is preserved unchanged.

**On deadlock, deliberately.** If the correction rounds end with only numeric findings outstanding,
the stage throws at :1710-1717 exactly as it does today, the order goes to `attention`, and
`notifyTerminal()` (:1052-1100, already in the tree) emails the customer and raises an escalation.
That is the correct trade: a paid customer told "we could not finish" is recoverable; a paid customer
sent a budget that does not add up is not. The false-positive corpus test in A.11 is what bounds how
often that happens, and it is a release gate, not a hope.

## A.10 The customer-facing sentence must be corrected

:1121, inside `reportMd()` — the Full-tier review report the customer receives:

```ts
1121:  md += `- **Numbers and consistency.** Participant figures, timelines and budget totals were reconciled across every document in your package.\n\n`;
```

Nothing reconciles anything across every document today. After this change it becomes true, and the
sentence should say what actually happened, because a specific claim is worth more than a vague one:

```ts
  md += `- **Numbers.** Every figure in your package was derived once, from a single set of quantities, and then checked: each total was recomputed from its components, and every number in every document was traced back to the entry it came from.\n\n`;
```

Until the register ships, that line is a customer-facing accuracy problem in its own right.

## A.11 Test plan for Part A

All offline. `deno test` under `tests/numeric-register/`. No network, no Supabase project, no orders.

1. **`resolveRegister()` unit fixtures** — one golden case per throw code, asserted by `code`, not by
   message text: `register_missing`, `bad_id`, `duplicate_id`, `no_basis`, `empty_basis`,
   `currency_mismatch`, `leaf_no_value`, `leaf_has_asserted`, `derived_has_value`, `sum_arity`,
   `binary_arity`, `self_reference`, `cycle` (A→B→C→A), `dangling_ref`, `sum_unit_mismatch`,
   `sum_kind_mismatch`, `product_unit`, `product_multiplier`, `divide_by_zero`,
   **`closure_mismatch`**, `evidence_basis_malformed`, `evidence_basis_unverified`,
   `donor_basis_unverified`, `pseudo_precision`, `nonpositive_cost`, `register_revised`,
   `register_shrank`. Plus a deep valid DAG (5 levels, 40 nodes) that must resolve, and a
   1,000-iteration property test that a randomly generated valid DAG always resolves and that
   perturbing any single leaf changes at least one ancestor.

2. **The live-failure regression fixture.** Follow the existing convention at
   `tests/regression/similarity-gate/`: add `tests/regression/numeric-register/200-vs-216/` holding
   the delivered narrative and its design object. Two assertions:
   * v26's `consistencyFindings(docs, {participants:216,…}, …)` returns `[]` — the miss, documented
     so it cannot be re-introduced;
   * `resolveRegister` on the register form of the same design throws `closure_mismatch` naming the
     total node, **and** `registerConformance` on the same narrative against a *correct* 216 register
     returns a blocking finding quoting "200".

3. **Mutation harness — the acceptance gate.** Take ~15 archived (design, documents) pairs that pass
   unperturbed. For each, generate perturbations of exactly one number: ±1; ±8%; two digits
   transposed; a subtotal replaced by a sibling's; a total understated by exactly one component's
   value (the observed shape); a total overstated; a figure moved between documents; a currency
   figure scaled by 1000. Require **100% flagged, 0% missed**. v26's `consistencyFindings` fails this
   harness on the first understatement, which is the point of running it.

4. **False-positive corpus.** Run `registerConformance` over the ~15 unperturbed archived proposals
   and require **zero blocking findings**. This is the test that stops the widened unit lexicon from
   stranding real orders, and it must be re-run whenever `UNIT_WORDS`, `ORDINAL_BEFORE` or the
   extraction regex changes. Report `matched/scanned` as a tracked ratio; a sudden drop means the
   extractor has started missing figures rather than the documents having got cleaner.

5. **Extractor unit tests.** `£1.2 million` → 1200000 money; `1,250 young people` → 1250 count;
   `18-month` → 18 duration; `Month 3` → ordinal-exempt; `2024` → year-exempt; `35%` → ratio;
   `USD 450,000` → money; `4 cohorts of 30` → two counts. Each asserted on `{value, unitKind}`.

6. **Draft-tier guard.** Build a fixture with no `gen:budget` output and assert conformance still runs
   over the narrative and still checks money against the design-time category nodes — the case where
   v26 checks nothing at all.

7. **Extension immutability.** A `gen:budget` fixture whose `register_additions` silently change the
   design's envelope must throw `register_revised`; one that only appends must resolve.

8. **Backward compatibility.** `refValue()` against a legacy design object (`participants_total: 216`,
   `budget_envelope_usd: 240000`) must return the same values it does today, with `reg = null`.

No human is in any of this. The mutation harness and the false-positive corpus are both pass/fail
in CI.

---

# PART B — COST ACCOUNTING, UNCONTAMINATED

## B.1 The defect, verified

:127-130:

```ts
127: // Per-stage token accounting (observability; reset per runStage call)
128: const usage = { calls: 0, prompt_tokens: 0, completion_tokens: 0 };
129: function usageReset() { usage.calls = 0; usage.prompt_tokens = 0; usage.completion_tokens = 0; }
130: function usageSnap() { return { ...usage }; }
```

Written in `llmRaw` at :151-153, reset as the **first statement** of `runStage` at :1176, and
snapshotted into stage output at :1379, :1417, :1528, :1571, :1607, :1619, :1746, :1774, :1817,
:1928. `PARALLEL = 3` (:44), and the dispatcher at :1966-1990 runs up to three `runStage` calls
concurrently inside one isolate via `Promise.all`. They share one `usage` object, and every `await` —
`ctx()` at :1178, every `beat()`, every `fetch` in `llmRaw` — yields to the siblings.

The recorded value is therefore the running total of every call made by every stage in the isolate
since whichever stage most recently called `usageReset()`. A stage that finishes late absorbs its
neighbours' calls; a stage whose neighbour starts mid-flight has its own earlier calls zeroed away.
There is no true value anywhere in the record, in either direction. And because `usageReset()` is
called only inside `runStage` and never in the dispatcher's `while` loop (:1964), the first stage of
each loop iteration also inherits whatever survived the previous one.

**Conclusion: `job_stages.output.usage` on every existing row is unusable.** It should not be
corrected retroactively; it should be excluded from every reader (§B.5).

## B.2 The fix: an async-context-bound accumulator

`node:async_hooks` is available in the Supabase Edge Runtime. The store binds to the async context,
not to wall-clock ordering, so it is correct under arbitrary interleaving and arbitrary await depth —
including inside `llm`'s continuation loop (:157-166) and `generateValidated`'s three-attempt repair
loop (:625-673).

```ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface StageUsage {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  reasoning_tokens: number;
  cost_usd: number;                                   // OpenRouter's own number, not ours
  generation_ids: string[];                           // auditable against OpenRouter's activity export
  by_model: Record<string, { calls: number; cost_usd: number }>;
  unavailable?: true;                                 // set only if the boot probe failed
}

const USAGE = new AsyncLocalStorage<StageUsage>();
const newUsage = (): StageUsage => ({
  calls: 0, prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0,
  cost_usd: 0, generation_ids: [], by_model: {},
});
let USAGE_OK = true;
function usageSnap(): StageUsage {
  const u = USAGE.getStore();
  return u ? { ...u, generation_ids: [...u.generation_ids] } : { ...newUsage(), unavailable: true };
}
```

**Three edits, and no call site changes.**

1. `llmRaw` (:142-147) — ask OpenRouter for its own accounting:

```ts
    body: JSON.stringify({
      model: opts.model || MODEL,
      max_tokens: maxTokens,
      reasoning: { effort: opts.effort ?? "low" },
      usage: { include: true },                       // <- added
      messages: [{ role: "system", content: SYSTEM_GUARD }, ...messages],
    }),
```

2. `llmRaw` (:151-153) — replace the three global mutations:

```ts
  const u = USAGE.getStore();
  if (u) {
    const model = opts.model || MODEL;
    u.calls++;
    u.prompt_tokens     += Number(j.usage?.prompt_tokens ?? 0);
    u.completion_tokens += Number(j.usage?.completion_tokens ?? 0);
    u.reasoning_tokens  += Number(j.usage?.completion_tokens_details?.reasoning_tokens ?? 0);
    const cost = Number(j.usage?.cost ?? 0);
    u.cost_usd += cost;
    if (typeof j.id === "string" && u.generation_ids.length < 200) u.generation_ids.push(j.id);
    const m = (u.by_model[model] ??= { calls: 0, cost_usd: 0 });
    m.calls++; m.cost_usd += cost;
  }
```

3. The dispatcher (:1976, inside the `Promise.all` map) — bind the store:

```ts
        await USAGE.run(newUsage(), () => runStage(st));
```

Then **delete** `usageReset()` (:129) and its call at :1176.

`cost_usd` comes from OpenRouter rather than from a local price table applied to token counts, so it
survives model and pricing changes and needs no maintenance. `generation_ids[]` makes every stage's
cost auditable line-by-line against OpenRouter's own activity export, which is the authoritative
source when a number is disputed.

## B.3 If `AsyncLocalStorage` is unavailable

**Do not refuse to boot.** Halting a paid pipeline for an observability feature is the wrong trade —
the cost of wrong cost data is a bad spreadsheet; the cost of a dead worker is refunds. Probe once at
boot, and degrade honestly:

```ts
// in Deno.serve, after the secret check at :1954-1955
{
  const probe = newUsage();
  USAGE_OK = await USAGE.run(probe, async () => {
    await new Promise((r) => setTimeout(r, 0));       // force at least one context hop
    return USAGE.getStore() === probe;
  }).catch(() => false);
  if (!USAGE_OK) {
    await ins("escalations", {
      kind: "cost_accounting_unavailable", priority: "deadline_72h",
      detail: { runtime: "AsyncLocalStorage did not survive an await; per-stage costs will be recorded as unavailable" },
    }).catch(() => {});
  }
}
```

With `USAGE_OK === false`, `usageSnap()` returns `{unavailable: true}` and the SQL view in §B.5
excludes those rows. **A missing number is recoverable; a wrong number that looks right is not** —
that is the same principle that produced this project's byte-verification discipline.

The explicit fallback, if the probe ever fails permanently, is to thread the accumulator: add
`u?: StageUsage` to `LlmOpts` (:134), create `const u = newUsage()` at the top of `runStage`, and pass
`{ ...opts, u }` at every `llm` / `llmRaw` / `generateValidated` / `visualQA` call site (~20 sites,
including `generateValidated` at :625 and `visualQA` at :961, which both need the parameter added to
their signatures). Same correctness, larger diff, no runtime dependency. Given this project's deploy
discipline the diff cost is real, which is exactly why the context-bound version is preferred.

## B.4 Attribution, stamped once in `done()`

Two constants are wrong or absent, and both matter for §D as much as for cost.

* :45 — `const GENERATOR_VERSION = "worker-v12";` while the deployed worker is **v26**. It is stamped
  onto every delivered narrative at :1878 (`generator_version: GENERATOR_VERSION`).
* `MODEL` (:105) and `MODEL_STRATEGY` (:106), read from Vault at :1957-1958, are stamped nowhere.

Fix both in one place, so no call site can forget. `done()` is defined at :1179-1180:

```ts
1179:  const done = (output: unknown) =>
1180:    patch(`job_stages?id=eq.${stage.stage_id}`, { status: "done", finished_at: new Date().toISOString(), output });
```

becomes

```ts
  const done = (output: unknown) =>
    patch(`job_stages?id=eq.${stage.stage_id}`, {
      status: "done", finished_at: new Date().toISOString(),
      output: {
        ...(output as Record<string, unknown>),
        usage: usageSnap(),
        meta: {
          worker_version: WORKER_VERSION, renderer_version: RENDERER_VERSION,
          model: MODEL, model_strategy: MODEL_STRATEGY || MODEL,
          attempt: stage.attempt ?? null,
        },
      },
    });
```

and every explicit `usage: usageSnap()` at the ten call sites listed in §B.1 is **deleted**, which
also removes the forget-a-call-site failure class. `GENERATOR_VERSION` is renamed `WORKER_VERSION`
and set to the real deployed version.

> **Conflict with the resumability track.** `design-resumability-and-alerts.md` §A.6 also rewrites
> `done()` (to clear `progress`). These are the same three lines. Apply as one combined edit; the
> merged form is `{ status, finished_at, progress: null, output: {…, usage, meta} }`. See §E.2.

A CI test keeps the version honest: assert `WORKER_VERSION` matches the version documented in
`DEPLOY.md`, so a deploy that forgets to bump it fails before it ships.

## B.5 Reading the numbers

In the migration (`…170000`), a view that reads only post-fix rows — no historical data is mutated,
and contaminated rows simply never appear:

```sql
-- Per-stage cost. Restricted to rows written by a worker that stamps meta.worker_version,
-- because every row written before that carries a cross-contaminated usage object: the module
-- global at index.ts:128 was shared by up to three concurrent stages in one isolate. Those
-- numbers are not noisy, they are meaningless, and they are excluded rather than corrected.
create or replace view public.stage_costs
with (security_invoker = true) as
select
  s.proposal_id,
  s.id                                              as stage_id,
  s.key,
  s.attempt,
  s.finished_at,
  (s.output -> 'meta'  ->> 'worker_version')        as worker_version,
  (s.output -> 'meta'  ->> 'model')                 as model,
  (s.output -> 'usage' ->> 'calls')::int            as calls,
  (s.output -> 'usage' ->> 'prompt_tokens')::bigint as prompt_tokens,
  (s.output -> 'usage' ->> 'completion_tokens')::bigint as completion_tokens,
  (s.output -> 'usage' ->> 'cost_usd')::numeric     as cost_usd,
  (s.output -> 'usage' -> 'generation_ids')         as generation_ids,
  extract(epoch from (s.finished_at - s.started_at)) as seconds
from public.job_stages s
where s.status = 'done'
  and s.output ? 'meta'
  and s.output -> 'meta' ? 'worker_version'
  and not coalesce((s.output -> 'usage' ->> 'unavailable')::boolean, false);

revoke all on public.stage_costs from anon, authenticated;
grant select on public.stage_costs to service_role;

create or replace view public.order_costs
with (security_invoker = true) as
select o.id as order_id, o.order_no, o.tier, o.amount_usd,
       sum(c.cost_usd)                    as model_cost_usd,
       sum(c.calls)                       as calls,
       o.amount_usd - sum(c.cost_usd)     as gross_margin_usd
from public.orders o
join public.order_proposals p on p.order_id = o.id
join public.stage_costs c on c.proposal_id = p.id
group by o.id, o.order_no, o.tier, o.amount_usd;

revoke all on public.order_costs from anon, authenticated;
grant select on public.order_costs to service_role;
```

`security_invoker = true` is required — a plain view over an RLS table runs as its owner and would
bypass the `revoke` discipline this schema is built on.

## B.6 Test plan for Part B

`deno test`, no network, no production project. `llmRaw`'s `fetch` is stubbed throughout.

1. **Three-way interleaving.** Stub `fetch` to sleep `random(0,50)ms` and return a fixed usage
   payload. Run three tasks under the real dispatcher shape (`Promise.all` over `USAGE.run`), making
   3, 1 and 7 calls. Assert the three snapshots are exactly `{calls:3}`, `{calls:1}`, `{calls:7}`,
   and that `cost_usd` partitions the same way. **This test fails against v26 and passes after the
   fix.** That is the acceptance criterion, and it is the whole reason to write it.
2. **Deterministic adversarial schedule.** Hand-chosen sleeps reproducing the exact interleaving that
   makes stage A record 4 calls having made 3, so the failure is reproducible rather than
   probabilistic and the test cannot go green by luck.
3. **Await-depth test.** One task whose calls happen inside `generateValidated`'s repair loop
   (:625-673) and inside `llm`'s four-hop continuation loop (:157-166). Assert the context survives
   nested awaits and that continuation hops are counted as separate calls.
4. **Loop-carryover test.** Two dispatcher iterations in one invocation (the `while` at :1964); assert
   the second iteration's stages start from zero and do not inherit the first's totals — the
   second-order bug caused by `usageReset()` living only inside `runStage`.
5. **Probe-failure test.** Force the boot probe to return false and assert (a) the worker still
   claims and runs stages, (b) every stage output carries `usage.unavailable === true`, (c) exactly
   one escalation is written per invocation, not one per stage.
6. **`done()` stamping test.** Assert every stage output carries `meta.worker_version`,
   `meta.model` and `usage`, with no call site passing them explicitly.
7. **Version-drift CI test.** Assert `WORKER_VERSION` equals the version in `DEPLOY.md`.
8. **View test, replay only.** Run against `tests/replay/` (the existing shim harness), not against
   `uocauqflcqefgdixbzpf`: insert one pre-fix row (no `meta`) and one post-fix row, assert
   `stage_costs` returns exactly one.
9. **Reconciliation, read-only, at most the two $1 trial orders.** Sum `cost_usd` over a proposal's
   `generation_ids` and compare against OpenRouter's activity export for the same window. Agreement
   to the cent or the accounting is still wrong.

---

# PART C — CURRENCY

## C.1 Every place USD is assumed, verified by grep

| # | Line | What |
|---|---|---|
| 1 | :1104 | `GEN_SPECS.budget.brief` hardcodes `{"currency":"USD",…}` |
| 2 | :1592 | the brief the budget stage actually uses hardcodes `"currency":"USD"` again |
| 3 | :1230 | analyze schema: `"funding_floor_usd":number\|null,"funding_ceiling_usd":number\|null` |
| 4 | :1243 | analyze rule: "funding floor/ceiling: numeric USD only when the text states amounts" |
| 5 | :1550 | design schema: `"budget_envelope_usd":number\|null` |
| 6 | :1557 | design rule pins the envelope to the donor ceiling, unit unexamined |
| 7 | :1566-1570 | ceiling guard compares `envelope > ceiling` as bare numbers |
| 8 | :1596-1605 | cap `Math.min(ceiling, envelope*1.05)`, and the reprompt "YOUR PREVIOUS BUDGET TOTALLED USD …, above the allowed USD …" |
| 9 | :1607 | persisted as `total_usd`, `ceiling_usd`, `envelope_usd` |
| 10 | :334 | finding text "budget total USD … differs from the design's budget envelope USD …" |
| 11 | :1637 | `dn.budget_total` sourced from `budget_envelope_usd` |
| 12 | **:1852** | **the delivered spreadsheet**: `["Category","Item","Qty","Unit","Unit cost (USD)","Total (USD)"]` |
| 13 | — | `bj.currency` — the model returns it (per the briefs at :1104 and :1592) and **nothing reads it**. `grep -n '\.currency'` finds no consumer. |
| 14 | `20260820145739_orders_and_job_queue.sql:8-27` | `orders` has no country and no currency column. `amount_usd` is Ktebli's own price, not the applicant's. |
| 15 | :1305 (org profile) | extracts `"geographic_focus":[string]` — consumed only as an opaque blob inside `baseCtx()` |
| 16 | :1231 | analyze extracts `"geography":string\|null` — read by no code path |

Front end (`index.html`, `order.html`): zero occurrences of "country" or "currency".

## C.2 What actually goes wrong

This is not an FX bug. No conversion is attempted anywhere, so no rate can be wrong. It is a
**labelling bug, silent by construction.**

A UK charity applying to a UK funder for £250,000: `analyze` writes `250000` into
`funding_ceiling_usd` (:1230). `design` writes `240000` into `budget_envelope_usd` (:1550). The
budget model prices lines in pounds because the grant text is in pounds. `total(lines)` (:1594)
compares unit-less integers against a unit-less cap and passes, because everything is consistently
unit-less. Then :1852 stamps "Unit cost (USD) / Total (USD)" across a sterling budget and ships it.
Meanwhile the narrative writes whatever symbol the model chose, and `consistencyFindings` never scans
prose money at all, so a `$`/`£` split *inside one package* is invisible.

A budget spreadsheet whose column headers name the wrong currency is disqualification-grade on many
donor forms. Nothing in v26 can detect it.

## C.3 `resolveCurrency()` — donor first, applicant country second, never a default

```ts
type CurrencyBasis = "donor_stated" | "order_declared" | "order_country" | "inferred_geography" | "fallback_usd";
interface Currency { code: string; basis: CurrencyBasis; evidence: string | null }

const ISO4217 = new Set(["USD","EUR","GBP","CHF","SEK","NOK","DKK","AUD","CAD","NZD","JPY","INR","ZAR","KES","NGN","GHS","EGP","MAD","TND","AED","SAR","QAR","KWD","BHD","OMR","JOD","LBP","ILS","TRY","BRL","MXN","ARS","CLP","COP","PEN","PHP","IDR","MYR","THB","VND","SGD","HKD","CNY","KRW","BDT","PKR","LKR","NPR","UGX","TZS","RWF","ETB","ZMW","MWK","MZN","XOF","XAF","PLN","CZK","HUF","RON","BGN","UAH","GEL","AMD","AZN","KZT"]);

// symbols and codes that can be found in a grant page, mapped to a code.
const CUR_MARKERS: Array<[RegExp, string]> = [
  [/£|\bGBP\b|\bpounds? sterling\b/i, "GBP"],
  [/€|\bEUR\b|\beuros?\b/i, "EUR"],
  [/\bCHF\b|\bSwiss francs?\b/i, "CHF"],
  [/\bSEK\b|\bkronor\b/i, "SEK"],
  [/\bAED\b|\bdirhams?\b/i, "AED"],
  [/\bZAR\b|\brand\b/i, "ZAR"],
  [/\bKES\b|\bKenyan shillings?\b/i, "KES"],
  [/\bINR\b|₹|\brupees?\b/i, "INR"],
  [/US\$|\bUSD\b|\bUS dollars?\b/i, "USD"],
  // ... one row per code in ISO4217 that a donor plausibly states
];

const COUNTRY_CURRENCY: Record<string, string> = {
  GB: "GBP", IE: "EUR", FR: "EUR", DE: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", PT: "EUR",
  BE: "EUR", AT: "EUR", FI: "EUR", GR: "EUR", US: "USD", CA: "CAD", AU: "AUD", NZ: "NZD",
  CH: "CHF", SE: "SEK", NO: "NOK", DK: "DKK", PL: "PLN", CZ: "CZK", RO: "RON", TR: "TRY",
  ZA: "ZAR", KE: "KES", UG: "UGX", TZ: "TZS", RW: "RWF", ET: "ETB", NG: "NGN", GH: "GHS",
  EG: "EGP", MA: "MAD", TN: "TND", AE: "AED", SA: "SAR", QA: "QAR", JO: "JOD", LB: "LBP",
  IN: "INR", PK: "PKR", BD: "BDT", LK: "LKR", NP: "NPR", PH: "PHP", ID: "IDR", MY: "MYR",
  TH: "THB", VN: "VND", SG: "SGD", BR: "BRL", MX: "MXN", CL: "CLP", CO: "COP", PE: "PEN",
  // multinational donors are handled by rule 1, not here.
};

function resolveCurrency(
  analysis: Record<string, unknown> | undefined,
  grantText: string,
  order: { country?: string | null; currency?: string | null },
  orgProfile: Record<string, unknown> | undefined,
): Currency {
  // 1. the donor states it in its own guidelines — the only fully authoritative source.
  const claim = analysis?.currency as { code?: string; evidence?: string } | undefined;
  const code = String(claim?.code ?? "").toUpperCase();
  if (ISO4217.has(code)) {
    // deterministic corroboration: the model's quote must be IN the grant text, and the code (or
    // its symbol) must actually appear there. A model cannot invent a donor-stated currency.
    const quote = String(claim?.evidence ?? "").trim();
    const flat = grantText.replace(/\s+/g, " ").toLowerCase();
    const quoted = quote.length >= 8 && flat.includes(quote.replace(/\s+/g, " ").toLowerCase());
    const marker = CUR_MARKERS.some(([re, c]) => c === code && re.test(grantText));
    if (quoted && marker) return { code, basis: "donor_stated", evidence: quote.slice(0, 200) };
  }
  // 1b. no usable model claim, but the grant text carries exactly one currency marker.
  const hits = [...new Set(CUR_MARKERS.filter(([re]) => re.test(grantText)).map(([, c]) => c))];
  if (hits.length === 1) return { code: hits[0], basis: "donor_stated", evidence: "currency marker in the guidelines" };

  // 2-3. what the applicant told us on the order form.
  const oc = String(order.currency ?? "").toUpperCase();
  if (ISO4217.has(oc)) return { code: oc, basis: "order_declared", evidence: null };
  const cc = String(order.country ?? "").toUpperCase();
  if (COUNTRY_CURRENCY[cc]) return { code: COUNTRY_CURRENCY[cc], basis: "order_country", evidence: cc };

  // 4. inferred from geography already extracted at :1231 and :1305.
  const geo = [String(analysis?.geography ?? ""), ...(Array.isArray(orgProfile?.geographic_focus) ? orgProfile!.geographic_focus as string[] : [])].join(" ");
  const inferred = countryFromText(geo);        // exact ISO-3166 name/alpha2 match only, never fuzzy
  if (inferred && COUNTRY_CURRENCY[inferred]) return { code: COUNTRY_CURRENCY[inferred], basis: "inferred_geography", evidence: inferred };

  // 5. a fallback, recorded as a fallback — never as a fact.
  return { code: "USD", basis: "fallback_usd", evidence: null };
}
```

`analyze` gains one schema field at :1230 and one rule at :1243:

```ts
      `"currency":{"code":string|null,"evidence":string|null},` +
      `"amount":string|null,"funding_floor":number|null,"funding_ceiling":number|null,` +
...
      `- currency: the ISO-4217 code the donor states amounts in, with "evidence" a short VERBATIM quote from the text containing the amount or the currency word. If the text states no currency, both null. Never infer from the applicant's country — that is not your job here.\n` +
      `- funding floor/ceiling: the numeric amount in the donor's own currency, exactly as stated, with no conversion. Null when the text states no amount.\n` +
```

## C.4 Carry it as a field; never rename, never convert

In-flight orders hold stage outputs keyed `funding_ceiling_usd`, `budget_envelope_usd`, `total_usd`.
Renaming would strand every order mid-pipeline. So **add** the neutral keys and read new-then-old:

```ts
const analysisAmount = (a: Record<string, unknown> | undefined, base: string): number | null =>
  (a?.[base] as number | null) ?? (a?.[base + "_usd"] as number | null) ?? null;
```

Consume the resolved code at every one of the sixteen sites in §C.1: the two budget briefs (:1104,
:1592) take `"currency":"${cur.code}"`; the over-cap reprompt (:1602) reads
`TOTALLED ${cur.code} ${total(lines)}, above the allowed ${cur.code} …`; the xlsx header (:1852)
becomes `` `Unit cost (${cur.code})` `` / `` `Total (${cur.code})` ``; the finding text at :334 is
deleted with `consistencyFindings` and its replacement in `registerConformance` names `cur.code`.

**Never convert.** The register carries exactly one currency; `resolveRegister` throws
`currency_mismatch` on any money node whose unit is not the proposal currency, and `sum_unit_mismatch`
on any mixed-currency total. Mixed units are a design defect to reject, not an FX problem to solve.
If the donor states EUR, the package is EUR end to end.

**Surface the fallback rather than blocking on it.** When `basis === "fallback_usd"` and the resolved
geography is not US, `validate` emits a certification row into the existing `certifications` array
(:1739), which is already packaged into the customer-facing "Before you submit" document (:1846-1847):

```ts
      if (cur.basis === "fallback_usd" && !looksUS(analysis, org)) {
        certifications.push({
          claim: `This package is denominated in USD. The grant guidelines did not state a currency and we could not determine one from your location.`,
          classification: "donor_required_certification",
          note: `Confirm the currency the donor expects before you submit, and tell us if it is not USD — a revision will re-denominate the package.`,
        });
      }
```

No human enters the pipeline. The certifications channel already exists for exactly this class of
item, and the customer sees it at download time.

## C.5 Schema and front end (cross-track)

In the migration:

```sql
alter table public.orders add column if not exists country  text;   -- ISO-3166 alpha-2
alter table public.orders add column if not exists currency text;   -- ISO-4217, optional
alter table public.orders add constraint orders_country_iso2
  check (country is null or country ~ '^[A-Z]{2}$');
alter table public.orders add constraint orders_currency_iso
  check (currency is null or currency ~ '^[A-Z]{3}$');
```

`order.html` gains one country `<select>` and `save-intake` / `stripe-webhook` carry it through to
`orders`. That is one click for the customer and it is the only fully reliable source of applicant
country. **Note:** `save-intake` and `stripe-webhook` are among the seven functions CLAUDE.md flags as
transcribed and not byte-verified — re-pull with `supabase functions download <slug>` before touching
either. `resolveCurrency` reads `order.country` with `??` so the code works unchanged before those
columns exist or are populated; it simply falls through to rule 4.

## C.6 Test plan for Part C

1. **Table-driven `resolveCurrency()` tests**, ~20 rows asserting `{code, basis}`: FCDO in £; an EC
   call in €; a US federal NOFO in $; a UN agency in $ regardless of applicant country; a Gulf donor
   stating AED; a grant stating no amount at all + UK applicant → GBP via `order_country`; a grant
   stating no amount + no country + `geographic_focus:["Kenya"]` → KES via `inferred_geography`;
   conflicting signals (UK applicant, USD-denominated donor) → **USD, donor wins**; and a page
   containing both £ and $ with no model claim → `hits.length === 2` → falls through to the applicant,
   never guesses.
2. **Anti-invention test.** Model claims `{code:"GBP", evidence:"awards of up to £250,000"}` against a
   grant text that contains no `£` and no "GBP" → the claim is discarded and resolution falls
   through. This is the test that makes rule 1 deterministic rather than a second sampler.
3. **Golden xlsx render.** Build `Budget.xlsx` from a fixture with `code = "GBP"` and assert the
   header cells read exactly `Unit cost (GBP)` / `Total (GBP)`; the same fixture under `USD` reads
   `USD`. Pure `XLSX` round-trip through `npm:xlsx@0.18.5` (:35), no network.
4. **Mixed-currency rejection.** A register whose GBP total sums USD members must throw
   `currency_mismatch` (per-node) and `sum_unit_mismatch` (per-total).
5. **CI grep test — the cheapest and most durable of the five.** Assert
   `supabase/functions/worker/index.ts` contains no literal `USD` outside the `ISO4217` set, the
   `CUR_MARKERS` / `COUNTRY_CURRENCY` tables, and the legacy `*_usd` compatibility key names. Any
   future hardcode fails CI.
6. **Fallback-disclosure test.** A non-US geography with `basis:"fallback_usd"` produces exactly one
   certifications row and does **not** raise `blocking`.
7. **Legacy-order test.** A stage output carrying only `funding_ceiling_usd` resolves through
   `analysisAmount` to the same number, so an order mid-pipeline at deploy time completes.

---

# PART D — DRIFT MONITORING THAT IS NOT VALIDATOR-BASED

## D.1 Why no existing signal could have caught it

The failure: two model families, blind, rated pipeline output no better than a single well-crafted
prompt to the same model; **8/8 judgements said "reads machine-generated"**. Every one of those
proposals passed every validator. Per signal, in the code:

* **`blocking` (:1704)** counts `groundingProblems + missingMandatory + detFindings`, minus jargon by
  prefix. Its deterministic half is a **16-phrase regex** (`JARGON_RE`, :274) plus the one-scalar
  arithmetic check dismantled in Part A. Smooth generic prose that avoids sixteen specific clichés
  scores `blocking = 0`, which is the loop's break condition at :1706. **The metric is maximised by
  the failure mode.**
* **`claim_ledger`, `coverage`, `review_findings`** come from the same model family as the generator.
  The reviewer call at :1698 uses `model: deep ? (MODEL_STRATEGY || MODEL) : MODEL`, and
  `MODEL_STRATEGY` defaults to `MODEL` at :1958. Unless the operator has set a distinct strategy
  model in Vault, **the generator grades its own work** — the exact thing CLAUDE.md's testing
  conventions forbid. A generator does not perceive its own register as machine-like; that is what
  "in-distribution" means.
* **`check.longest_shared_run`** (:1777-1819) measures overlap with *other Ktebli proposals*. Eight
  proposals that are uniformly machine-sounding but individually reworded score **well**. It is a
  distinctness metric, and the failure preserves distinctness. It reported green.
* **`package.qa.*`** is layout only, deliberately: the visualQA prompt at :966-968 instructs "You must
  NOT assess, criticise, or report on the writing, argument, facts, tone, or content quality."
  `word_count` measures length, not merit.
* **`design.logic_check.chain_holds`** is asserted by the design call in the same response that
  produced the design (:1541-1560). Self-certification.
* **`usage`** is corrupt (Part B), and token counts would not separate good prose from bad anyway.
* **`revision_requests`** (`20260820172956…:11-18`) is the one genuinely external signal, and
  **nothing reads it**. No aggregate, no threshold, no alert.
* **`events`** is written only by `stripe-webhook`; the worker writes none.
* **Repair pressure is discarded.** `generateValidated` (:625-673) discovers content violations on
  attempts 1 and 2 and throws them away unless the third attempt also fails.

**The structural reason:** every recorded signal is either (i) produced by the same model that
produced the artefact, or (ii) a deterministic rule authored from a known past failure. (i) cannot see
its own distribution. (ii) can only catch what someone already thought to encode. Neither can surface
an unknown failure mode. The 8/8 verdict came from a **different model family judging blind against a
comparator**, and that comparison is the one thing the pipeline never performs on itself. Adding more
validators of either category cannot fix this. CLAUDE.md P1-8 is right: validator-based monitoring is
blind by construction.

## D.2 The signal: a blind paired comparison, out of band, after delivery

**Design in one sentence:** for a sampled share of *already-delivered* proposals, generate the
single-prompt comparator that beat the pipeline in the blind round, have a third model from a
different family judge the pair blind against `reports/quality-standard.md`'s disqualifier list, and
track the win-rate's Wilson lower bound over a rolling window; when it falls below 0.50 the system
holds **new** orders and emails the operator.

**Where it runs, and why it cannot delay a delivery.** Not in `validate` — that is on the critical
path and would add two model calls to every order. Not as a stage after `deliver` — a `monitor` stage
that failed would flip the proposal to `attention` via `rollup_statuses` and alarm a customer whose
proposal is already delivered and fine, and it would appear on the order page. Instead: **a second
pg_cron job POSTs the existing `worker` function with `{"mode":"quality_sample"}`.** No new function,
no new service, no new stage, no change to `stagesFor()`, no change to the stage sequence. The worker
already `Deno.serve`s and already authenticates on `x-worker-secret` (:1954-1955); it simply does not
read the body today. The sampler runs after `deliver` has completed and the customer has been emailed
(:1940-1947), so **it is structurally incapable of blocking or delaying a delivery.**

```ts
Deno.serve(async (req) => {
  const secret = await rpc("get_secret", { p_name: "worker_secret" }).catch(() => null);
  if (!secret || req.headers.get("x-worker-secret") !== secret) return new Response("forbidden", { status: 403 });
  API_KEY = await rpc("get_secret", { p_name: "openrouter_api_key" });
  MODEL = (await rpc("get_secret", { p_name: "openrouter_model" })) ?? MODEL;
  MODEL_STRATEGY = (await rpc("get_secret", { p_name: "openrouter_model_strategy" })) ?? MODEL;
  MODEL_JUDGE = (await rpc("get_secret", { p_name: "openrouter_model_judge" })) ?? "";
  if (!API_KEY) return new Response(JSON.stringify({ ok: false, reason: "openrouter key not configured; jobs held" }), { status: 200 });

  const body = await req.json().catch(() => ({}));
  if (body?.mode === "quality_sample") return await runQualitySample();   // never touches job_stages

  // ... existing dispatcher loop unchanged
});
```

### D.2.1 Family independence, enforced

```ts
const family = (m: string) => m.split("/")[0].toLowerCase();
function judgeUsable(): { ok: boolean; reason?: string } {
  if (!MODEL_JUDGE) return { ok: false, reason: "openrouter_model_judge not set" };
  if (family(MODEL_JUDGE) === family(MODEL)) return { ok: false, reason: `judge ${MODEL_JUDGE} shares a provider with the generator ${MODEL}` };
  if (MODEL_STRATEGY && family(MODEL_JUDGE) === family(MODEL_STRATEGY)) return { ok: false, reason: `judge shares a provider with ${MODEL_STRATEGY}` };
  return { ok: true };
}
```

Today `MODEL = "google/gemini-3.7-flash"` (:105) and `MODEL_STRATEGY` defaults to it (:1958), so a
judge of `openai/gpt-5.6-sol` or `x-ai/grok-4.6` — the two families
`reports/quality-standard.md` §4 actually used — passes. If the check fails, `runQualitySample`
returns without spending anything and writes one escalation. It never blocks the pipeline: this is a
monitor, and a monitor that can take down production is worse than no monitor.

### D.2.2 The sample

```ts
async function runQualitySample(): Promise<Response> {
  const j = judgeUsable();
  if (!j.ok) { await ins("escalations", { kind: "quality_monitor_misconfigured", priority: "deadline_72h", detail: j }).catch(() => {}); return ok({ skipped: j.reason }); }

  const K = Number(await rpc("get_secret", { p_name: "quality_sample_k" }).catch(() => null)) || 1;
  const due = await rpc("quality_sample_candidates", { p_limit: 3 });   // SQL below
  const picked: typeof due = [];
  for (const row of due) if ((await hash32(row.proposal_id)) % K === 0) picked.push(row);

  for (const row of picked) {
    try { await judgeOne(row); }
    catch (e) {
      await ins("quality_samples", {
        proposal_id: row.proposal_id, delivered_at: row.delivered_at, verdict: "error",
        judge_model: MODEL_JUDGE, generator_model: MODEL, worker_version: WORKER_VERSION,
        position_pipeline: "A", reasons: [String(e).slice(0, 300)],
      }).catch(() => {});
    }
  }
  await rpc("evaluate_quality_gate").catch(() => {});
  return ok({ sampled: picked.length, considered: due.length });
}
```

`hash32` is `crypto.subtle.digest("SHA-256", …)` over the proposal id, first four bytes as a uint32 —
deterministic, so the same proposal is always in or out of the sample regardless of when the cron
fires.

### D.2.3 The comparator and the judge

```ts
async function judgeOne(row: { proposal_id: string; delivered_at: string }) {
  const c = await ctx(row.proposal_id);
  const analysis = c.out["analyze"] as Record<string, unknown>;
  const org = c.out["org"] as { profile?: unknown; evidence?: Array<Record<string, unknown>> } | undefined;
  const mine = finalNarrative(c.out);                       // :1006, the delivered text
  if (!mine || wordCount(mine) < 300) return;

  // --- the comparator: ONE call, no pipeline, exactly what the blind round compared against ---
  const baseline = await llm(
    `You are an experienced grant writer. Write the full proposal narrative for this applicant and this grant.\n\n` +
    `GRANT:\n${JSON.stringify(analysis).slice(0, 20_000)}\n\n` +
    `APPLICANT: ${c.order.org_name}\n${JSON.stringify(org?.profile ?? {}).slice(0, 4000)}\n\n` +
    `WHAT IS KNOWN ABOUT THE APPLICANT (the only permitted factual sources):\n${JSON.stringify((org?.evidence ?? []).filter((e) => e.allowed !== false)).slice(0, 12_000)}\n\n` +
    `Write about ${wordCount(mine)} words. Markdown headings. Nothing else.`,
    4000, { model: MODEL });

  // --- blind, position deterministic per proposal but not constant across the corpus ---
  const pipelineIsA = ((await hash32(row.proposal_id)) & 1) === 0;
  const A = pipelineIsA ? mine : baseline;
  const B = pipelineIsA ? baseline : mine;

  const verdictJson = jsonOf(await llm(
    `You are a senior grant assessor. Two draft proposal narratives for the same opportunity and the same applicant are below. ` +
    `One of them may be substantially better than the other; they may also be equivalent. Most proposals you see are mediocre — a strong verdict must be earned.\n` +
    `Judge ONLY what a donor's reviewer would see. You are told the word counts as facts; do not count anything yourself (A: ${wordCount(A)} words, B: ${wordCount(B)} words).\n\n` +
    `Answer these, then reply strict JSON only:\n` +
    `1. Which is more likely to have been written by a professional grant writer FOR THIS SPECIFIC ORGANISATION?\n` +
    `2. Which reads more machine-generated — uniform paragraph rhythm, tri-colon lists, abstract nouns doing the work of concrete ones, no authorial judgement anywhere?\n` +
    `3. For EACH of the following disqualifying conditions, say which drafts it applies to ("A", "B", "both", "neither"):\n` +
    REJECT_LIST.map((r, i) => `   ${i + 1}. ${r}`).join("\n") + `\n\n` +
    `{"better":"A"|"B"|"equivalent","machine":"A"|"B"|"both"|"neither","rejects":{"1":"A"|"B"|"both"|"neither",...},"reasons":[string,string,string]}\n\n` +
    `GRANT (for context only):\n${JSON.stringify(analysis).slice(0, 8000)}\n\nAPPLICANT: ${c.order.org_name}\n\n` +
    `--- DRAFT A ---\n${A.slice(0, 30_000)}\n\n--- DRAFT B ---\n${B.slice(0, 30_000)}`,
    2000, { model: MODEL_JUDGE, effort: "medium" }));

  const pick = String(verdictJson.better);
  const verdict = pick === "equivalent" ? "tie" : ((pick === "A") === pipelineIsA ? "win" : "loss");
  const machine = String(verdictJson.machine);

  await ins("quality_samples", {
    proposal_id: row.proposal_id, delivered_at: row.delivered_at,
    judge_model: MODEL_JUDGE, generator_model: MODEL, worker_version: WORKER_VERSION,
    position_pipeline: pipelineIsA ? "A" : "B", verdict,
    machine_verdict: machine === "both" || machine === "neither" ? machine
                    : ((machine === "A") === pipelineIsA ? "pipeline" : "baseline"),
    reasons: (verdictJson.reasons ?? []).slice(0, 3),
    reject_hits: rejectHitsForPipeline(verdictJson.rejects, pipelineIsA),   // ids that landed on OUR draft
    cost_usd: usageSnap().cost_usd,                                          // real, from Part B
  });
}
```

`REJECT_LIST` is the nine disqualifying conditions from `reports/quality-standard.md` §3, verbatim,
plus the two override rules. Item 6 ("Targets feel arbitrary. Round numbers with no derivation, or
targets the listed activities plainly cannot produce") and item 8 ("It reads obviously AI-generated")
are the two the 8/8 verdict turned on, and they are the two that make `reject_hits` a *diagnostic*
rather than just a score: a rising rate on item 6 says the register regressed, item 8 says the prose
did, item 3 says sustainability language went hollow. That is the attribution a bare win-rate cannot
give.

Per CLAUDE.md's own convention — two critics wrongly failed a 596-word document against a 600-word
limit — the judge is **never asked to count anything**. Word counts come from `wordCount()` (:555) and
are handed to it as facts.

## D.3 Gate on the rate, never on the instance

A single LLM judgement must not gate a paid order: it is too noisy, and per-proposal blocking trades a
quality problem for an availability problem — the same pathology as P0-2. The observed failure was
**8/8**, a distribution shift, and a rolling rate detects that shape precisely.

```sql
create table public.quality_samples (
  id               bigint generated always as identity primary key,
  proposal_id      uuid not null references public.order_proposals(id) on delete cascade,
  delivered_at     timestamptz not null,
  sampled_at       timestamptz not null default now(),
  judge_model      text not null,
  generator_model  text not null,
  worker_version   text not null,
  position_pipeline char(1) not null check (position_pipeline in ('A','B')),
  verdict          text not null check (verdict in ('win','loss','tie','error')),
  machine_verdict  text check (machine_verdict in ('pipeline','baseline','both','neither')),
  reasons          jsonb not null default '[]'::jsonb,
  reject_hits      jsonb not null default '[]'::jsonb,
  cost_usd         numeric(8,4),
  unique (proposal_id)
);
alter table public.quality_samples enable row level security;
revoke all on public.quality_samples from anon, authenticated;
create index quality_samples_recent on public.quality_samples (delivered_at desc) where verdict in ('win','loss');

create table public.quality_gate (
  id           boolean primary key default true check (id),
  hold         boolean not null default false,
  reason       text,
  tripped_at   timestamptz,
  cleared_at   timestamptz,
  notified_at  timestamptz,
  window_n     int      not null default 30,
  threshold    numeric  not null default 0.50,
  min_samples  int      not null default 20
);
insert into public.quality_gate (id) values (true) on conflict (id) do nothing;
alter table public.quality_gate enable row level security;
revoke all on public.quality_gate from anon, authenticated;

-- candidates: delivered, not yet sampled, delivered in the last 7 days.
create or replace function public.quality_sample_candidates(p_limit int default 3)
returns table (proposal_id uuid, delivered_at timestamptz)
language sql security definer set search_path = '' as $$
  select s.proposal_id, s.finished_at
  from public.job_stages s
  where s.key = 'deliver' and s.status = 'done'
    and s.finished_at > now() - interval '7 days'
    and not exists (select 1 from public.quality_samples q where q.proposal_id = s.proposal_id)
  order by s.finished_at desc
  limit p_limit;
$$;
revoke all on function public.quality_sample_candidates(int) from public, anon, authenticated;
grant execute on function public.quality_sample_candidates(int) to service_role;

-- Wilson score lower bound at 95%. Ties are EXCLUDED from the denominator rather than
-- counted as half a success: Wilson is a binomial interval and half-successes are not
-- binomial. Ties are still recorded, and a rising tie rate is itself informative.
create or replace function public.quality_winrate(p_n int default 30)
returns table (n int, wins int, rate numeric, lower95 numeric)
language sql stable security definer set search_path = '' as $$
  with w as (
    select verdict from public.quality_samples
    where verdict in ('win','loss')
    order by delivered_at desc
    limit p_n
  ), a as (
    select count(*)::int as n, count(*) filter (where verdict = 'win')::int as wins from w
  )
  select a.n, a.wins,
         case when a.n = 0 then null else a.wins::numeric / a.n end,
         case when a.n = 0 then null else
           ( (a.wins::numeric / a.n) + (1.96*1.96)/(2*a.n)
             - 1.96 * sqrt( ((a.wins::numeric/a.n) * (1 - a.wins::numeric/a.n) + (1.96*1.96)/(4*a.n)) / a.n ) )
           / (1 + (1.96*1.96)/a.n)
         end
  from a;
$$;
revoke all on function public.quality_winrate(int) from public, anon, authenticated;
grant execute on function public.quality_winrate(int) to service_role;

-- Trip, or clear, the hold. Idempotent; safe to call every sampling tick.
create or replace function public.evaluate_quality_gate()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g record; r record; v_reason text;
begin
  select * into g from public.quality_gate where id;
  select * into r from public.quality_winrate(g.window_n);

  if r.n >= g.min_samples and r.lower95 is not null and r.lower95 < g.threshold then
    if not g.hold then
      v_reason := format('blind win-rate vs single-prompt baseline: %s/%s = %s, Wilson 95%% lower bound %s < %s',
                         r.wins, r.n, round(r.rate, 3), round(r.lower95, 3), g.threshold);
      update public.quality_gate set hold = true, reason = v_reason, tripped_at = now(), cleared_at = null, notified_at = null where id;
      insert into public.escalations (kind, priority, detail)
      values ('quality_hold', 'deadline_72h',
              jsonb_build_object('reason', v_reason, 'n', r.n, 'wins', r.wins, 'rate', r.rate, 'lower95', r.lower95));
    end if;
  elsif g.hold and r.n >= g.min_samples and r.lower95 is not null and r.lower95 >= g.threshold then
    -- clearing is deliberately NOT automatic: an operator sets hold=false after a fix.
    update public.quality_gate set reason = coalesce(reason,'') || ' [recovered, awaiting operator clearance]' where id and cleared_at is null;
  end if;

  return jsonb_build_object('n', r.n, 'wins', r.wins, 'rate', r.rate, 'lower95', r.lower95,
                            'hold', (select hold from public.quality_gate where id));
end; $$;
revoke all on function public.evaluate_quality_gate() from public, anon, authenticated;
grant execute on function public.evaluate_quality_gate() to service_role;

alter table public.escalations drop constraint escalations_kind_check;
alter table public.escalations add constraint escalations_kind_check
  check (kind in ('stage_failed','stage_held','order_stalled','delivery_failed',
                  'quality_hold','quality_monitor_misconfigured','cost_accounting_unavailable','price_mismatch'));
```

**Where the hold bites.** Only at the very first stage of a proposal, so no work is wasted, no
exclusivity slot is burned (the `strategy` claim has not been taken yet), and **no in-flight order is
ever stranded**:

```sql
create or replace function public.quality_hold_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select hold from public.quality_gate where id), false);
$$;

-- claim_next_stage, unchanged except for ONE added predicate in the `runnable` CTE:
--       and not (s.key = 'analyze' and public.quality_hold_active())
```

A revision (`revise`) is appended mid-proposal and is not `analyze`, so revisions keep flowing while a
hold is on — a customer with a delivered proposal is never punished for a hold. New orders queue in
`paid`, the order page shows them as queued, and the operator has an escalation row plus a Resend
email through the existing `sendEmail` path (:1039-1050). Customers are never asked to judge anything
and no human is inserted into the customer workflow: the only human involved is the operator, who is
notified **because the system halted itself**.

## D.4 Cost per order, and where it is spent

Two model calls per **sampled** order, both in a `quality_sample` invocation of the worker, both after
delivery:

| call | model | input tokens | output tokens |
|---|---|---|---|
| comparator | `MODEL` | ~12k (grant intelligence + org profile + evidence ledger) | ~3.5k |
| judge | `MODEL_JUDGE` | ~9k (two narratives + grant context + reject list) | ~0.7k |

`cost_usd` is **measured**, not estimated — Part B gives us OpenRouter's own number per call, and it
is written to `quality_samples.cost_usd`. As an order-of-magnitude at flash-class input pricing and
mid-tier judge pricing, this lands around **$0.10–$0.15 per sampled order**, i.e. **~0.1% of a $149
Draft** and less on the higher tiers. Sampling is `hash32(proposal_id) % K === 0` with `K` in Vault
(`quality_sample_k`): **K = 1 at launch volume** — every order sampled, because at launch volume the
statistics matter more than the pennies and 30 samples is a month of orders, not a day. Raise K as
volume grows; the window is defined in samples, not in time, so raising K lengthens the detection
window rather than degrading it. A spend guard is trivial to add from the same table:

```sql
select coalesce(sum(cost_usd), 0) from public.quality_samples where sampled_at > now() - interval '24 hours';
```

and the sampler refuses to spend beyond a Vault-configured daily cap.

The second cron job, in the same migration:

```sql
select cron.schedule(
  'ktebli-quality-sample',
  '17 * * * *',                       -- hourly, offset off the minute the worker tick uses
  $$
  select net.http_post(
    url := s.u,
    headers := jsonb_build_object('Content-Type','application/json','x-worker-secret', public.get_secret('worker_secret')),
    body := '{"mode":"quality_sample"}'::jsonb,
    timeout_milliseconds := 5000
  )
  from (select public.get_secret('worker_url') as u) s
  where s.u is not null and s.u <> '';
  $$
);
```

This follows the Vault-sourced pattern established by `20260820145930_secrets_grants_and_cron.sql`
precisely so replaying the history into a branch or scratch project cannot tick against production.

## D.5 Two complements, both nearly free

**Revealed preference — `revision_requests` is collected and never read.**

```sql
create or replace view public.quality_revealed
with (security_invoker = true) as
select date_trunc('week', p.created_at) as week,
       count(distinct p.id)                                   as delivered,
       count(distinct r.proposal_id)                          as revised,
       count(distinct r.proposal_id)::numeric
         / nullif(count(distinct p.id), 0)                    as revision_rate,
       avg(extract(epoch from (r.created_at - p.created_at))/3600) as hours_to_first_revision,
       jsonb_agg(distinct opt) filter (where opt is not null)  as options_seen
from public.order_proposals p
left join public.revision_requests r on r.proposal_id = p.id
left join lateral unnest(r.options) as opt on true
where p.status = 'complete'
group by 1;
```

Zero model calls. A rising share of tone/rewrite options is a genuine quality signal and it is the
only one that comes from the customer.

**Repair pressure — currently discarded.** `generateValidated` (:625-673) finds violations on
attempts 1 and 2 and drops them unless attempt 3 also fails. Change its return type to
`{ text: string; attempts: number; violations_by_attempt: string[][] }` and persist that in each
`gen:*` stage output. A drifting model needs more repair rounds *before* the drift is visible in
output quality. Not ground truth — a leading tripwire, and free.

**Attribution is the prerequisite for all three.** Without Part B.4's
`{worker_version, model, model_strategy}` on every stage row and on every `quality_samples` row, a
win-rate drop cannot be attributed to a deploy, a silent model version change on OpenRouter's side, or
a shift in the incoming grant mix — and the monitor would tell you something broke without telling you
what.

## D.6 Test plan for Part D

The gate is a measurement instrument, so it is calibrated before it is trusted.

1. **Judge calibration against known labels.** Assemble ~20 (grant, applicant, narrative) triples: 10
   pipeline outputs the blind round already rated and 10 single-prompt comparators. Run the judge
   harness and require agreement with the recorded blind verdicts above a stated threshold. **A judge
   that cannot reproduce the finding that motivated it is not fit to gate on**, and this test is what
   establishes the threshold in `quality_gate.threshold` empirically rather than by assertion.
2. **Position-bias test — mandatory, CI-blocking.** Re-run every pair with A and B swapped. If the
   judge picks position A more than 60% of the time across the corpus, it is unusable and CI fails.
   This is the single most common way an LLM-judge gate silently becomes a coin flip, and the
   `position_pipeline` column exists so the bias can be re-measured on live data at any time:
   `select position_pipeline, verdict, count(*) from quality_samples group by 1,2`.
3. **Family-independence unit test.** `judgeUsable()` must return `{ok:false}` when `MODEL_JUDGE`
   shares a provider prefix with `MODEL` or `MODEL_STRATEGY`, including the default case where
   `MODEL_STRATEGY` falls back to `MODEL` at :1958.
4. **Synthetic drift test.** Feed `quality_winrate` a stream of verdicts that flips from 70% win to
   20% win at index 40, and assert `evaluate_quality_gate` trips within a bounded number of
   deliveries. Then, in the other direction, assert a stream held at 65% **never** trips across 500
   samples. False-alarm rate matters as much as sensitivity: a monitor that cries wolf gets disabled,
   and a disabled monitor is worse than none.
5. **Wilson unit tests** at n = 5, 20, 30, 100 against hand-computed values, plus the `n = 0` and
   `n < min_samples` null paths.
6. **Never-blocks-delivery test.** Assert `runQualitySample` touches no row in `job_stages` (mock the
   REST layer and fail the test on any write to that path), and that a thrown judge error produces a
   `verdict='error'` row and nothing else. Assert `quality_sample_candidates` only ever returns
   proposals whose `deliver` stage is already `done`.
7. **Hold-path integration test, replay harness or a staging project only — never
   `uocauqflcqefgdixbzpf`.** Set `hold = true`; assert `claim_next_stage` returns no `analyze` row;
   assert it still returns `gen:*` and `revise` rows for proposals already under way; assert the
   operator escalation is written exactly once and not once per tick (`notified_at`); assert
   already-running stages finish rather than being orphaned.
8. **Determinism test.** `hash32(proposal_id) % K` and the A/B parity must be stable across
   invocations for the same id, so a re-run cannot flip a proposal in or out of the sample or swap
   its position.
9. **Cost-cap test.** With the 24h spend already over the configured cap, `runQualitySample` must
   sample nothing and return `{skipped:"daily_cap"}`.

No human sits in the customer workflow at any point: comparator, judge, rollup, hold and operator
email are all automatic.

---

# PART E — ONE MIGRATION, ORDER OF WORK, AND WHAT COULD GO WRONG

## E.1 The migration

`supabase/migrations/20260826170000_numeric_register_costs_currency_drift.sql`, applied after
`…160000_resumable_stages.sql`. It contains, in this order:

1. `orders.country`, `orders.currency` + their CHECK constraints (Part C.5).
2. `stage_costs` and `order_costs` views, `security_invoker = true`, revoked from anon/authenticated
   (Part B.5).
3. `quality_samples`, `quality_gate`, RLS enabled, revoked (Part D.3).
4. `quality_sample_candidates()`, `quality_winrate()`, `evaluate_quality_gate()`,
   `quality_hold_active()` — all `security definer set search_path = ''`, revoked from public, granted
   to `service_role`, following the pattern of every function in
   `20260820145930_secrets_grants_and_cron.sql`.
5. The `escalations_kind_check` widening (three new kinds).
6. `create or replace function public.claim_next_stage(int)` — byte-identical to the version in
   `20260820145739_orders_and_job_queue.sql:78-109` **plus one line**:
   `and not (s.key = 'analyze' and public.quality_hold_active())`.
7. `quality_revealed` view (Part D.5).
8. `cron.schedule('ktebli-quality-sample', …)` reading `worker_url` from Vault (Part D.4).

Part A needs **no** DDL: the register lives in `job_stages.output` jsonb.

## E.2 Edit collisions with the sibling tracks — read before applying

* **`done()` at :1179-1180** is rewritten by both this design (B.4: `usage` + `meta`) and
  `design-resumability-and-alerts.md` (`progress: null`). Apply once, merged.
* **`claim_next_stage`** — the resumability design states it does not modify the function. This design
  does, by one predicate. If both land, this migration must be the later one and must be written
  against whatever body is current at that point, not against the `…145739` original.
* **`GENERATOR_VERSION` (:45)** is read at :1878. Renaming it to `WORKER_VERSION` touches both sites.
* **`ctx()` at :1173** must add `error` to its `job_stages` select list for the informed-retry in A.6.
* The seven non-worker functions are **transcribed, not byte-verified** (CLAUDE.md). Part C.5 touches
  `save-intake` and `stripe-webhook`: re-pull each with `supabase functions download <slug>` and treat
  that as the base before editing.
* Deploy discipline is unchanged: CLI upload from disk, then diff the deployed bytes against local
  source. The v25 over-escaping incident is exactly the class of failure that a register full of
  template literals and a judge prompt full of quotes would reproduce.

## E.3 Order of work

1. **B** first. It is 8 lines plus a `done()` rewrite, it has a test that fails before and passes
   after, and every later part wants `cost_usd` and `meta.worker_version` to exist. Ship it alone.
2. **C** second. `resolveCurrency` is pure, table-driven, and Part A's `resolveRegister` takes the
   currency code as a parameter — the register cannot be built without it.
3. **A** third, in two deploys: `resolveRegister` + the design schema first (which alone kills
   200-vs-216 at the cheapest point in the pipeline), then `registerConformance` replacing
   `consistencyFindings` once the false-positive corpus is green.
4. **D** last, and behind its own calibration gate: land `quality_samples` and the sampler with
   `quality_gate.hold` unreachable (`min_samples` set very high) until tests D.6.1 and D.6.2 pass on
   real data, then lower `min_samples` to 20.

## E.4 Residual risks, stated

* **Numbers written as words.** "two hundred young people" defeats the extractor. Mitigation: the
  register prompt rules require digits, and a warning-level scan for spelled-out numerals in count
  contexts. Not solved, and it should be measured by the `matched/scanned` ratio in test A.11.4 rather
  than assumed away.
* **Conformance false positives strand orders.** Bounded by test A.11.4 as a release gate, and by the
  unit/no-unit severity split. If the corpus cannot go green, the blocking threshold moves to
  money-and-count-only before the change ships — never after a customer is stranded.
* **The judge drifts.** A judge model is itself a model. Position bias is re-measurable on live data
  from `position_pipeline`, and `judge_model` is recorded on every row so a judge change is visible as
  a discontinuity rather than mistaken for a quality change.
* **The gate holds new orders on a false alarm.** `min_samples = 20` and a Wilson *lower* bound (not
  the point estimate) are what make that unlikely; test D.6.4's 65%-never-trips assertion is what
  proves it. Clearing is deliberately manual, because a gate that clears itself is a gate that
  oscillates.
