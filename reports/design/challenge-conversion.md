# Challenge: the Evidence Interview from the customer's side, and the business's

Review of `qloop/design/design-evidence-interview.md`. I did not write it.

Verified against the working tree before writing: `index.html` (937 lines),
`supabase/functions/worker/index.ts` (1995 lines), `supabase/functions/save-intake/index.ts`
(44 lines), `supabase/functions/analyze-grant/index.ts` (101 lines),
`supabase/functions/stripe-webhook/index.ts`, `supabase/migrations/20260820150903_pre_intakes.sql`,
and the sibling design `qloop/design/design-deep-crawl.md`.

**Verdict: NEEDS_WORK.** The engineering half is the best document in this directory. The
customer half is thin, and in three places it is wrong in a way that manufactures false facts.

---

## 0. What the design gets right, so the criticism below is read in proportion

I checked its line citations rather than trusting them. They hold:

- `E-INTAKE-1..3` really is the whole intake ledger, at `worker/index.ts:1274-1276` — three items,
  one of which is a token string and one of which is the org name again as a URL.
- `directions` really does reach the writer (`:1209`) and never the auditor (`:1674`), and the
  correction prompt really does forbid adding organisational history (`:1723-1737`). The design's
  claim that the one free-text box is *engineered* to strip proper nouns is correct, and it is the
  single most important observation in the document.
- `render()` really does toggle by DOM index (`index.html:733-736`), so `data-step` is cosmetic and
  a new div must be inserted at the right position. The design caught this. Most would not have.
- §4.4 — that the existing correction loop knows only how to *delete*, and applied unchanged to
  `E-ASK` findings would strip the interview's entire yield on the first correction round — is a
  genuinely sharp catch. It is right, and it is the difference between this working and this
  producing a more expensive version of today's output.
- §4.6 — that `E-ASK` items survive the identity gate because they are built from the order, not
  the site — is the strongest argument in the document and it is not about prose at all. It makes
  the asymmetric gate affordable. That argument alone justifies *some* interview.

So the disagreement below is about **how much to ask, when to ask it, and what happens when the
answer is wrong** — not about whether the diagnosis is right. It is right.

---

## 1. How long the form actually takes

The design never states a completion time for the form it proposes. In a section titled
"Conversion risk, plainly" (§9), that is a conspicuous omission. The only number given is
*"The floor is Q1 + Q2. Two questions, one screen, ~40 seconds."*

### 1.1 Count the controls, not the questions

"Eight cards" hides the real ask. Counting input controls in the design's own fixed spine order
(Q1, Q2, Q3, Q4, Q5, Q8, Q7, Q9 — the 8 cards the shown-set rule permits):

| Slot | Shape | Controls at minimum | Controls at max rows |
|---|---|---|---|
| Q1 `sites` | repeater 1–3 × 4 fields | 4 | 12 |
| Q2 `last_delivery` | 6 fields | 6 | 6 |
| Q3 `people` | repeater 1–2 × 5 fields | 5 | 10 |
| Q4 `partners` | repeater 1–3 × 3 fields | 3 | 9 |
| Q5 `unit_costs` | repeater 1–3 × 4 fields | 4 | 12 |
| Q8 `local_trigger` | 1 free-text line | 1 | 1 |
| Q7 `reach` | 3 fields | 3 | 3 |
| Q9 `limits` | multi-select + line | 2 | 2 |
| **Total** | | **28** | **55** |

Twenty-eight to fifty-five controls, on one step, before payment. Today's entire wizard is ten
fields across five steps with **four** required (`index.html:721-727`: org, your name, email,
grant). The new step alone is three to five times the whole current form.

### 1.2 Realistic minutes, for a fundraiser at a small charity

Splitting by whether the answer is *recall* or *lookup*, because that is what governs the time:

