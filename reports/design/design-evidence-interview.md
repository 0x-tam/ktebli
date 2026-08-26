# Design: the Automated Evidence Interview

Target of the fix: the single most-repeated blind-critic finding — *"no messy local nouns: no place
names, vendors, staff CVs, or prior results"*.

Grounded on working-tree code. Line numbers: `supabase/functions/worker/index.ts` (1995 lines),
`index.html` (wizard), `supabase/functions/save-intake/index.ts`,
`supabase/functions/stripe-webhook/index.ts`, `supabase/functions/analyze-grant/index.ts`.
Prior finding of record: `qloop/design/ground-evidence.md` (E-INTAKE construction is at **1274–1276**).

---

## 0. What this document commits to, in one paragraph

Two required questions and up to eight optional ones, asked before payment inside the existing
wizard, rendered from a **fixed typed schema** whose **wording and selection are generated per grant
and per applicant**. Every answer is turned into one or more `E-ASK-n` Evidence Ledger items **by
code, not by a model**, each carrying provenance, an assertion class, and a verification level that
is deterministically upgraded when the crawl independently corroborates it. Zero additional model
calls inside the worker. No human anywhere. A customer who answers only the two required questions —
including answering them with "we have not done this yet" — still gets a proposal, and that proposal
*says out loud* what it could not evidence rather than writing more confidently to cover the hole.

---

## 1. Why this is the right lever (the evidence for the diagnosis)

The ceiling is structural, not stylistic. Today's ledger for a typical customer:

| Source | Items | Real-world proper nouns |
|---|---|---|
| `E-INTAKE-1..3` (1274–1276) | ≤3 | **1** — the applicant's own name (E-INTAKE-3 is the same name as a URL; E-INTAKE-2 is a token string) |
| `E-WEB-n` (1322–1327) | 0–8 | 3–5 at best, 0 whenever the identity gate fires (1341–1360), the crawl is empty (1332), or no website was given |
| `E-PROP-n` (1400–1405) | usually 0 | the `.pdf`/`.doc` path never extracts text (`upload-intake-file:87–90`), so the normal case yields nothing |

Four separate code facts make the critics' complaint unfixable by prompting:

