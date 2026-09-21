# Adversarial review — `design-evidence-interview.md` and `design-deep-crawl.md`

Reviewer did not write either document. Every line reference below was checked against the
working tree at `/home/user/ktebli` (`supabase/functions/worker/index.ts` = 1995 lines,
`worker/ssrf.ts` = 150 lines, `index.html` = 937 lines, `save-intake/index.ts` = 44 lines,
`stripe-webhook/index.ts`, `db/schema.sql`).

**Verdict: NEEDS_WORK.** Both documents are unusually well grounded — I spot-checked roughly
thirty of their code citations and all but two are exact. But there are nine places where a
non-negotiable constraint is violated as written, and the headline claim (that this fixes
"absence of proper nouns") is true only for a minority of customers.

---

## 0. Citation audit — what I verified

Accurate: `E-INTAKE-1..3` at **1274–1276**; `allowedEvidence` filter at **1198**; `EVIDENCE_NOTE`
**1199–1203**; empty-ledger branch **1207**; `directions` fenced at **1209**; web evidence
**1322–1327**; identity gate **1341–1360**; `E-PROP` at **1400–1405** and the fire-and-forget
`.catch(()=>{})` at **1409–1412**; `evidence = [...intakeEvidence, ...webEvidence]` at **1410**;
`partnerships[].status` at **1547**; `indicators[].baseline` at **1549**; `evidenceNums`
**1650–1655**; auditor **1666–1683**; `blocking` **1703**; correction fix-list and the ABSOLUTE
RULE **1723–1737**; `PAGE_VALUE` **176–189**; `normDomain` **204–206**; offsite drop **226**;
depth-1 discovery **236–239**; the fetch loop **249–265**; `p.length > 40` at **254**;
first-appearance dedupe **256–261**; `identityCheck` **392–413**; `orgTokens` **441–446**;
`orgNameMatchesSite` **447–460**; `ssrf.ts:85` content-type allow list; `ssrf.ts:142–150`
`stripHtml`; wizard `wiz` object at **703**, `validate()` **720–731**, `render()` **733–736**,
`summary()` **749–760**, `pay()` **774–780**.

Two errors:

- **`design-evidence-interview.md` §7.2 cites "926–931 next-button handler".** The next-button
  handler is at **index.html:893–897**. Lines 920–931 are the file-upload result handler. The
  described edit (`after the existing if (wiz.step === 2) analyzeGrant();`) is correct in substance
  — that line is **896** — but the anchor is wrong.