| Slot | Recall or lookup | Honest answer | Fast/guessed answer |
|---|---|---|---|
| Q0 probes (0–2) | recall | 15 s | 10 s |
| Q1 sites, 1 row | recall | 60–90 s | 30 s |
| Q1 sites, 3 rows | recall | +90 s | +40 s |
| Q2 last delivery | **lookup** (two denominators) | 2–4 min, or 10–25 min if the register is in a spreadsheet on someone else's drive | 20 s |
| Q3 people ×2 | recall + hesitation over naming a colleague | 90–150 s | 45 s |
| Q4 partners ×3 | recall + judgement on `status` | 60–180 s | 40 s |
| Q5 unit costs ×3 | **lookup** (invoices, room-hire rates) | 3–6 min | 45 s |
| Q6 finances | **lookup** (last accounts) | 2–8 min | 60 s |
| Q7 reach | **lookup**-ish | 60 s | 25 s |
| Q8 trigger | composition, not recall | 45–120 s | 30 s |
| Q9 limits | recall | 30 s | 15 s |

Adding orientation and reading (~2 min for a step that introduces an unfamiliar concept):

- **Full 8-card set, answered honestly, everything to hand: 14–18 minutes.**
- **Full 8-card set with any real lookup: 25–40 minutes**, and crucially it *spans a break* — the
  fundraiser goes to find the accounts, the tab is still open at 5 p.m., the session is gone. There
  is no save-and-resume for an unpaid customer beyond the step-advance upsert in §7.4, and no
  emailed resume link is proposed anywhere.
- **Fast path (guess three numbers, skip what is optional): 5–6 minutes.**
- **Design's stated floor of Q1 + Q2 at ~40 seconds** is only reachable by ticking *both escapes*.
  Q1 one row plus Q2 with real numbers is **3–4 minutes**, not 40 seconds. The design's headline
  floor time is off by a factor of roughly five for the honest path and describes only the path
  where the customer tells us nothing.

### 1.3 The escape hatch is the fastest route through the form

Every required slot has a one-click escape (§9, presented as a conversion mitigation). It is also
the shortest path: two clicks lands the customer in the **empty** band (§8), which delivers today's
generic proposal *plus* a page explaining that it is thin. A customer who paid $149–$449 and took
the two-click route gets the worst product in the matrix, arrived at by the path the form made
easiest. That is a refund generator, and it is a direct consequence of pairing "required" with
"one-click nothing".

The mitigation is not more friction on the escape — it is **asymmetric consequence framing at the
point of the click** ("we will state in your proposal that no delivery history was available"), and
making Q1's escape genuinely rare-shaped rather than an equal-weight option (see §3.2 below, where
it is currently mis-shaped and forces false answers).

---

## 2. Where people abandon, and where they answer badly or falsely

### 2.1 Abandonment ranking

1. **Q6 `finances`.** Last year's income and the largest grant ever managed, before any money has
   changed hands, from a vendor they found ten minutes ago. The design names this itself and is
   right. It is also the question most likely to be read as *"are they assessing whether to take
   my money?"* — which changes the emotional register of the whole form from intake to vetting.
2. **Q5 `unit_costs`.** Three rows of real prices is the heaviest cognitive load on the page and
   the one most likely to send someone to another tab. Twelve controls at max.
3. **Q2 `last_delivery`'s two denominators.** `how_many_started` / `how_many_finished` are the
   only fields in the set that require a *record*. Everything else is recall.
4. **Q3 `people`.** Not cognitive load — social hesitation. Typing a colleague's name and CV into
   a stranger's web form is a pause point, and for a trustee it is a pause point with a governance
   flavour.
5. **The step as a whole**, for anyone against a deadline. The landing page's promise is speed
   ("ready within 5–30 minutes", `index.html` summary note). A 15-minute form in front of a
   5-minute product is a positioning contradiction the customer feels before they can name it.

### 2.2 The falsification analysis — this is the serious part

The design's safety model is: `assertion: true` + `assertion_class` + `verification` means a
customer statement is never laundered into a verified fact. That model is well built and it solves
the problem it is aimed at — *our system* attributing unearned credibility. It does not touch the
problem that actually matters here.