1. **`directions` is not evidence.** It is appended to every generation prompt at **1209**, but the
   Claim Ledger auditor receives only `allowedEvidence` (**1674**). So an operational fact typed into
   that box is visible to the writer, invisible to the auditor, classified `unsupported`, counted in
   `blocking` (**1703**), and explicitly stripped by the correction prompt (**1723–1737**: *"a weak
   section may NEVER be strengthened by adding organisational history … not in the evidence ledger"*).
   The one box where a customer could volunteer a proper noun is engineered to remove it.
2. **The crawl cannot carry a person or a venue.** The website extraction schema (**1310**) routes
   staff into `profile.team_notes`, a single string, with no path into `evidence`. PDFs are excluded
   twice (**241**, `ssrf.ts:85`), so annual reports and trustee lists are unreachable. `stripHtml`
   (`ssrf.ts:142–150`) flattens tables and lists, and the `p.length > 40` filter (**253–254**) then
   deletes exactly the short, proper-noun-dense shapes — "Founded 2011", a five-borough list, a staff
   table row.
3. **The ledger item has no slots.** `claim` is one untyped English sentence (1274, 1322, 1400).
   Nothing downstream can ask "what is the venue" because no field holds one, and no deterministic
   check can be written against a fact that only exists as prose.
4. **The empty-ledger branch is the swappable-prose generator.** At **1207** the prompt instructs the
   model to be credible *without any past-track-record claims*. That branch runs for every customer
   with no site, an empty crawl, or a rejected site — and it is the branch the critics read.

The grounding rule is working correctly. It is guarding an almost empty vault. Filling the vault is
therefore the fix; loosening the rule is the thing that must never happen.

---

## 2. Fixed, generated, or hybrid — the argument

**Recommendation: hybrid, split along a specific seam. The *schema* is fixed. The *selection and
wording* are generated.**

Pure-fixed fails on the thing that matters most for a pre-payment form: recognition. A generic
"describe a past project" is a chore. "Your site mentions the Growing Together allotment — where is
it, and when did it start?" is a question the customer can answer in eight seconds and which signals
that something already read their website. Fixed questions also cannot ask the donor's own
mandatory conditions back at the applicant, which is where late `donor_required_certification`
churn comes from (**1666–1683**).

Pure-generated fails on everything downstream. A model-invented field name cannot be validated in
`save-intake`, cannot be mapped to `design.partnerships[].status` (**1547**), cannot be
arithmetic-checked, cannot be golden-tested, and cannot be given a stable provenance string. It also
puts a model call on the critical path of a pre-payment form, where a timeout or a parse failure
(the `analyze-grant` failure modes at `analyze-grant:88–94`) becomes a blank step.

So: **eleven fixed slots** with fixed field types, validation and ledger mapping. A generated *plan*
chooses which ≤8 to show, rewrites each label using the applicant's own nouns and the donor's own
asks, and may add 0–2 eligibility probes drawn strictly from the grant's own mandatory requirements.
If the plan does not arrive, the fixed spine renders and nothing is lost. The generated layer can
only make questions *better phrased*; it can never make a field the ledger renderer does not know.

### Where the plan comes from — and why it does not add a ninth edge function

The crawl the brief assumes is available pre-payment **is not**: `crawlSite` runs inside the `org`
stage after payment. Two consequences:

- The plan call gets a **micro-crawl of its own**: homepage + the top-scoring `about`/`programme`
  page only, 3 fetches, existing `safeFetchText` budgets. Its output is used **solely to phrase
  questions and is never written to any ledger**. The authoritative crawl, the identity gate
  (**447–460**) and the asymmetric discard (**1341–1360**) are untouched. A wrong-organisation site
  can therefore only produce a question the customer ignores — never a borrowed fact. This is the
  property that lets us personalise safely.
- The plan is generated by **extending `analyze-grant`** with `mode:"interview"`, not by adding a
  function. Same file, same rate limiter (`analyze-grant:31`), same CORS, same `get_secret` path,
  same `verify_jwt=false` stanza. **Function count stays at eight; `config.toml` is unchanged.**

Plans are cached in a new table keyed by grant fingerprint (§5), so the second customer on the same
grant gets the plan with no model call and no latency.

---

## 3. The question set

Ranked by *(reject-list damage repaired) ÷ (conversion cost)*. Reject list abbreviations:
**PN** absence of proper nouns · **AT** arbitrary targets · **PP** pseudo-precise figures with no
derivation · **AC** arithmetic that does not close · **SW** swappable paragraphs.

"Required" throughout means **you must tell us something, including "nothing"**. Every required slot
has a typed escape. That is what makes the degradation in §7 honest instead of silent, and it costs
almost no conversion because there is always a valid answer.

---

### Q1 · `sites` — REQUIRED — repeater, 1–3 rows

> **Where does this actually happen?**
> *The building, the neighbourhood, the town — whatever a person there would name.*

| Field | Type | Req |
|---|---|---|
| `place` | text 80 | ✔ |
| `venue` | text 80 | — |
| `what_happens` | text 120 | ✔ |
| `since` | month-year picker, or "not started yet" | ✔ |

Escape: checkbox **"We don't have a fixed location yet"** → `{no_fixed_site: true}`.
Generated variant: *"Your site mentions {programme}. Where does it run?"*

**Ledger:** one `E-ASK` per row, `assertion_class: self_description`,
`facets:{place, venue, activity, since}`. `since:"not_started"` → `status: asserted_planned`.
**Fixes: PN, SW.** The cheapest proper noun in existence and the most damaging absence. A named
venue in a named neighbourhood is the single thing that cannot be swapped between two applicants.

**Why required:** a proposal with zero place names is the exact document the critics rejected. This
is the one question whose absence is not survivable, so we ask it and accept the honest "no fixed
site" answer as evidence in its own right — it changes the delivery model the design stage proposes.

---

### Q2 · `last_delivery` — REQUIRED — single card + escape

> **The last thing you finished — what was it, and how did it end?**
> *Even a small one. Rough numbers are fine; we would rather have a real rough number than a
> confident invented one.*

| Field | Type | Req |
|---|---|---|
| `what` | text 140 | ✔ |
| `when` | year or period | ✔ |
| `how_many_started` | integer | — |
| `how_many_finished` | integer | — |
| `how_counted` | select: register / sign-in sheet / case notes / a partner's data / our own estimate | — |
| `result` | text 200 | — |

Escape: checkbox **"We haven't delivered a project like this yet"** → `{no_prior_delivery: true}`.

**Ledger:** `assertion_class: performance_claim`, `basis = how_counted` verbatim,
`status: asserted_historical`, `time_sensitive: true`.
**Fixes: PN, AT, PP, AC.** This is the highest-yield question in the set, because it is the only one
that repairs three reject items at once. A real prior denominator ("51 enrolled, 34 finished, from
our registers, 2025") gives the design stage (**1532–1560**) something to derive a target *from*,
which is precisely what disqualifier 6 of `reports/quality-standard.md` ("targets feel arbitrary")
punishes. Without it every numeric target in every proposal is `model_proposed_target` — a round
number with a rationalisation attached.

---

### Q3 · `people` — optional — repeater, 1–2 rows

> **Who will actually run this, and what have they done before?**
> *A name and one line is plenty.*

| Field | Type |
|---|---|
| `name` | text 80 |
| `role` | text 80 |
| `background` | text 200 |
| `basis` | select: paid staff / volunteer / trustee / to be recruited |
| `already_in_post` | boolean |

**Ledger:** `assertion_class: self_description`; `already_in_post:false` **or** `basis:"to be
recruited"` forces `status: asserted_planned` — the person becomes a design element and may never be
cited as track record. Only a typed boolean can carry that distinction.
**Fixes: PN (staff CVs — a category with *no* representation in today's schema), SW.**

---

### Q4 · `partners` — optional — repeater, 1–3 rows

> **Anyone else involved — who, doing what, and how firm is it?**

| Field | Type |
|---|---|
| `partner_name` | text 100 |
| `what_they_do` | text 160 |
| `status` | select: **agreed in writing / verbally agreed / in discussion / we intend to approach them** |

**Ledger:** `assertion_class: third_party_commitment`; `status` maps directly onto
`design.project.partnerships[].status` at **1547** (`"agreed in writing"` → `evidence_based`,
everything else → `designed`).
**Fixes: PN, SW.** Named partners are the highest-value and highest-risk colour available. The
status field is not decoration: it is the mechanism that stops a hoped-for partner becoming an
asserted one, and it is unobtainable from free text.

---

### Q5 · `unit_costs` — optional — repeater, 1–3 rows

> **Three things you actually pay for, and what they cost you.**
> *A room, a session, a person for a day, a minibus. Real prices you have paid.*

| Field | Type |
|---|---|
| `item` | text 100 |
| `amount` | numeric |
| `currency` | select, **defaulted from the grant's stated geography** |
| `per` | select: session / day / month / person / year / one-off |

**Ledger:** `assertion_class: self_description`, `facets.amount` enters `evidenceNums` (see
**1650–1655**).
**Fixes: PP, AC.** Today every budget line is model-designed and the `gen:budget` brief itself
concedes it (*"Unit costs are PLANNING ESTIMATES"*). Three real prices anchor the rest and let a
deterministic check assert that the anchored lines actually appear at the stated price. The currency
select also closes P2 #10 (USD default regardless of country) at zero extra cost.

---

### Q6 · `finances` — optional — single card

> **Last year's income, and the biggest grant you have managed.**
> *Donors ask; it is better coming from you than left blank.*

Fields: `annual_income` (numeric + currency), `year`, `largest_grant` (numeric + currency),
`largest_grant_funder` (text 100).

**Ledger:** `assertion_class: performance_claim`, `basis: "the organisation's own accounts"`.
**Fixes: PP, and feasibility (quality standard dimension 6 / disqualifier 7).** A named prior funder
is a proper noun; a real ceiling on money handled stops the design stage proposing a budget the
applicant has no history of managing.
**Highest sensitivity in the set.** First of the "keep" group to cut (§8).

---

### Q7 · `reach` — optional — single card

> **Who do you work with, how many in a year, and how do you know that number?**

Fields: `who` (text 140), `per_year` (integer), `basis` (same select as Q2).

**Ledger:** `assertion_class: performance_claim`, `basis` verbatim.
**Fixes: PP.** The `basis` field is the entire point. A number with a basis can be stated plainly; a
number without one is written as the organisation's own figure and may never be totalled,
annualised or extrapolated (§4.3). That rule is only expressible because `basis` is a field.

---

### Q8 · `local_trigger` — optional — one line, 240 chars

> **What happened locally that made you go after this grant?**
> *The waiting list, the closure, the referral you had to turn down.*

**Ledger:** `assertion_class: self_description`, `facets.trigger`.
**Fixes: SW.** One line, near-zero conversion cost, and it is the only input that can particularise
a problem statement and an opening. The strategy stage's opening-device exclusivity (five partial
unique indexes on `claims`) is currently choosing between eight abstract devices with nothing
concrete to point them at.

---

### Q9 · `limits` — optional — single card

> **What would be genuinely new for you here?**

Multi-select (*a bigger budget than before · a new location · a new group of people · a method we
have not used · nothing much, this is our normal work*) + one optional line.

**Ledger:** `assertion_class: self_description`, `status: asserted_planned`.
**Fixes:** none on the reject list directly — it serves the quality standard's overriding rule
(*"Honesty about limits beats polish … a proposal that says so plainly and proposes a partnership
scores higher"*). It gives the generator licence to be honest with specificity instead of hedging
with vagueness.

---

### Q10 · `named_things` — optional, generated slot only

> **Do you use anything by name — a curriculum, an accreditation, a piece of equipment, a system?**

Repeater ×2: `name` (text 80), `what_for` (text 120).
**Ledger:** `assertion_class: self_description`. **Fixes: PN.**
Shown only when the plan judges it relevant (training, accreditation, clinical or technical grants).

---

### Q0 · `eligibility_probe` — generated, 0–2, shown first when present

> **The donor requires {X}. Do you have it?**
> Yes / No / Not sure — plus an optional date field.

Emitted only from a `requirements[]` row (schema at **1233**) that is `mandatory:true` and is the
kind of administrative fact an applicant self-certifies. Bounded by the same narrow definition the
auditor already uses for `donor_required_certification` (**1670–1671**).
**Ledger:** `assertion_class: self_description`, `status: asserted`, `facets.donor_requirement_ref`.
**Fixes:** not a reject-list item — it prevents a *late* blocking failure. A "No" here is worth more
than a "Yes": it is caught before payment and the proposal is written around the gap rather than
deadlocking the correction loop at **1710–1719**.

---

### Shown-set rule

At most **8 cards** on the step, always including Q1 and Q2, and Q0 first when present. Plan
ordering otherwise; the fixed spine order is Q1, Q2, Q3, Q4, Q5, Q8, Q7, Q9.

---

## 4. The ledger item schema

### 4.1 Shape

`E-ASK-n` — a new prefix alongside the existing `E-INTAKE-n` / `E-WEB-n` / `E-PROP-n`. `E-INTAKE-1..3`
stay exactly as they are: they are identity, they are genuinely verified, and the identity gate
depends on them.

```jsonc
{
  "id": "E-ASK-4",
  "claim": "Delivers a weekly lunch club at St Anne's Hall, Peckham, London, since March 2019.",
  "source_type": "applicant_statement",
  "source_ref": "intake interview · slot sites · row 1 · asked \"Where does this actually happen?\"",
  "status": "asserted",              // asserted | asserted_historical | asserted_planned
  "assertion": true,                 // NEW — the customer said so; nobody verified it
  "assertion_class": "self_description",   // | performance_claim | third_party_commitment
  "verification": "customer_asserted",     // | site_corroborated | document_corroborated
  "basis": null,                     // the customer's own counting basis, verbatim, or null
  "facets": {                        // NEW — the typed payload; this is the whole point
    "place": "Peckham, London",
    "venue": "St Anne's Hall",
    "activity": "weekly lunch club",
    "since": "2019-03"
  },
  "date_context": "since March 2019",
  "time_sensitive": true,
  "allowed": true
}
```

**Back-compatibility is deliberate.** `claim` remains one rendered English sentence, so every
existing consumer — the flat `JSON.stringify(allowedEvidence)` at **1197–1207**, the auditor input
at **1674**, the `evidenceNums` scan at **1650–1655** — keeps working with no change. `facets`,
`assertion`, `assertion_class`, `verification` and `basis` are purely additive.

`claim` is rendered **by code** from `facets` using a per-slot template. No model turns a customer's
answer into a ledger sentence. This is what makes the whole thing testable, and it removes the
opportunity for a model to decide what a customer's words "count as".

Caps, matching the existing `E-WEB` conventions (**1324**): `claim` ≤ 300 chars, ≤ **24** `E-ASK`
items per order, each `facets` string field capped at its form length. 24 items × ~300 chars ≈ 7.5 kB
of prompt growth — negligible against the 28 kB narrative slices already in use.

### 4.2 Assertion vs verified — the distinction, and how the Claim Ledger uses it

Three orthogonal fields carry it, and each one does work:

- **`assertion: true`** — a hard flag. Every `E-ASK` item has it; no `E-WEB` or `E-INTAKE` item does.
  Trivially greppable, trivially testable, and the thing a future auditor prompt keys on.
- **`assertion_class`** — *what kind of trust the claim asks for.* This is the field that determines
  permitted prose, because grant proposals legitimately self-assert routine facts (every proposal
  ever written says where the applicant works, unattributed) while performance claims and
  third-party commitments are the ones donors audit and overclaiming punishes.
- **`verification`** — *whether anything independent agrees.* Upgraded **deterministically, in code,
  with no model call**: after the `org` stage builds `webEvidence`, any `E-ASK` item whose distinctive
  `facets` token (place, venue, partner_name, named thing) appears in an `E-WEB` claim string is
  promoted to `site_corroborated`; the same match against `E-PROP` text gives
  `document_corroborated`. Cheap, testable, and it converts the applicant's own website from a
  fact source into a *corroboration* source — which is what a website is actually good for.

### 4.3 Prose rules, computed by code, appended to `EVIDENCE_NOTE`

The generator does not decide these. `interviewToLedger` returns them alongside the items and they
are concatenated into the existing note at **1199–1202**:

| assertion_class | condition | permitted prose |
|---|---|---|
| `self_description` | any | state plainly |
| `performance_claim` | `basis` present | state with the basis in the same sentence ("34 of the 51 enrolled completed, from the programme's own registers") |
| `performance_claim` | `basis` null | state as the organisation's own figure; **never** total, annualise or extrapolate it |
| `third_party_commitment` | `status = agreed in writing` | may be stated as agreed |
| `third_party_commitment` | anything weaker | must carry the customer's own status word; `partnerships[].status = "designed"` |
| *any* | `status = asserted_planned` | future design only — **never** track record |
| *any* | `verification = site_corroborated` | may be stated without hedging |

### 4.4 Two new auditor classifications — and the correction instruction that must change with them

The auditor prompt (**1666–1683**) gains the `E-ASK` semantics and two classifications, both
blocking alongside `unsupported`/`stale`/`conflicting` at **1703**:

- **`asserted_overreach`** — a `performance_claim` stated beyond its basis, or a
  `third_party_commitment` stated more firmly than its status field.
- **`asserted_as_history`** — an `asserted_planned` item used as a past or present fact.

**The correction instruction for these two must be "restate it correctly", not "remove it".** The
existing fix list at **1723–1737** knows only how to delete (*"remove it, qualify it honestly, or
recast it"*) and is followed by an absolute rule against adding organisational history. Applied
unchanged to `E-ASK` findings, the first correction round would strip the interview's entire yield
and hand back exactly the generic document we started with. This is the single most important
integration detail in this document.

Existing classifications are unchanged, and a correctly-used `E-ASK` item simply reads as
`supported` — which is right: the ledger *does* cover it.

### 4.5 Two related leaks worth closing in the same change

- **`org.profile` is visible to the writer (1206) and invisible to the auditor (1674).** Adding more
  writer-visible material makes this worse. The auditor's input should include `profile`.
- **The `E-PROP` merge is fire-and-forget** — `.catch(()=>{})` at **1409–1412** silently loses every
  uploaded-proposal item. The same patch will now also carry corroboration upgrades, so a silent
  failure becomes more expensive. It needs to fail loudly.

### 4.6 The interview survives the identity gate

`evidence = [...intakeEvidence, ...webEvidence]` (**1410**); the gate at **1341–1360** empties
`webEvidence`, `profile` and `voiceGuide` and nothing else. `E-ASK` items are built from the order,
not the site, so they survive intact. **This converts an identity-gate rejection from catastrophic
(ledger drops to 3 items, empty-ledger branch fires) to merely costly (ledger drops from ~22 to ~20,
losing only the corroboration layer).** It is the strongest argument for the interview that is not
about prose quality at all: it makes the most defensible safety mechanism in the system affordable.

---

## 5. Why typed fields beat one more free-text box

The brief asks for this explicitly. Six reasons, each anchored in code:

1. **A box is not a ledger item, and a second box would not be either.** `directions` goes to the
   writer at **1209** and never to the auditor at **1674**; anything drawn from it is classified
   `unsupported`, counted in `blocking` (**1703**), and stripped by the correction prompt
   (**1723–1737**). To make a box's contents usable, they must become ledger items with provenance —
   which means parsing it into fields anyway. Typed fields skip the lossy round trip.
2. **Provenance granularity.** A box yields one blob with one provenance. Typed rows yield one item
   per fact, each with its own `status`, `date_context`, `basis` and `assertion_class`. The auditor
   matches claims to *items*; a blob is a single item that either covers everything or nothing.
3. **Downstream slots exist and are empty.** `design.project.partnerships[].status` is literally
   `"designed" | "evidence_based"` (**1547**); `indicators[].baseline` is a string field (**1549**).
   Only a typed answer can fill them deterministically. Free text cannot be routed to a schema slot.
4. **Deterministic checks need fields.** `facets` numbers feed `evidenceNums` (**1650–1655**), which
   is what stops `consistencyFindings` flagging a customer-supplied figure as a design mismatch; and
   Q5's unit costs enable a real arithmetic check against the budget. You cannot reliably extract a
   unit cost from prose — and the standing convention that *language models cannot count* means you
   must not try.
5. **Injection surface and interpretation.** A box is wrapped in `<untrusted_source>` (**54–55**) and
   the model decides what it means. Typed fields are validated and length-capped in `save-intake` and
   rendered into `claim` strings by code, so the model never adjudicates a customer sentence.
6. **You cannot detect the absence of a fact in a blob.** Honest degradation (§7) and the gap list
   (**1414–1418**) both depend on knowing *which* facts are missing. A box is present or absent; it
   cannot tell you it is missing a unit cost.

The `directions` box stays, unchanged, doing its actual job — tone and emphasis. It just stops being
the only place a proper noun could go.

---

## 6. DDL

Three migrations' worth of change, in one file. Additive, `if not exists` throughout, no rewrite of
any existing column. Follows the existing `pre_intakes` migration's RLS posture.

```sql
-- ============================================================================
-- Evidence Interview: typed pre-payment answers + cached generated question plans
-- ============================================================================

-- 1. pre_intakes: carry the interview, and stop dropping two fields the wizard
--    already sends. save-intake:26-35 is a closed row literal that never reads
--    b.name or b.whatsapp, yet index.html:758 shows the customer "Contact:
--    name · email" as though both were captured.
alter table public.pre_intakes
  add column if not exists contact_name  text,
  add column if not exists whatsapp      text,
  add column if not exists interview     jsonb       not null default '{}'::jsonb,
  add column if not exists plan_id       uuid,
  add column if not exists step_reached  smallint    not null default 0,
  add column if not exists updated_at    timestamptz not null default now();

alter table public.pre_intakes
  add constraint pre_intakes_interview_is_object
    check (jsonb_typeof(interview) = 'object'),
  add constraint pre_intakes_interview_size
    check (pg_column_size(interview) < 65536),
  add constraint pre_intakes_step_reached_range
    check (step_reached between 0 and 5);

-- Funnel measurement (see §8). Today nothing is persisted until the pay click
-- (index.html pay(), ~783), so wizard abandonment is unmeasurable. With
-- step-advance upserts this index answers "where do people stop".
create index if not exists pre_intakes_step_idx
  on public.pre_intakes (step_reached, created_at desc);


-- 2. Cached generated question plans, keyed by grant fingerprint.
--    The second customer on the same grant pays no model call and no latency.
create table if not exists public.intake_question_plans (
  id              uuid        primary key default gen_random_uuid(),
  grant_key       text        not null,   -- sha256 of normalised issuer+title, or of pasted text
  spine_version   smallint    not null,   -- bump to invalidate every cached plan at once
  plan            jsonb       not null,
  model           text,
  org_hint_domain text,                   -- phrasing hint only; NEVER a source of evidence
  created_at      timestamptz not null default now(),
  constraint intake_question_plans_plan_is_array check (jsonb_typeof(plan) = 'array'),
  constraint intake_question_plans_plan_size     check (pg_column_size(plan) < 32768)
);

create unique index if not exists intake_question_plans_key_idx
  on public.intake_question_plans (grant_key, spine_version);

alter table public.intake_question_plans enable row level security;
revoke all on public.intake_question_plans from anon, authenticated;


-- 3. orders: the worker reads the interview from here.
alter table public.orders
  add column if not exists contact_name   text,
  add column if not exists interview      jsonb not null default '{}'::jsonb,
  add column if not exists interview_plan jsonb not null default '[]'::jsonb;

alter table public.orders
  add constraint orders_interview_is_object    check (jsonb_typeof(interview) = 'object'),
  add constraint orders_interview_plan_is_array check (jsonb_typeof(interview_plan) = 'array');
```

**Why `jsonb` and not a relational `intake_answers` table.** Considered and rejected: the answer set
is variable-shape (slots differ per order), it is written once and read once, there is no query
pattern over individual answers, and keeping it in the row means the webhook's existing
`pre_intakes` → `orders` copy (`stripe-webhook:127–147`) picks it up with two more assignments
instead of a join. The constraints above give the shape guarantees a table would have given.

**Why `interview_plan` is denormalised onto `orders`.** The ledger renderer needs the *question as
asked* to build `source_ref` provenance, and cached plans are versioned and can be invalidated. A
copy on the order is small, and it is the audit record of what this customer was actually asked —
which is exactly what "assertion, not verified fact" requires us to be able to show.

---

## 7. Wizard changes against the existing step structure

*Describing only — no edit to `index.html`.*

Current structure: five `.wiz-step` divs at **617–677**; `wiz.last = 4` at **703**; `render()`
toggles by DOM index at **733–736** (`data-step` is cosmetic — the new div must be inserted at the
correct **DOM position**); `validate()` handles only steps 1 and 2 at **720–731**; the dots loop at
**736** is `d <= this.last` and grows automatically.

### 7.1 One new step, six dots

| index | step | change |
|---|---|---|
| 0 | Your package | unchanged (**617–626**) |
| 1 | Your organisation | unchanged (**628–643**) |
| 2 | The grant | unchanged (**645–651**) |
| **3** | **About your work** | **NEW** — insert a `.wiz-step` div between line 651 and line 653 |
| 4 | How should we write it? | was step 3 (**653–670**); renumber `data-step` |
| 5 | Ready when you are | was step 4 (**672–675**); renumber `data-step` |

Considered and rejected: folding the interview into the existing optional step to keep five dots.
It tests better as its own step — a step framed *"this is what stops your proposal reading like
everyone else's"* earns its place, whereas eight cards appended below the directions box reads as an
optional-page dumping ground and inherits that page's "skip it entirely" framing (**655**).

### 7.2 Concrete edits

- **`703`** — `step: 0, last: 4` → `last: 5`. Add `interview: {}`, `plan: null`, `planId: null` to
  the `wiz` object.
- **New div body** — a heading, a one-line subhead, and an empty `<div id="interview-cards">`.
  Cards are rendered by JS from `wiz.plan || FIXED_SPINE`.
- **`720–731` `validate()`** — add a `this.step === 3` branch: Q1 needs row 1 complete *or* its
  escape checkbox; Q2 needs `what` + `when` *or* its escape checkbox. Same `alert()` + `focus()`
  pattern as the existing branches.
- **`926–931` next-button handler** — after the existing `if (wiz.step === 2) analyzeGrant();`, add
  `requestInterviewPlan();`. It fires on the *advance out of* the grant step, so the call runs while
  the customer reads step 3's heading.
- **`749–760` `summary()`** — add a row: `['About your work', answered + ' of ' + shown + ' answered']`.
- **`774–780` `pay()`** — add `interview: this.interview`, `plan_id: this.planId`. `name` and
  `whatsapp` are already sent and are now stored server-side.
- **`analyze-grant` call site (~838)** — pass `org` and `website` when `mode:"interview"`, so the
  micro-crawl has a seed.

### 7.3 The rendering rule that protects conversion

**Render the fixed spine immediately. Never show a spinner in place of questions.** If the plan
arrives, upgrade card labels *in place*, matched by slot id, and **never touch a card the customer
has already typed into**. If the plan does not arrive within 6 s, or returns `ok:false`, the spine
simply stays — and the customer never learns there was supposed to be a personalised version. The
existing `setContinueEnabled(false)` blocking pattern (**~833**) is deliberately *not* reused here:
the grant step blocks because the answer is worth waiting for; this must not.

### 7.4 `save-intake` changes

`save-intake:26–35` is a closed row literal. It gains `contact_name`, `whatsapp`, `interview`,
`plan_id`, `step_reached`, and:

- **Server-side validation of `interview`**: reject unknown slot ids, cap repeater lengths at the
  slot's maximum, cap every string at its form length, coerce numerics and reject non-finite values,
  reject any object exceeding the 64 kB constraint. The client is not trusted with shape.
- **Upsert on `id`** so the wizard can save on each step advance without creating duplicate rows.
  This is what makes abandonment measurable (§8) and it also means a customer who drops out after
  the interview and returns via a Stripe link still has their answers.

---

## 8. How a thin-answer order degrades — honestly

`interviewToLedger` returns a deterministic `evidence_density` band, computed by counting `E-ASK`
items by class. **Nothing here is a model judgement.**

| Band | Condition | What the proposal does differently |
|---|---|---|
| **rich** | ≥2 site rows **and** a `last_delivery` with a number **and** ≥1 of {unit_costs, finances, people} | Targets are derived: the design stage's `assumptions[]` records them as `derived_from_applicant_statement` with the prior figure named, instead of `model_proposed_target`. Budget lines carry the customer's real unit costs, and only the *unanchored* lines are labelled planning estimates. Capability prose names people, venues and partners. |
| **thin** | required answers present, most optional ones blank | The proposal **says so, once, where a donor looks.** The track-record/capability section opens with a bounded statement of what is evidenced and what is not — "This application is supported by X and Y; the organisation has not published outcome data, and the targets below are therefore derived from the activity plan rather than from prior delivery." Budget and sustainability are explicitly framed as planning estimates. Every unanswered slot removes a *permitted claim class*, so the prose gets narrower, not vaguer. |
| **empty** | both required questions answered with their escapes | Today's behaviour at **1207**, unchanged: no past-track-record claims at all. Plus a one-page "what we could not evidence" note in the delivered package, listing exactly which facts were unavailable. The proposal still ships. |

**The rule that makes this honest, stated as a rule the generator is given verbatim:**

> Each unanswered question removes a permitted claim class. It never lowers the evidence bar, and it
> is never licence to write more confidently to cover the gap.

That is the failure mode to guard against — a thin ledger producing *smoother, emptier* prose,
because vagueness is the path of least resistance when specificity is unavailable. The rule inverts
it: less evidence means fewer things the document is allowed to assert, and the document says which.

**The recovery path, with no human in it.** The delivery email names the two or three questions
whose answers would materially change the document, and links to the **existing** revision flow
(`revise` stage, `revision_requests`, `REV_CAPS` at `stripe-webhook:197`) with those slots
pre-loaded. The customer answers; the revision reruns with a fuller ledger. Zero new machinery, no
person in the loop, and it converts the honest admission into a product feature rather than an
apology.

---

## 9. Conversion risk, plainly

**The honest starting position: nobody knows the current conversion rate, and the code cannot tell
you.** `save-intake` is called once, from `pay()` (**~783**). A customer who abandons at step 2
leaves **no row at all**. So there is no funnel, no per-step drop-off, and no baseline against which
to judge this change. Making abandonment measurable (§7.4, step-advance upserts + the
`step_reached` index) is a prerequisite for tuning, not a nice-to-have, and it should ship *before*
or with the questions.

**The risk, stated without hedging.** The wizard goes from three required fields to five, and from
five steps to six. The new step is the longest in the form. Some proportion of people who would have
paid will not. At $149–$449 this is a considered purchase rather than an impulse one, which helps —
but a form that asks about last year's income *before* taking any money will lose people, and Q6 is
the likeliest single point of loss.

**Two mitigations that cost nothing:**

- Every required question has a valid one-click escape, so "required" never means "blocked".
- The step's subhead states the trade plainly: *"Six questions. They are the difference between a
  proposal about your organisation and a proposal about organisations like yours."* Customers who
  understand why a question is asked answer it; that framing is itself the mitigation.

**Cut order, if the owner wants it shorter.** Strictly in this order:

1. **Q10 `named_things`** — narrow relevance, generated-only anyway.
2. **Q9 `limits`** — valuable but partly inferable from which slots are blank.
3. **Q6 `finances`** — highest sensitivity, highest drop-off, and partly recoverable from a crawled
   annual report once PDF reading exists.
4. **Q5 `unit_costs`** — three rows of numbers is the heaviest cognitive load on the page.
5. **Q7 `reach`** — overlaps Q2's numbers.
6. **Q3 `people`**, then **Q4 `partners`**, then **Q8 `local_trigger`** — all cheap, all high yield;
   only cut under protest.

**The floor is Q1 + Q2.** Two questions, one screen, ~40 seconds. Between them they fix the two
most-named reject items (absence of proper nouns, arbitrary targets) and they are the two the rest of
the design leans on. Below that floor the interview is not worth building.

---

## 10. Cost, and what each dollar buys

Baseline ~$0.15/order against $149–$449.

| Item | When | Cost | What it buys |
|---|---|---|---|
| Question-plan call (~4k in / ~1.2k out) | pre-payment, **every wizard reaching step 2** including non-buyers | ≤ $0.01 per wizard; near-zero amortised after the first customer on a grant (cache) | Questions the customer recognises, and 0–2 eligibility probes that prevent a late blocking failure |
| Micro-crawl (3 fetches) | pre-payment | ~$0 (no model call of its own) | The applicant's own nouns in the question labels — the recognition effect, safely, with no ledger exposure |
| Ledger rendering | worker | **$0 — zero model calls, it is code** | ~20 typed items with provenance |
| Larger prompts | worker | +~30k input tokens/order across ~10 stage calls | The items reaching every generation stage |

**Total added cost ≈ $0.02–0.05 per order.** Which is the honest headline: **the Evidence Interview
is not where the 10× headroom goes.** It is the cheap fix that makes expensive fixes worth buying —
a second generation pass, a stronger model on the narrative, or a real critique loop all currently
spend money re-polishing prose that has nothing to be specific about. Fill the ledger first, then
spend.

It also **adds no stage and no worker model call**, so it does not touch the P0 #3 timeout problem.

---

## 11. How it is tested

### 11.1 Deterministic, no model in the loop

`interviewToLedger(interview, plan)` is a pure function. This is the design's main testability claim
and most of the test budget goes here.

- **Golden fixtures, one per slot**: exact expected `E-ASK` items — id, `claim` string,
  `source_type`, `assertion_class`, `verification`, `basis`, `facets`, `status`.
- **Property tests**: every item has non-empty `source_ref`; every item has `assertion:true`; no item
  is simultaneously `assertion:true` and `verification:"site_corroborated"` before the corroboration
  pass; every numeric in `facets` appears in the set handed to `evidenceNums`; item count ≤ 24;
  `claim` ≤ 300 chars.
- **Band boundaries**: fixtures that sit exactly on each `evidence_density` threshold, in both
  directions.
- **Escape paths**: `no_fixed_site`, `no_prior_delivery`, `already_in_post:false`,
  `since:"not_started"` each produce the documented `asserted_planned` status and nothing else.
- **Corroboration pass**: an `E-ASK` place token appearing in an `E-WEB` claim promotes to
  `site_corroborated`; a near-miss does not; a promotion never occurs when the identity gate fired
  (there is no `webEvidence` to match against).

### 11.2 Adversarial fixtures

- Prompt-injection strings in every field; a `partner_name` identical to the applicant's own name; a
  10 k-char paste into a 120-char field; non-finite and negative numerics; a `since` date in the
  future; a site answer naming a country outside the grant's stated geography (must surface as a gap,
  not be silently accepted).
- **Contradiction**: an interview answer that disagrees with a crawled `E-WEB` item must produce
  `conflicting` at the auditor, not a silent override. Regression fixture.
- **Customer overclaims**: an answer asserting a 500-person programme with no corroboration must stay
  `assertion:true` / `verification:"customer_asserted"`, must never be laundered into a verified
  item, and must appear in prose with its basis or as the organisation's own figure.
- **Correction-loop regression** (the §4.4 risk): a draft containing a correctly-used `E-ASK` fact,
  run through one correction round, must still contain it. This is the test that catches the
  "correction strips the interview's yield" failure.

### 11.3 Quality, blind and paired

Per `reports/quality-standard.md` and the standing conventions:

- **Paired runs**: same grant, same organisation, one run with interview answers and one with only
  the escapes. Same generator, same seed conditions. This isolates the interview from every other
  variable.
- **Blind, two model families**, generator never grades its own work, adversarial critic prompt.
- **The specific things that must move**: dimension 4 (Specificity), dimension 3 (Organisation fit),
  and disqualifiers 1, 4 and 6. If dimension 4 does not move on paired runs, the interview has not
  worked and no amount of extra questions will fix it.
- **Proper nouns are counted deterministically**, never by a model: capitalised non-sentence-initial
  tokens, minus the applicant name, the donor name and month names. The standing convention that
  *language models cannot count* (two critics wrongly failed a 596-word document against a 600-word
  limit) applies exactly as much to counting nouns as to counting words.
- **Benchmarks run against their own manifest and create no orders in the production project**, per
  the conventions note — `bench_cases` is gone and production holds only KT-10001/KT-10002.

### 11.4 Front-end and endpoint

- Plan timeout, plan `ok:false`, plan returning an unknown slot id, plan returning 40 slots: the
  fixed spine must render in every case and the step must be completable.
- A plan arriving *after* the customer has typed must not overwrite an answered card.
- `save-intake` validation: unknown slots rejected, over-long repeaters truncated, oversized
  `interview` rejected with a clean error rather than a 500.
- Upsert idempotency: five step-advance saves produce one row.

### 11.5 The leading indicator worth recording

Store `evidence_density` and the answered-slot count on the order. Answered-question count is
observable **at intake, before any model runs** — which makes it the only leading indicator of output
quality this system has, and a partial answer to P1 #8 (no quality-drift monitoring, and
validator-based monitoring would be blind to it because every failing proposal passed every
validator). A drift in mean answered-slot count is visible days before a drift in output quality.

---

## 12. Open dependencies this design does not solve

- PDF reading — for uploads (`upload-intake-file:87–90`, where `.pdf` and `.doc` are stored unparsed
  while the UI says "we will read this format soon") and for the crawl (**241**, `ssrf.ts:85`). The
  interview reduces the dependency on both; it does not remove it. Annual reports remain the richest
  unreached source, and they are the one thing that could turn `customer_asserted` into
  `document_corroborated` at scale.
- The `p.length > 40` paragraph filter (**253–254**) still deletes the crawl's most proper-noun-dense
  shapes, which caps how much corroboration is achievable.
- P0 #2 (the 8-proposals-per-grant ceiling) and P0 #3 (Competitive/Full not completing) are
  untouched by this and remain launch blockers on their own.