- **`design-deep-crawl.md` assumes a 150 s stage slice** (§7.1 "inside a 150 s slice", §13 "exceeds
  one 150 s stage slice"). The real budget is `TIME_BUDGET_MS = 100_000` at **worker/index.ts:43**.
  This is not cosmetic — see V7.

---

## 1. Constraint-by-constraint

### C1 — NO HUMAN IN THE LOOP

**Passes.** I grepped both documents for human/manual/operator/escalate/flag/by-hand. The only
hits are `design-deep-crawl.md:1046` and `:1063–1064`: `blocked_bot` and `extraction_failed`
clustering raise an *operator alert* through the existing notifier. That is infrastructure
monitoring — the document is explicit that "the order proceeds regardless" and never in the
customer's path. `design-deep-crawl.md:287` ("No human intervenes; the intake answers carry the
order") and `:1498` are correct. `design-evidence-interview.md:635` routes the recovery path
through the *existing* customer-driven `revise` stage, not through a person.

One implicit-interpretation snag, minor: **Q0 `eligibility_probe` offers "Not sure"** and the
design defines the consequence only for "No" ("caught before payment and the proposal is written
around the gap"). "Not sure" has no defined mapping to `status`. A model will interpret it, not a
human, so it is not a violation — but it is an undefined path in a slot whose whole purpose is to
pre-empt a `donor_required_certification` deadlock at **1710–1719**.

### C2 — GROUNDING HOLDS

**Violated, in four distinct places.** See V1–V4 below. This is the most serious cluster.

### C3 — COMPLIANCE HOLDS (word limits, page limits, required sections, donor format)

**Not violated, but not analysed either.** Two unresolved interactions:

- `design-deep-crawl.md` §12.2(a) grows the ledger from 3–9 items to 60–150 and caps prompt
  injection at `maxItems: 40, maxChars: 12_000`. Forty evidence items cannot be used inside a
  600-word donor limit. The selection function ranks by `kind` and grant terms, never by the
  document's word budget, and the correction prompt at **1730–1733** already had to be patched
  once (the B3 note) because corrections answer findings *by adding*. More admissible material
  pushes harder against the same ceiling. Neither document quantifies this.
- `design-evidence-interview.md` §8 "empty" band promises "a one-page *what we could not evidence*
  note **in the delivered package**". If that page is inside the proposal document it breaks page
  limits and required-section structure; if it is a separate file it is fine. The document does not
  say which, and the `package`/render-service page-count path is exactly where a donor page limit
  currently blocks delivery (standing user-side item in CLAUDE.md).

### C4 — CLAIM LEDGER HOLDS

**Violated at the delivery-risk end.** See V5.

### C5 — ARCHITECTURE FIXED

**Passes.** `analyze-grant` gains `mode:"interview"` rather than a ninth function (interview §2) —
function count stays at eight and `config.toml` is untouched. `harvest` is a new *stage*, not a new
service; `claim_next_stage` (`db/schema.sql:400–436`) keeps stages strictly sequential. No new
external services; PDF parsing is `npm:` inside the existing isolate, consistent with `docx`/`xlsx`
already loaded at **worker/index.ts:32–37**. Postgres/queue/OpenRouter/Resend/Stripe unchanged.

### C6 — COST

**Passes on the stated arithmetic, with one unstated multiplier.** Deep crawl ≈ +$0.084 first
order, $0 on repeats; interview ≈ +$0.02–0.05. Both state what the money buys, and both correctly
decline to spend the 10× headroom on more model passes over thin evidence. The unstated multiplier:
the interview's question-plan call fires **per wizard reaching step 2, including non-buyers**
(§10 says so), cached only by *grant fingerprint*. In a market where each customer brings a
different grant (BLUEPRINT §2: an association applies 3–4 times a year), the cache hit rate is low,
so the real figure is `$0.01 × (wizards per paid order)`. Nobody knows that ratio — §9 admits the
funnel is unmeasurable today. At 20 wizards per order that is $0.20/order of pre-payment spend,
four times the design's own headline. Still trivial against $149, but the headline number is wrong.

Related, and unanalysed by either document: `requestInterviewPlan()` makes an **unauthenticated,
`verify_jwt = false`, model-calling, URL-fetching endpoint**. `analyze-grant:31` rate-limits at
15/600 s per IP and the wizard's own `analyzeGrant()` already consumes that bucket. The plan call
adds a free LLM call plus three outbound fetches to a customer-supplied URL per request. SSRF is
covered by `assertHostSafe`, but cost-abuse is not mentioned anywhere.

### C7 — DELIVERY NOT BLOCKED, DELAYED OR DEGRADED BEYOND 5–30 MIN

**Violated.** See V5, V6, V7.

---

## 2. The violations, precisely

### V1 — `design-evidence-interview.md` §Q6 manufactures a provenance claim in code

> **Ledger:** `assertion_class: performance_claim`, `basis: "the organisation's own accounts"`.

The customer is asked for `annual_income`, `year`, `largest_grant`, `largest_grant_funder`. They
are never asked *where the number came from*. The design then hard-codes a `basis` string asserting
it came from the organisation's accounts, and §4.3's rule table says a `performance_claim` with a
`basis` present may be "state[d] with the basis in the same sentence".

The output is a sentence in a funder-facing document of the form *"£412,000 in 2024, from the
organisation's own accounts"* — where no accounts were seen by anyone, and the customer never
claimed they had consulted any. That is code inventing a source. It is precisely the fabrication
failure mode the brief names as worse than the current generic output, and it is worse than a model
doing it because it is systematic and silent.

Contrast Q2 and Q7, which get it right: `basis = how_counted` **verbatim from the customer**, and
`basis: null` when they did not answer, with a correct downgrade rule. Q6 should either ask the
basis or carry `basis: null`.

### V2 — `assertion_class` is assigned per slot, but the free-text inside a slot can be any class

Q1 `what_happens` (120 chars), Q3 `background` (200 chars), Q4 `what_they_do` (160), Q8
`local_trigger` (240), Q9's free line and Q10 `what_for` are all typed `assertion_class:
self_description`. §4.3's table gives `self_description` **one unconditional row**: *"any → state
plainly."* No basis, no hedge, no corroboration required.

So a customer types into Q3 `background`: *"led the Ministry's £2m youth employment programme
2018–22 and ran UNDP's Bekaa response"*. The renderer builds `claim` from `facets` by code, the item
enters the ledger with `allowed: true`, the auditor at **1674** receives it inside
`allowedEvidence`, classifies the narrative sentence "supported" — and §4.3 licenses it to be
stated plainly, unhedged, as established fact about a named person and two named institutions.

The typed-field argument (§5) is that "the model never adjudicates a customer sentence". That is
false for at least six fields: they are free text, and the class is chosen by which box the text
was pasted into. The fix is not hard — classify by *content shape* (does the string contain a
numeral, a currency marker, a superlative, a third-party organisation name?) and downgrade to
`performance_claim`/`third_party_commitment` with `basis: null` when it does — but the design as
written does not do it.

### V3 — the corroboration upgrade launders a whole item from one token match

§4.2:

> after the `org` stage builds `webEvidence`, any `E-ASK` item whose distinctive `facets` token
> (place, venue, partner_name, named thing) appears in an `E-WEB` claim string is promoted to
> `site_corroborated`

and §4.3's last row:

> `verification = site_corroborated` → may be stated **without hedging**.

The unit of the match is a **token**; the unit of the promotion is the **item**. A Q1 row carries
`{place, venue, activity, since}` in one item. If the site mentions "St Anne's Hall" anywhere, the
item is promoted — and with it `activity: "weekly lunch club"` and `since: "2019-03"`, neither of
which the site corroborated. A Q2 `last_delivery` item carries `what`, `when`,
`how_many_started`, `how_many_finished`, `result`; a match on a programme name promotes the
denominators too.

That is an unverified customer assertion entering a proposal as an established fact, by
construction. §11.2's overclaim test is written to miss it: *"an answer asserting a 500-person
programme **with no corroboration** must stay `customer_asserted`"* — the failing case is the one
with *partial* corroboration.

Corroboration must be per-facet, and the "no hedging" licence must attach to the corroborated facet
only.

### V4 — E-ASK puts raw customer text into every system prompt outside the injection fence

`U_OPEN`/`U_CLOSE` are defined at **54–55** and used at **1209** (directions), **1245** (grant
page), **1319** (site corpus), **1398** (uploaded proposals) and **1753** (revision request). The
Evidence Ledger is **not** fenced: **1202** is a bare `JSON.stringify(allowedEvidence)` inside
`baseCtx()`.

That is safe today because every ledger `claim` string is *model-extracted* from already-fenced
input. `E-ASK` breaks the invariant: §4.1 states `claim` is rendered **by code** from customer
`facets`, so verbatim customer text — up to 24 items × 300 chars — lands unfenced in the writer's
prompt, the design prompt, the budget prompt and the auditor prompt at **1674**.

The design's answer (§11.2) is a test — *"prompt-injection strings in every field"* — with no
mitigation behind it. Length caps and code-rendering do not stop injection; fencing does. Either
wrap the ledger in `U_OPEN`/`U_CLOSE`, or fence the `E-ASK` subset, or strip fence-breaking tokens
in `interviewToLedger`. Note the same problem reaches the auditor, which is the one component whose
integrity the whole grounding story rests on.

### V5 — two new blocking classifications, an unchanged round budget, and a `throw` at the end

§4.4 adds `asserted_overreach` and `asserted_as_history` "both blocking alongside
`unsupported`/`stale`/`conflicting` at **1703**".

The round budget is **1641**: `const maxRounds = deep ? 2 : 1`. If `blocking > 0` after the last
round, **1717** throws. A thrown stage is `failed`, and `db/schema.sql:601` maps a failed stage to
proposal status `attention`; `:610` propagates it to the order. Per CLAUDE.md P0 #4 there is no
failure notification anywhere except the deliver stage — **the customer pays and is never emailed.**

So the interview increases the count of blockable claim classes and the volume of claimable
material (~20 new ledger items, each with prose rules the auditor can find a violation of) against
an unchanged 2–3 round budget, and the failure mode is silent non-delivery. §4.4 identifies the
adjacent risk (that the correction loop would *strip* the interview's yield) and correctly insists
the correction instruction change from "remove it" to "restate it correctly" — but "restate
correctly" is a *harder* instruction to satisfy than "delete", so convergence within the same
budget is less likely, not more. The document never mentions the throw, the round budget, or the
`attention` consequence.

Minimum fix: make the two new classifications non-blocking on the final round, or exclude them
from `blocking` and handle them as correction findings only.

### V6 — `design-deep-crawl.md` §10 claims "Nothing in this table blocks delivery" while the table lists a code that does

The table's last row:

> `yield_cap` | 40 yields without completing (`yield_stage`) | job_stages | stage `failed` → existing terminal notifier

A `failed` stage is exactly `db/schema.sql:601` → `attention`, and `claim_next_stage`
(`db/schema.sql:400–436`) will not run `org` while an earlier stage of the same proposal is not
`done`. So `yield_cap` on `harvest` — a stage inserted at **seq 2**, ahead of everything — halts
the entire pipeline before any narrative is generated. The paragraph immediately under the table
asserting that nothing there blocks delivery is false about its own last row.

The right posture for a crawl stage is that *no* crawl outcome, including exhausting the yield
budget, may fail the stage: it should `done` with `outcome: "budget_exhausted"` and whatever it
collected. The rest of the taxonomy is built that way; this row is the exception and it is the
dangerous one.

### V7 — the crawl leaves the applicant's own domain on real Lebanese hostnames

This is the sharpest finding in the deep-crawl document, and it is in the function the document
itself calls "the highest-severity bug this subsystem can have".

```ts
const MULTI_SUFFIX = new Set([
  "co.uk", "org.uk", ... "com.lb", "org.lb", "com.eg", "org.eg", "com.jo", "org.jo", ...
]);
function registrable(host: string): string {
  const p = normDomain(host).split(".");
  if (p.length <= 2) return h;
  const last2 = p.slice(-2).join(".");
  return MULTI_SUFFIX.has(last2) ? p.slice(-3).join(".") : last2;
}
```

BLUEPRINT §2 states the market plainly: *"A registered Lebanese association"*, then Jordan, Iraq,
Egypt. The suffix table covers `com.lb` and `org.lb` — and nothing else Lebanese. It omits:

- **`net.lb`, `edu.lb`, `gov.lb`** — Lebanon's other live second levels.
- **`org.ps`, `com.ps`** — Palestine, unavoidable for a Lebanese NGO sector serving Palestinian
  refugee camps.
- **`org.iq`, `com.iq`, `edu.iq`** — the second market named in BLUEPRINT §2.
- **`org.sy`, `com.sy`; `org.sa`, `com.sa`; `org.ae`; `org.qa`; `org.kw`; `com.tn`; `org.ma`.**

For an applicant at `mabarrat.net.lb`, `registrable()` returns **`net.lb`**, `scopeFor()` returns
`kind: "domain"` with `registrable: "net.lb"`, and `inScope()` returns true for
`h.endsWith(".net.lb")` — i.e. **every `.net.lb` host on the internet**. Any outbound link from the
seed page to another Lebanese organisation is followed, fetched, extracted and pushed into the
frontier, and its links after that, to depth 3. That is a direct violation of the owner's settled
decision: own domain only, no third-party sources.

The document's own comment concedes the risk (*"the table below covers the suffixes that actually
appear in this market"*) and then relies on `inScope()` to contain the error — but `inScope()` is
the function that is wrong. The trap the document identified for `wordpress.com` is the same trap,
one level up, and the mitigation it built (`PLATFORM_SUFFIX`) does not fire for ccTLD second levels.

Downstream containment is partial, not total: G2 would mark most such documents `unknown` (no
first-party anchor) — but see V8, where the anchors are weak enough to admit them, and G1's corpus
is polluted before either gate runs (V9).

**Minimum fix**: default to the **seed host** whenever `registrable()` is not confident — i.e.
invert the fallback so an unlisted three-label host collapses to `kind: "host"` rather than widening
to the last two labels. That is the asymmetric choice the rest of the design claims to make.

### V8 — G2 and G3 treat sector nouns as identity tokens

`orgTokens` (**441–446**) filters `ORG_GENERIC_WORDS` (**433–440**). That set contains structural
words — association, foundation, trust, community, development, welfare, aid, relief, network,
centre, council — but **not sector words**: youth, women, children, refugee, education, health,
food, housing, disability, mental, sport, arts, culture, environment.

Most charities are named after their sector. For "Al Amal Youth Centre", `orgTokens` = `{amal,
youth}`.

In `documentAttribution`:

```ts
const anchored = nameHit || regHit || (domainHit && tokenHit);
```

`tokenHit` searches `orgTokens(rawText.slice(0, 40_000))` — the token vocabulary of forty thousand
characters of prose. "youth" appears on essentially every youth-charity page in existence.
`domainHit` is `rawText.toLowerCase().includes(a.domain)` — satisfied by any footer carrying the
site's own domain or an `@domain` email. So on a wrongly-scoped crawl (V7), an unrelated
organisation's page is `anchored` and lands at `mixed` rather than `unknown` whenever the extraction
model returns `is_about_applicant: null`.

Then in `claimAllowed`, the mixed-document escape hatch:

```ts
const quoteHasApplicant = orgTokens(it.quote).size > 0 &&
  [...orgTokens(it.quote)].some((t) => want.has(t));
if ((it.kind === "partner" || it.kind === "funder") && quoteHasApplicant) return { allowed: true, ... };
```

A quote reading *"…expanded its youth services across three districts…"* satisfies
`quoteHasApplicant` on the token "youth". A `partner`/`funder` item from another organisation's
document is admitted as a fact about the applicant's relationships.

This weakness exists today in `orgNameMatchesSite`'s domain-substring branch (**456–458**), but
today's blast radius is ≤8 boilerplate items from one site. Under deep crawl it is 40 documents and
150 typed items, several of them dated results from a real annual report. The design's stated
principle — *"anything short of a confident match discards the site entirely"* — is not met at
document or claim granularity.

### V9 — G1 is evaluated over the whole multi-document corpus, so one third-party page can flip site identity

`identityConfidence()` takes `corpus` and runs `regNumberOnSite(a.reg, a.corpus)` and
`normQ(a.corpus).includes(normQ(a.orgName))` over it. The document says G1 runs "once per domain"
but never says the corpus is restricted to the seed page. If it is the crawl corpus — which is what
"once per domain, after the crawl" implies, and what §12's driver ordering suggests — then a single
page anywhere in a 40-document crawl that names the applicant or prints their registration number
flips the identity verdict for the *whole site*.

Concretely: an umbrella body's member directory listing *"Hopewell Trust, registered charity
1123456"* gives `registration_number_on_site` → `strongCount >= 1` → **`strong`** → the umbrella's
entire site, its annual reports, its voice guide and its profile are admitted as the applicant's.
Today's gate rejects that domain outright.

Related and smaller: `order_email_domain` is treated as a **strong** signal, sufficient on its own
for `strong`. `orders.email` comes from `s.customer_details.email` (`stripe-webhook:118–120`) —
typed at Stripe checkout, never verified for domain control. A single unverified field promoting a
whole site from "discard" to "admitted" is not the asymmetry the constraint requires. G2 catches the
worst of it (the B1 case), but the document's claim in §9/G1 —

> nothing that today's gate rejects is admitted on weaker grounds than today

— is **false** as written for both the reg-number-in-corpus path and the email-domain path. It is
true only for the `weak`-level rules.

**Fix**: compute G1 over the seed document and the homepage only, before the frontier expands; treat
`order_email_domain` as corroborating, not strong.

---

## 3. Substantive weaknesses that are not constraint violations

**W1 — CDN-hosted PDFs are silently unreachable, and that is where this market's PDFs live.**
The task asked specifically. `inScope()` is host/registrable based, so
`static1.squarespace.com/...annual-report-2024.pdf`, `docs.wixstatic.com/ugd/...pdf`,
`*.cloudfront.net`, `drive.google.com` and `*.blob.core.windows.net` are all off-scope and dropped.
Wix and Squarespace are also the two platforms most likely to trigger `js_only`. So the customer
segment with the weakest HTML is also the segment whose one good document is unfetchable — a double
loss the design never names. §9.5's honest list of eight losses does not include it. Whether to
admit an asset host is a real judgement call (an asset CDN is not a third party's *content*), but
the document must make it rather than leave it implicit.

**W2 — the `value` object is unverified while the quote is verified.** §8.3's quote anchor is
genuinely strong and is the best idea in either document. But `value: {n, unit, currency, period}`
is model-populated and never checked against the verified quote. A quote reading "500 residents"
can carry `value.n = 5000`; `selectEvidence`'s renderer prints `[5000 residents]` into every
generation prompt, and `evidenceNums` (**1650–1655**) — which reads `e.claim`, not `e.value` —
would not even flag the mismatch. A three-line check (`String(value.n)` must appear in the quote,
modulo separators) closes it.

**W3 — Arabic is handled in `verifyQuote`/`normQ` and in one `layoutLines` test, and nowhere else.**
`keepLine`'s specificity test is `PROPER_NOUN_MID = /\s(?!The\b|...)[A-Z][a-zA-Z'’-]{2,}/` — Latin
casing only. Arabic script has no case, so for an Arabic page the "keep short specific lines" rule
degrades to "contains a digit", and every short Arabic line naming a place or a person is deleted
exactly as `p.length > 40` deletes it today. `garbled()` uses `vowels/letters < 0.12` over
`[aeiouAEIOUاوي]`; undiacritised Arabic sits near that boundary, so a legitimate Arabic annual
report risks being classified `garbled` and thrown away. In a Lebanon-first product this is not an
edge case.

**W4 — the domain lock is per-host, and for path-multiplexed platforms that is one lock for all
customers.** §12's driver passes `p_domain: scope.host`. For `sites.google.com/view/<org>` the host
*is* `sites.google.com`, so `crawl_runs_one_live_per_domain` serialises every Google Sites customer
behind one lock, and a reaped harvest holds it for the full 10-minute staleness window. The lock
should be keyed on `(scope.host, scope.pathPrefix)`.

**W5 — §13's "$0.00 on repeats" is not what §12's driver does.** The cost table credits 30-day
`org_intel` freshness (**1266–1268**), but the `harvest` driver has no freshness check: it locks the
domain, reads robots, seeds the frontier and issues conditional requests every time. At 700 ms
pacing that is 30–50 s of wall clock and at least one yield on a repeat order that should have cost
nothing. Add the `org_intel` freshness short-circuit to `harvest`, not just to `org`.

**W6 — timing arithmetic is built on a 150 s slice that does not exist.** With
`TIME_BUDGET_MS = 100_000` (**:43**), the stated 85–200 s crawl is **2–3 yields typical, not 1–2**,
and each yield waits for the next pg_cron tick. Realistic added wall clock is 3–5 minutes, plus the
`busy` backoff path. That still fits inside 5–30 minutes, so it is not a violation — but it is a
larger slice of the budget than the document claims, and it makes §16's risk 5 ("this design depends
on the resumability work; it should not ship first") load-bearing rather than cautionary.

**W7 — `confidence: "quoted" | "derived"` is declared and never defined.** §8.3 says every item
needs a verifying quote; §8.1 declares a `derived` confidence level with no rule for what may be
derived, from what, or how it is checked. `selectEvidence` scores `quoted` higher. Either delete
`derived` or specify it — an undefined provenance level in the type that carries provenance is the
kind of gap that gets filled badly later.

**W8 — RLS posture is inconsistent between the two documents.** `pre_intakes`'s house pattern
(migration `20260820150903`) is `enable row level security` **plus** `revoke all from anon,
authenticated`. The interview design follows it for `intake_question_plans`. The deep-crawl design
enables RLS on `crawl_runs` and `crawl_docs` but issues no `revoke`. Low severity, but
`crawl_docs.text`/`raw_text` hold the customer's site content and the table comments claim
"Service-role only" — the DDL does not enforce what the comment asserts.

---

## 4. Would this actually fix "absence of proper nouns"?

**Partially — and for a meaningful share of customers, barely at all. The designs are honest about
this; the honest reading is less flattering than the headline.**

### The counting

Today: the ledger's real-world proper-noun content is **one** — the applicant's own name.
`E-INTAKE-2` is a token string, `E-INTAKE-3` is the same name spelled as a URL (**1274–1276**).
Web evidence adds 3–5 at best and zero on the three common failure paths.

**Cohort A — required-only, both escapes used, thin or JS-only site.** Q1 → `no_fixed_site`, Q2 →
`no_prior_delivery`. `evidence_density: empty`. Gain: **zero proper nouns**, plus a "what we could
not evidence" note. `design-evidence-interview.md` §8 says so plainly and deserves credit for it,
but the product outcome is the current generic document with an apology attached. Realistically
15–25% of orders.

**Cohort B — required only, answered properly; a working WordPress site with no reachable PDF.**
Q1 gives a place and possibly a venue (1–2 nouns); Q2 gives a dated activity and two real
denominators with a counting basis. Deep crawl's `keepLine` + depth-3 recovers short lines today's
`p.length > 40` filter at **254** deletes — programme names, borough lists, "Founded 2011". Net:
**5–9 ledger-backed proper nouns**, of which perhaps 4–6 survive `selectEvidence` and reach the
narrative. Genuine improvement over 1. This is probably the modal customer.

**Cohort C — most optional questions answered, plus a born-digital annual report on the same
domain.** Interview alone: ~12–16 (3 sites × place+venue, 2 named staff, 3 named partners, 1 named
funder, 2 named things). Crawl adds 20–40 typed items with `entities`. After G2 anchors, quote
verification and the 40-item/12k-char prompt cut: **20–35 available, 10–18 in the document.** This
is the outcome the designs are written for — and it is the smallest cohort. A Lebanese association
of 3–15 staff that publishes a text-layer annual report PDF, on its own domain rather than a CDN,
not scanned, in a script `keepLine` handles: I would not put that above 20–25%, and W1/W3 pull it
lower.

**Weighted estimate: roughly 6–12 concrete, ledger-backed proper nouns for a typical customer**,
against ~1 today. Directionally correct, an order of magnitude short of "messy local nouns".

### The scepticism that matters more than the count

**Nothing in either design makes the generator use them.** This is the biggest omission across both
documents. Both fill the vault; neither adds a check that anything came out of it. The one
proper-noun mechanism proposed — `unsourcedProperNouns()` in deep-crawl §12.2(b) — runs in the
*subtractive* direction: it finds nouns in the narrative that are not in the ledger and hands them
to the auditor as candidate unsupported claims. It can only remove nouns. There is no density
floor, no deterministic validator that fails a narrative containing zero ledger-backed proper nouns,
nothing that makes specificity a pass condition rather than an opportunity. Given that the entire
diagnosis is "absence of proper nouns", the absence of a test for that absence is striking.
Interview §11.3 proposes counting proper nouns deterministically in the *evaluation harness* — the
right method, applied only after the fact, never in the pipeline.

Three further reasons the nouns may not survive to the page:

1. **The correction loop actively deletes them.** The ABSOLUTE RULE at **1735–1737** forbids
   strengthening a section with organisational history not in the ledger, and the fix list at
   **1723** only knows "remove it, qualify it honestly, or recast it". Interview §4.4 identifies
   this and calls it "the single most important integration detail" — correctly — but the change it
   requires (a *restate*-class correction instruction) is unspecified beyond the sentence, and V5
   shows the round budget does not accommodate a harder instruction.
2. **`selectEvidence` optimises for kind and grant terms, not for noun density**, and cuts to 40
   items. Under a 600-word limit almost none of them can appear.
3. **The blind critics said "swappable", not only "no nouns".** A named venue in a named
   neighbourhood is unswappable — interview §Q1's argument is right. But structure, opening device
   and argumentative shape are governed by the exclusivity claims and eight locked templates
   (P0 #2), which neither design touches. More nouns in a document with the same skeleton is a
   partial repair, and the paired blind runs both designs propose (interview §11.3) are the only
   thing that can tell you how partial. Interview §11.3's stated failure condition — *"if dimension
   4 does not move on paired runs, the interview has not worked"* — is the right pre-commitment and
   should be treated as a gate, not a nice-to-have.

### The one-line answer

For a customer who skips the optional questions and has a thin website, **this changes almost
nothing, and the design says so.** The fix is real but conditional on customer effort and website
quality — two variables the product does not control and, as the designs stand, does not require.