**The Claim Ledger exists to stop the model inventing facts. It cannot detect a customer inventing
one.** And the artefact is not an internal note — it is a funding application submitted to a donor
in the applicant's name. A wrong number in it is the applicant's problem, permanently, and
plausibly a regulatory one.

Three questions convert "customer guesses" into "system asserts", and they are ordered by damage:

**(a) Q4 `partners` — the most dangerous question in the set.**
`status: agreed in writing / verbally agreed / in discussion / we intend to approach them`.
Under §4.3, `agreed in writing` licenses the proposal to state the partnership *as agreed* and sets
`partnerships[].status = evidence_based` (`worker:1547`). Nothing verifies it. A customer under
mild optimism — or simply reading "we emailed and they said yes" as writing — selects the top
option, and the proposal tells a donor that a written agreement exists. Donors ask for MOUs. This
is a named third party, a checkable claim, and a customer-visible failure with the applicant's
name on it. The design calls this slot "highest-value and highest-risk" and then treats the status
field as if it resolved the risk. It resolves the *internal* risk only.

*Fix:* collapse the select to two options and never state a partnership as firm without an
independent corroborating item. `agreed in writing` should require either an `E-WEB`/`E-PROP`
corroboration (the corroboration pass in §4.2 already exists) or the prose falls back to the
applicant's own hedge. The strongest permitted phrasing should be bounded by `verification`, not by
a dropdown the customer controls.

**(b) Q2 `how_counted` — a dropdown that manufactures provenance.**
`register / sign-in sheet / case notes / a partner's data / our own estimate`. Under §4.3, a
`performance_claim` **with** a basis may be stated plainly with the basis in the sentence; **without**
a basis it may never be totalled, annualised or extrapolated. So selecting a basis *unlocks stronger
prose*. The incentive is exactly backwards. A customer who half-remembers "about 50, maybe 35
finished" and clicks "register" has now caused the document to say *"34 of the 51 enrolled
completed, from the programme's own registers"* — a sentence containing a fabricated methodology
that reads as rigour, generated from a guess, with our system's blessing and its provenance string
attached.

This is the "fabrication risk with extra steps" in its purest form. The basis field is a good idea
implemented with the wrong default. *Fix:* make `our own estimate` the pre-selected default rather
than the fifth option; label the others as what they are ("we have the register and could produce
it"); and cap the prose upgrade so a basis alone never licenses more than "the organisation's own
figure, from its records" — the verbatim methodology sentence should require corroboration.

**(c) Q6 `largest_grant_funder`.** A named funder who did not fund them is the single most
checkable false claim available, and the one a donor is most likely to check informally (the sector
is small). Rounding income upward is the softer version and near-universal in self-report.

**(d) The forced-false answers** — see §3.2, which is severe enough to be its own item.

### 2.3 The timing makes falsification worse, not better

This is the argument the design does not make and it is the one I would put in front of the owner.

Pre-payment, the form stands *between the customer and a purchase they have already decided to
make*. Every field is an obstacle. A plausible number removes the obstacle. That is maximum
falsification pressure applied to precisely the lookup questions (Q2 numbers, Q5, Q6, Q7) where a
wrong answer is most consequential.

Post-payment, the obstacle is gone. The customer has bought a proposal and now wants it to be good.
The incentive flips from *get past this* to *get this right*. Same questions, opposite pressure.

So the pre-payment placement is not merely a conversion cost. **It degrades the quality of the
answers on the exact questions where quality matters most.** Placement is an evidence-integrity
decision, not only a funnel decision.

---

## 3. Three ways the design lets a false fact into the ledger

These are not conversion complaints. They are grounding failures, and they are why the verdict is
NEEDS_WORK rather than SOUND.

### 3.1 The plan cache leaks one customer's proper nouns into another customer's form

§2 commits to wording that is *"generated per grant and per applicant"*, and makes the recognition
effect the whole argument for the generated layer: *"Your site mentions the Growing Together
allotment — where is it, and when did it start?"*

§2 then says plans are **cached by grant fingerprint**, and §6's DDL confirms it:
`intake_question_plans` is uniquely keyed on `(grant_key, spine_version)`, with `org_hint_domain`
stored as a *column on the shared row*, not as part of the key. So the second customer applying to
the same grant is served the first customer's plan — including the first customer's programme name,
in the question text.

Two failures, one of them serious:

- **Confidentiality.** Charity B is shown Charity A's programme name. In a sector where everyone
  knows everyone, that is a trust-ending moment and it is visible.
- **Grounding.** The design's safety argument for the micro-crawl is: *"A wrong-organisation site
  can therefore only produce a question the customer ignores — never a borrowed fact."* The cache
  breaks the premise. People do not ignore confident questions; they accommodate them. A question
  naming another organisation's allotment, asked of a similar organisation, gets an answer — and
  that answer becomes an `E-ASK` item. That is a live path by which org A's proper noun shapes org
  B's Evidence Ledger. The asymmetric identity gate exists precisely to prevent this class of
  event, and this route goes around it, before payment, where the gate does not run.

*Fix, cheap:* cache only the **grant-derived** half of the plan (slot selection, donor-language
rewording, the Q0 eligibility probes — none of which is applicant-specific), and apply the
applicant-noun personalisation per request from that request's own micro-crawl, never persisted.
The cache then does its actual job (avoiding the repeated grant analysis) with none of the leakage.

### 3.2 Required fields with escapes shaped for one kind of organisation force false answers

**Q1 `since` is required**, and its only non-date option is *"not started yet"*, which maps to
`status: asserted_planned`. A lunch club running since "sometime in the 2000s, before my time" has
no true answer available. The fundraiser must either invent a month-year or tick "not started yet"
— and that tick tells the whole downstream pipeline that a fifteen-year-old programme is a
**future design element that may never be cited as track record** (§4.3). The system has recorded a
false fact about the applicant and will faithfully classify it, audit it, and write to it.

**Q1's escape has the same shape problem.** *"We don't have a fixed location yet"* is written for a
startup. A national helpline, an online tutoring service, a peripatetic outreach team and a
grant-making body are all forced into a checkbox whose word "yet" is false for them, which then
pushes them toward the **empty** band in §8.

The pattern in both: the escape encodes an assumption about what kind of organisation is applying,
and any organisation outside that assumption must assert something untrue to proceed. A required
field with no "we don't know" option does not produce missing data — it produces wrong data, which
is worse, because missing data is visible to the degradation logic in §8 and wrong data is not.

*Fix:* every required field gets a first-class *"we don't know / doesn't apply"* value that maps to
an explicit `unknown` (not to `asserted_planned`, and not to a band demotion), and Q1's escape
splits into "no fixed location", "we work online", "we work across a wide area".

### 3.3 The basis dropdown

Covered at §2.2(b). Same class: a UI affordance converts a guess into a stated methodology, and
§4.3's prose rules reward it.

---

## 4. What the deep crawl already answers — the redundancy the cut list misses

The sibling design `design-deep-crawl.md` is being built on the same track. Its extraction prompt
(§8.2) types items as
`org_fact | programme | location | venue | partner | funder | funding | result | person | asset |
cost | policy | accreditation | beneficiary_count | schedule | governance`,
with entity buckets for `people`, `orgs`, `places`, `venues`, `programmes`, `money`, `dates`, a
verbatim quote-anchor check (§8.3), and — the important part — **PDF reading of annual reports and
accounts**, at depth 3, with a probe list that explicitly targets `/annual-report`, `/accounts`,
`/impact` (§3.1).

Set that against the interview slots:

| Slot | Deep crawl coverage | Judgement |
|---|---|---|
| Q1 `sites` (place, venue) | `location`, `venue`, `place` entities — contact and programme pages are the most reliably crawlable thing on a charity site | **High overlap** for orgs with a real site; the *`since` date per site* is the part the crawl usually misses |
| Q2 `last_delivery` | `result`, `beneficiary_count` with `date_context` — impact reports carry dated cohort numbers | **Partial**; "the last thing you finished" and its honest ending is the least reliably published fact and the highest-value one |
| Q3 `people` | `person` + `entities.people`; team pages are near-universal | **High overlap** on *who exists*. Zero overlap on *who will run this project and are they in post* |
| Q4 `partners` | `partner`, `funder`; partner logo walls are standard | **High overlap** on *who they work with*. Zero overlap on *the status of a partnership for this bid* |
| Q5 `unit_costs` | `cost`, `value.n/currency` — real unit prices are almost never published | **Low overlap. Keep.** |
| Q6 `finances` | `funding`, and the accounts PDF is the crawl's top-ranked target (`URL_VALUE` 26, its highest score) | **Highest overlap in the set**, and the crawled version is *strictly better*: audited, dated, quote-anchored, attributable |
| Q7 `reach` | `beneficiary_count` — "we support 1,200 people a year" is on the homepage of nearly every charity | **High overlap. Cut.** |
| Q8 `local_trigger` | not publishable, not published | **No overlap. Keep — cheapest, highest yield.** |
| Q9 `limits` | not published | No overlap |
| Q10 `named_things` | `accreditation`, `asset` — accreditations are badged on sites | **High overlap. Cut** (design already cuts it first) |
| Q0 probes | not crawlable | **No overlap. Keep** — it is the only slot that prevents a *late blocking* failure |

The design's own §12 concedes Q6 is *"partly recoverable from a crawled annual report once PDF
reading exists"* — while PDF reading is being designed in parallel, in the same directory, this
week. **The cut list is stale against its own sibling.** Q6 and Q7 should not be cut fifth and
third; they should not be in the pre-payment set at all.

### 4.1 The sequencing bind, and what it actually implies

Here is the structural point. The crawl runs in the `org` stage, **after payment**. The design
acknowledges this (§2: *"the crawl the brief assumes is available pre-payment is not"*) and responds
by giving the plan a 3-fetch micro-crawl for phrasing only.

That response solves personalisation and leaves the real problem untouched: **pre-payment, you
cannot know which questions the crawl will answer, so you must ask all of them blind.**
Post-payment, after the crawl, you know exactly which facts are missing and can ask only those.

For an organisation with a decent website and an annual report on it, the post-crawl gap set is
plausibly two or three questions — Q5 unit costs, Q4 status, Q8 trigger — because the crawl has
already produced venues, people, partners, income and reach with verbatim quotes and page
locators. For an organisation with a one-page site, the gap set is the whole interview, and that
customer has already paid, so asking them ten questions is fine.

**The interview and the crawl are the same evidence budget spent twice.** Asking pre-payment is the
only placement that guarantees the duplication, and it duplicates most for the customers whose
sites are richest — i.e. the more established organisations, who are also the ones with the money.

---

## 5. The smallest set that still fixes the proper-noun failure

The critics' complaint was four-part: *no place names, vendors, staff CVs, or prior results*.

**Keep, pre-payment — 3 slots plus probes:**

1. **Q0 `eligibility_probe` (0–2, generated).** ~15 s. Not a proper-noun fix; it is the only slot
   that converts a late `donor_required_certification` deadlock into a pre-payment question. Cheapest
   item in the document. Keep unconditionally.
2. **Q1 `sites`, one row, three fields** — `place`, `venue`, `what_happens`. Drop `since` from
   required to optional with a real "don't know" (§3.2). Cap the repeater at 1 row pre-payment;
   further rows post-payment. ~60 s. **Fixes: place names.**
3. **Q2 `last_delivery`, restructured to two fields pre-payment** — `what` and `when`. Move
   `how_many_started` / `how_many_finished` / `how_counted` / `result` **post-payment**: they are the
   lookup fields, they carry the falsification risk, and they are the fields whose accuracy the
   post-payment incentive flip actually improves. ~45 s. **Fixes: prior results (the named project;
   the numbers arrive later).**
4. **Q8 `local_trigger`.** One line. ~60 s. **Fixes: swappability** — it is the only input that can
   particularise an opening and a problem statement, and it is not obtainable from any crawl.

**Total pre-payment: 3 cards + probes, ~9 controls, 2.5–3 minutes.** One screen, no lookups, no
numbers, nothing a fundraiser cannot answer from memory while sitting still.

**Move post-payment, onto `order.html` (which already hosts an interactive form — the revision UI
at `order.html:146-160` — so the surface exists):** Q2's numbers, Q3 `people` reframed to *"who runs
this, and are they already in post"*, Q4 `partners` reframed to *"for this project, who and how
firm"*, Q5 `unit_costs`, Q9 `limits`.

**Cut entirely:** Q6 `finances` (the crawl reads the accounts better than the customer remembers
them), Q7 `reach` (homepage boilerplate, and it overlaps Q2), Q10 `named_things` (badged on sites).

### 5.1 Does the floor still fix the failure?

Yes, and the arithmetic is worth stating because "proper nouns" are not fungible.

Today: **1** real-world proper noun in the intake ledger (the org's own name; `E-INTAKE-2` is a
token, `E-INTAKE-3` is the same name as a URL).

The three-slot floor yields, per order: a venue and a place (2, and they are *load-bearing* — a
named venue in a named neighbourhood recurs through a needs statement, a delivery plan and a
capability section, so 2 nouns produce a dozen concrete sentences), a named prior project (1),
one or two nouns in the trigger line — a named estate, a closed service, a named referrer (1–2).
**Call it 5–6 distinct nouns, all specific to this applicant, none swappable.** Combined with the
deep crawl's 10–30 quote-anchored items, that clears the critics' bar comfortably.

The full eleven-slot set adds perhaps 6–12 more (partner names, staff names, a prior funder, an
accreditation) at the cost of 12–15 extra minutes and every falsification path in §2.2. **The
marginal noun is not worth the marginal minute past the floor** — and it is worth less still when
the crawl is producing the same nouns from documents with page locators.

One condition on all of this: **none of it survives without §4.4.** If the correction loop is left
as-is, the first correction round strips `E-ASK`-derived material as unsupported additions
(`worker:1723-1737`) and the yield is near zero. §4.4 is not an integration detail, it is a
precondition.

I would also add a runtime check the design only proposes for testing: §11.3 counts proper nouns
deterministically in evaluation. **Do it per order, at `check`**, as a delivery-gate warning — if a
customer answered Q1 and their venue name appears nowhere in the narrative, the interview did not
work for that order and we should know before the email goes out, not from a quality review three
weeks later. That is free, deterministic, and it is a better drift signal than the answered-slot
count in §11.5.

---

## 6. Pre-payment or post-payment — the owner should hear the counter-case

The owner decided pre-payment. I will not pretend to agree.

### 6.1 The case against pre-payment, stated plainly

1. **The asymmetry is enormous and one-directional.** A question before the card risks the entire
   order value ($149–$449). A question after the card risks some answers on an order already paid.
   At an unknown baseline conversion — and §9 is admirably honest that **nobody knows it, because
   `save-intake` is called once from `pay()` and an abandoner leaves no row at all** — loading 15
   minutes onto the unmeasured pre-payment path is the highest-variance change available.
2. **It contradicts the positioning the price rests on.** The product promises a proposal in 5–30
   minutes to someone against a deadline. A 15-minute form in front of a 5-minute product is felt
   immediately.
3. **It maximises falsification pressure on the lookup questions** (§2.3). This is the argument I
   would lead with, because it is not a marketing preference — it is an evidence-quality claim, and
   it points the same way as the conversion claim.
4. **It forces asking blind.** Post-crawl, the question set is gap-targeted and roughly half as long
   for exactly the customers whose sites are richest (§4.1).
5. **The design already concedes post-payment collection works.** §8's recovery path is: the
   delivery email names the questions that would change the document and links to the existing
   revision flow with slots pre-loaded. If answering after payment is good enough to *repair* a thin
   proposal, it is good enough to *prevent* one. The document uses post-payment collection as its
   safety net while arguing that collection must be pre-payment.
6. **That recovery path has a cost the design does not mention.** `REV_CAPS` is
   `{ trial: 1, draft: 1, competitive: 3, full: 10 }` (`stripe-webhook:54`). On a Draft order — the
   $149 volume tier — the recovery path **spends the customer's only included revision** fixing a
   gap our own form created. That is not a feature, it is a charge.

### 6.2 The case for pre-payment, which is real

- **No human in the loop means no chaser.** If the customer never answers post-payment, we have
  taken money and owe a proposal built on nothing. Pre-payment guarantees the evidence exists
  before the obligation does. This is the strongest argument for the owner's position and it is a
  good one.
- **Post-payment introduces a wait state** the architecture does not have. The pipeline starts on
  the Stripe webhook and runs strictly sequential stages under a 3-minute reaper. Blocking on
  customer input needs an `awaiting_interview` order state, a timeout, and a proceed-without path.
  Small, but real, and it lands on top of P0 #3 (Competitive/Full not completing) — which is the
  wrong week to add states to the queue.
- **Qualification.** A form asking operational questions filters unserious buyers. Though at these
  prices with fully automated fulfilment, volume is the friend, not the filter.

### 6.3 What I would actually do

**Split by lookup, not by importance.** Pre-payment: the four recall-only items in §5 — Q0, Q1 one
row, Q2's `what`/`when`, Q8. Under three minutes, no numbers, no documents, and it captures the
biggest single gap (place names) before any money moves. A customer who will not spend three
minutes was not going to spend $299.

Post-payment, on `order.html`, gap-targeted after the crawl, with a hard timeout (say 45 minutes,
or the deadline, whichever is sooner) after which the pipeline proceeds with the honest degradation
in §8: everything requiring a lookup. **Not** via the revision flow — that spends `REV_CAPS` — but
as a first-class "your proposal is being written; these three answers will change it" panel, which
is also the best moment this business will ever have to ask, because the customer is committed,
motivated, and watching a progress page anyway.

That preserves the owner's instinct (evidence before obligation) for the facts that matter most,
removes the 15-minute pre-payment wall, and asks the numeric questions at the moment the customer
has an incentive to get them right instead of an incentive to get past them.

**And ship the funnel instrumentation first, alone.** §7.4's step-advance upserts plus the
`step_reached` index are a prerequisite for having this argument with data rather than with
opinions. Two weeks of baseline before the questions land is worth more than either side of this
debate. The design says this itself and then buries it in §9; it should be the first paragraph.

---

## 7. Business-side issues the design does not raise at all

### 7.1 No privacy notice exists, and this design adds personal data of non-customers

I grepped `index.html` for `privacy|terms|gdpr|consent|data protection`. **Zero matches.** There is
no privacy notice, no terms link, no consent checkbox anywhere in the wizard today.

Onto that, the design adds:

- **Q3 `people`** — named individuals with `role` and `background`, entered by a *colleague*, about
  a person who does not know it is happening. Personal data. It goes into an OpenRouter prompt (a
  third-party processor, US-based) and into a document sent to a donor.
- **Q4 `partners`** — named third parties and their commitments, again entered by someone else.
- **§6's DDL** — `contact_name` and `whatsapp` added to `pre_intakes`, combined with §7.4's
  **step-advance upsert**, which persists name, email, WhatsApp number and organisation for
  **every wizard that reaches step 1, including everyone who abandons and never pays.** Today
  `save-intake` fires once from `pay()`, so an abandoner leaves nothing. The design turns that into
  a stored contact list of non-customers, as a side effect of funnel measurement.

None of this is unlawful on its face — an abandoned-basket legitimate interest is arguable — but
there is no notice, no lawful basis recorded, and no retention rule for the `interview` jsonb or the
abandoner rows. The customer base is UK/EU charities (the design's own examples are Peckham and
sterling), who are themselves data controllers and are asked about this in their own funding
applications. It is a cheap fix now (a notice at step 1, a retention job on `pre_intakes`, an
explicit line about staff names in Q3) and an expensive one after the first customer asks.

### 7.2 The interview is not tiered, which throws away the obvious conversion answer

The same 8-card step is proposed for the $1 trial and the $449 Full. The natural move is the one the
pricing already implies: the three-slot floor on Trial and Draft; the longer post-payment gap
interview on Competitive and Full, where the customer has paid more, expects more involvement, and
`REV_CAPS` already gives them 3–10 rounds. This directly answers the conversion objection at the
volume tier while spending the customer's time where it is worth most. The design does not consider
tiering once.

### 7.3 Asking raises the expectation bar irreversibly

Today the output is generic and nobody notices, because nobody told us anything. After a customer
spends fifteen minutes naming their venue, their partner and their unit costs, **they will read the
proposal looking for those things.** If the §4.4 correction loop strips them, or the generator
simply does not use them, the failure moves from invisible to obvious and lands in the inbox. This
is a real business risk of shipping the interview *before* the §4.4 fix and the runtime proper-noun
check in §5.1 — and it argues for shipping the smaller set, well used, rather than the larger set,
partly used.

### 7.4 The "what we could not evidence" note is in the wrong container

§8's empty band adds *"a one-page 'what we could not evidence' note in the delivered package"*. The
delivered package is the thing the customer forwards to a donor. A page explaining that the
application is unevidenced, sitting in the same zip as the application, will eventually be attached
to a submission. Put it in the delivery email and on `order.html`. Never in the package.

### 7.5 A pre-payment model call and micro-crawl for every visitor

§10 is honest that the plan call fires for **every wizard reaching step 2, including non-buyers**,
at ≤$0.01. Fine on cost. Less fine as a surface: `analyze-grant` runs `verify_jwt = false` and is
rate-limited at 15 per 10 minutes per IP (`analyze-grant:31`), and the design gives it a second,
differently-shaped, user-supplied fetch target (`org` + `website`) for the micro-crawl. The existing
function already fetches a user URL, so the class of exposure exists — but this makes an
unauthenticated, IP-rate-limited endpoint into a crawl-on-demand for arbitrary hostnames. It stays
inside `safeFetchText`'s SSRF guards, so this is a note rather than a blocker, but it deserves its
own rate-limit key rather than sharing `analyze:${ip}` with the grant analysis a legitimate customer
also needs.

### 7.6 Internal inconsistencies a customer would notice

- §0 promises *"Two required questions and up to eight optional ones"* (10 cards). §3's shown-set
  rule caps the step at **8 cards including the two required** (so 6 optional). These contradict.
- §9's proposed subhead says *"Six questions."* The step shows up to eight. Saying six and showing
  eight, at the exact moment you are asking for trust, is a small self-inflicted wound.
- §9 states the wizard goes *"from three required fields to five."* Today's `validate()` requires
  **four** (`index.html:721-727`). The new floor requires those four **plus** Q1's `place`,
  `what_happens`, `since` and Q2's `what`, `when` — **nine**. In the section whose title is
  "Conversion risk, plainly", the ask is understated by roughly half.

---

## 8. Verdict

**NEEDS_WORK.** Not BROKEN: the diagnosis is correct and verified, the ledger schema is right, the
code-not-model rendering is right, §4.4 and §4.6 are insights that would not have survived a less
careful reading of the worker. Not SOUND: three paths let a false fact into the ledger (the shared
plan cache, the forced-choice escapes, the basis dropdown), the cut list is stale against the
sibling crawl design, the time cost is understated by a factor of five at the floor and never
stated at all for the full form, and the pre-payment placement is defended on conversion grounds
without engaging the stronger objection — that it is where customers are most motivated to guess.

Ship the three-slot floor pre-payment, the lookup questions post-payment and gap-targeted, the
funnel instrumentation first and alone, and §4.4 before either.
