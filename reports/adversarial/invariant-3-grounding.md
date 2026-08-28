# Adversarial round 2 — Invariant 3 (grounding): **BROKEN**

**Invariant 3.** Nothing is asserted that the Evidence Ledger does not carry. Facts
trace to the order form (`E-INTAKE-n`), the crawled site (`E-WEB-n`), or an uploaded
past proposal (`E-PROP-n`). Provenance is never manufactured; another organisation's
achievements are never attributed to the applicant; the identity gate is asymmetric
(discards good evidence rather than admit a stranger's).

**Verdict: BROKEN.** Three independent, deterministic routes place a fact no ledger
item supports into a document the pipeline's deterministic auditors pass. All three
are reproduced by `tests/adversarial/adv2_grounding_test.ts` (14 failing assertions,
4 passing controls; `npx --yes deno@2.9.5 run --allow-read tests/adversarial/adv2_grounding_test.ts`).
No model generation was required — every break is a pure-function property, confirmed
by direct calls into the deployed modules. Model budget spent: **$0.00**.

Round 1 (`fabricated_identity_test.ts`) closed the *shapes* it enumerated. Each route
below is the same failure class round 1 fought — "position, vocabulary, or wording
must not decide whether a fabrication is visible" — reopened along a shape it did not
enumerate.

---

## Route 1 (flagship) — `contact_claims.ts`: the sole blocking guard misses a fabricated contact detail under a label swap, a separator swap, or an out-of-set TLD

**Why this is the worst of the three.** `contactAudit` is the *only* gate that blocks
a fabricated contact detail. Its own header (lines 14–18) records why: the Claim
Ledger's `donor_required_certification` class is *designed to permit* administrative
self-statements like a phone number, and a phone number is not a proper noun, so
neither the LLM claim ledger (`index.ts:2294`) nor `properNounAudit` guards it. When
`contactAudit` returns `fabricated: []`, nothing else stands between the invented
literal and the delivered `.docx`. This is exactly the `+961 6 380 000` failure the
module exists to prevent.

**The hole.** Detection is anchored two ways and both are closed sets:

- `LABELLED` (lines 75–79) fires only for a label in `LABEL_ALT` (lines 58–66)
  followed by a separator in a closed set `[: ： . — – - |]`. The label list knows
  ~a dozen field names; a donor form asks for a phone under a hundred. **`website`,
  `homepage`, `web`, `online`, `portal`, `url` are not in `LABEL_ALT` at all.**
- `INTL_PHONE` (line 93) requires a leading `+`. Domestic numbers have none.
- `BARE_HOST` (lines 88–89) uses a **closed TLD set** (`org|com|net|ngo|int|edu|gov|
  info|charity|foundation|…`). `.io`, `.ly`, `.me`, `.app`, bare `.uk` are absent.

Confirmed misses against the evidence-poor ledger (no phone, no website):

| Crafted line | `fabricated` | Why it escapes |
|---|---|---|
| `- **Reception:** 06 431 227` | `[]` | `reception` ∉ `LABEL_ALT`; no `+` |
| `\| Enquiries \| 06 431 227 \|` | `[]` | `enquiries` ∉ `LABEL_ALT`; no `+` |
| `- Head office line: 06 431 227` | `[]` | label ∉ list; no `+` |
| `Our WhatsApp is 06 431 227.` | `[]` | listed label, but **word** separator "is" ∉ separator set |
| `Call the coordinator on 06 431 227 …` | `[]` | no label, no `+` |
| `- **Website:** mashghal-project.io` | `[]` | no `website` label; `.io` ∉ TLD set |
| `More detail is published at mashghal-project.io …` | `[]` | bare host, `.io` ∉ TLD set |
| `- Homepage: mashghal.ly` | `[]` | no `homepage` label; `.ly` ∉ TLD set |

Controls (`**Telephone:** +961 6 431 227`, `**Contact number:** 06 431 227`) still
fire, so the module is not simply off — a label/separator/TLD swap is all it takes.

**Fix spec (do not rely on a closed allow-list).**
1. **URL class:** add `web|website|homepage|online|portal|url|site` to `LABEL_ALT`
   with `labelKind → "url"`, and for a *labelled* url value accept **any** TLD
   (the donor's own field name asserts it is a website), comparing whole and within
   the `url` class. Keep `BARE_HOST` for the unlabelled case but widen its TLD set to
   the IANA-common set (or accept any `\.[a-z]{2,24}` guarded by the existing
   `e.g./i.e.` lookbehind).
2. **Separator:** allow a short word gap (`is|on|at|—|:` …) between a *known* label
   and its value, so `WhatsApp is 06 431 227` is read.
3. **Domestic phone:** the guard must not depend on a leading `+`. Detect a
   phone-shaped run (7–15 digits with phone-style grouping/separators) as an
   unlabelled `telephone` claim, excluded only when it is a bare 4-digit year or sits
   in an explicitly numeric context (budget/beneficiary count). The asymmetry the
   module already argues for (BLOCKING, "no legitimate reason to state a contact
   detail no evidence carries") means ambiguity here should resolve toward flagging.

---

## Route 2 — `proper_nouns.ts`: the self-naming exemption swallows a fabrication that embeds the applicant's own name

**The hole.** `properNounAudit` skips a run it reads as the applicant naming itself
(`index.ts` calls it at `2283`; the module at `proper_nouns.ts:247`):

```ts
if (own.has(n) || ownKeys.some((o) => pnOverlap(key, o) || [...o].every((w) => key.has(w)))) continue;
```

Both `pnOverlap(key, o)` and `[...o].every((w) => key.has(w))` are true whenever the
run's token set is a **superset** of the applicant's name — i.e. the run contains the
whole org name *plus arbitrary extra tokens*. The extra tokens are the fabrication,
and the `continue` drops the whole run before it is ever checked against the ledger.
The run is neither reported as `unsourced` nor counted as `used`; it vanishes.

Confirmed against org `Mashghal Community Association`:

| Crafted sentence | `unsourced` | The invented fact it hides |
|---|---|---|
| `… the Mashghal Community Association Excellence Prize honoured our work.` | `[]` | an award that does not exist |
| `Delivery is underwritten by the Mashghal Community Association Endowment …` | `[]` | a fund that does not exist |
| `Our flagship Golden Cedar Mashghal Community Association Fellowship …` | `[]` | **fabricated tokens wrapped around the name** (`Golden Cedar`, `Fellowship`) |

Control `the Beirut Civic Excellence Award` (no name embedding) is correctly reported.

The module's docstring (lines 36–42, 166–177) insists containment must run **one way**
— "the document may say no more than the ledger says" — and fixed exactly this class
for the ledger comparison. The self-naming exemption at line 247 is the one place it
still runs the permissive two-way/superset way, and the comment at 244–247 explicitly
(and wrongly) defends it.

**Impact and honest scoping.** `unsourced` proper nouns are **advisory** at every
wiring site (`index.ts:2344–2352`, `delivery_gate.ts:320–322`) — by deliberate design,
because a legitimately named *new* project reads as unsourced to a string matcher. So
this route's immediate cost is not an instant delivery: it is that (a) the correction
loop is never steered to remove the fabrication, so it survives every rewrite round,
and (b) it re-opens the precise defect class round 1 was accepted for closing —
`fabricated_identity_test.ts` asserts the auditor must *surface* an invented
partner/award/person regardless of where it sits; here it fails to surface one keyed
on the applicant's own words. It also silently corrupts the `used`/`ledger_offers`
denominator that D4 (`delivery_gate.ts:322–329`) does block on.

**Fix spec.** The self-naming exemption must subtract the applicant-name tokens and
audit the **remainder**, never exonerate a whole run because it contains the name.
Concretely: skip only when `pnContains(key, ownKey)` (the run says no more than the
name); when `key ⊋ ownKey`, remove the own-name tokens and re-audit the residual
tokens against the ledger and design names — report the residual/phrase if it is
non-empty and unsupported. This keeps the defended case honest:
`Mashghal Community Association In Bab al-Tabbaneh` leaves residual `{bab, tabbaneh}`,
which `pnContains` matches against the ledger's `Bab al-Tabbaneh` and clears, while
`… Excellence Prize` leaves `{excellence, prize}` and is reported.

---

## Route 3 — `orgNameMatchesSite`: a near-match imports a stranger's entire website

**The hole** (`index.ts:431–443`, unchanged from the version the gate was born in).
The gate admits a crawled site on **any single shared non-generic token** between the
applicant name and the site's legal name, **or** on a distinctive applicant token
appearing as a bare **substring** of the domain host (`host.includes(t)`, line 441).
Once admitted, the site's `E-WEB-*` evidence enters `allowedEvidence` with
`allowed: true` (`index.ts:1786` keeps it on a match) and is thereafter the applicant's
own supported history — the one thing the gate exists to prevent (its own comment,
`index.ts` ≈416–443: "attributing another organisation's credentials to an applicant
is worse than inventing them").

Confirmed:

| Applicant | Crawled site (unrelated real entity) | Domain | Admitted? | Why |
|---|---|---|---|---|
| Grace Kitchen | W. R. Grace and Company (chemicals multinational) | grace.com | **yes** | shared word `grace` |
| Bright Futures Youth Club | Bright Horizons Family Solutions (childcare corp) | brighthorizons.com | **yes** | shared word `bright` |
| Community Arts Reach | Smarts Data Analytics Limited (**zero** name overlap) | smartsdata.io | **yes** | `"smartsdataio".includes("arts")` |

Control — the B1 case the gate was built for (`Beit Al-Shabab Community Association`
vs `Amel Association International`, zero shared distinctive tokens) — is correctly
rejected. The gate closes wholesale mismatch; it does not close near-match. Its comment
promises "anything short of a confident match rejects the site", but one ordinary
English word, or a coincidental infix, is treated as a confident match.

**Fix spec.**
1. **Name match:** a single shared token is not a confident match. Require the shared
   distinctive tokens to *cover most of the applicant's* distinctive tokens (e.g. all
   but one, or a Jaccard over distinctive tokens above a threshold). A lone `grace` /
   `bright` / `hope` must not clear.
2. **Domain match:** replace `host.includes(t)` with **whole-token** matching — split
   the host on delimiters and on the registrable label, and require the applicant
   token to be a full host label (or bounded by non-alphanumerics), so `arts` does not
   match inside `smarts`.
3. Because the gate is asymmetric by design, a single-common-token or infix-only
   signal is ambiguous and must resolve to **reject**.

---

## Conceded — routes probed that held

- **Registration-number digit-substring trick (round 1's find): CLOSED.**
  `contactAudit` now compares whole-literal **and within class** (`KIND_CLASS`,
  `contact_claims.ts:122–132, 209–214`). An invented `Account number: 14872019` is a
  `bank`-class literal and cannot be cleared by the `registration`-class ledger item
  `1487/2019`. Re-examined; holds.
- **Multi-word invented partner inside a markdown table cell: CLOSED.** `properNounRuns`
  terminates each cell on its own line (`proper_nouns.ts:104–107`); `Cedar Valley Trust`
  in a partner table is reported. Verified.
- **Deniability-softening ("we expect to partner with…"): out of deterministic reach.**
  Narrative claims of that shape are classified by the LLM Claim Ledger
  (`index.ts:2294–2314`), not by a deterministic auditor, and `model_proposed_future`
  is a legitimate class for genuine future design. There is no deterministic function
  to break here; it is a model-judgement surface, not a pure-function one.
- **A fabricated number whose digits sit inside a ledger string (lead, not a confirmed
  grounding break):** `evidenceNums` (`index.ts:1586–1592`) adds *every* digit run from
  *every* ledger claim to a set that then **exempts** any matching figure from the
  numeric-contradiction scan (`consistencyFindings`, ≈`307–336`). A fabricated
  participant total equal to a digit-run inside the registration number would dodge
  that contradiction check. But that checker guards internal *arithmetic consistency*,
  not provenance — it asserts no new fact — so it is a numeric-register weakness, not an
  Invariant-3 break. Flagged for the numeric-register owner, not claimed here.

## Known in-code tradeoff worth revisiting (not counted among the three)

A **single-word** invented entity placed only at a line start / bullet / table cell —
`\| Location \| Aleppo \|`, `- Principal funder: Chevron` — is not reported
(`proper_nouns.ts:267–273`), because single capitalised words at line starts are column
labels ("Partner", "Role"). This is acknowledged in-code as an accepted cost, unlike
routes 1–3, but it is a live route for a single-token invented place or funder and the
comment underestimates it: `Aleppo`, `Chevron`, `Rotary` are facts, not furniture.
Recommend re-scoping once routes 1–3 land (e.g. audit single-word line-start tokens
that are not the run's column *header* position).

---

## Reproduction

```
npx --yes deno@2.9.5 run --allow-read tests/adversarial/adv2_grounding_test.ts
# → 14 FAILURE(S); exit 1. Controls (4) pass.
```

The test imports `contactAudit` and `properNounAudit` from the deployed modules and
extracts `orgNameMatchesSite` from `index.ts` at runtime (via a `data:` URL), so it
exercises the shipped source and will go green automatically when the three fixes land.

---

# RE-ATTACK 2026-08-28 (post-fix) — two of three held; one **NEW BREAK**

The three fixes were merged to trunk (`claude/supabase-audit-verify-77v56v`) and I
re-attacked the fixed code in the main checkout. `adv2_grounding_test.ts` is now
**28/28 green** against the deployed modules
(`deno run --allow-read tests/adversarial/adv2_grounding_test.ts`).

**Held (could not re-break):**

- **Route 1 — `contact_claims.ts`, by shape.** Detection no longer depends on the
  label list or a closed TLD set. `PHONE_SHAPE` (`contact_claims.ts:117`) catches
  `Reception: 06 431 227`, `| Enquiries | 06 431 227 |`, `WhatsApp is 06 431 227`,
  and bare `06 431 227` in prose; `BARE_HOST` (`:96`) now accepts any `\.[a-z]{2,24}`
  TLD, catching `mashghal-project.io` / `mashghal.ly`. Re-probed; all block. The
  accepted residual (a space-grouped or separator-less "exotic" number that only the
  LLM ledger would judge) is out of scope per the coordinator and I did not pursue it.
- **Route 2 — `proper_nouns.ts`, self-naming one-way.** Line 250 now exempts a run
  only when `pnContains(key, ownKey)` (the run's tokens are a **subset** of the org
  name). The superset swallow is gone: `Mashghal Community Association Excellence
  Prize`, `… Endowment`, and `Golden Cedar … Fellowship` are all reported again.
  Re-probed; all reported. I found no subset-shaped fabrication (a subset of the org
  name introduces no new referent), and the bounded grammar-reading credit (`:257`)
  still requires the tail to be a real ledger noun.
- **Route 3, single-token identity gate.** `registrableMainLabel()` +
  main-label **equality** kills the single-token substring/subdomain/hyphen/eTLD
  class: `shelter.evil.com`, `shelter-supplies.com`, `mind-games.co.uk`,
  `scope.attacker.io`, `shelterlogic.com`, `mindbodygreen.com`, `scopely.com` all
  reject, while `shelter.org.uk` / `mind.org.uk` still admit. Re-probed; all correct.

## NEW BREAK — `orgNameMatchesSite`, the **multi-token domain branch** (`index.ts:521`)

The single-token fix made the domain branch demand main-label *equality*
(`:507–516`). The **≥2-token** branch was left as it was:

```ts
} else {
  if (host && wantArr.every((t) => host.includes(t)) && wantArr.some((t) => t.length > 3)) return true;
}
```

`host` is the domain with every delimiter stripped
(`domain.replace(/[^a-z0-9]/g, "")`), and each org token is tested with
`host.includes(t)` — a bare **substring** test. This is the exact coincidental-substring
class the single-token branch was fixed to reject, still live whenever the applicant
has two or more distinctive tokens and each is *any substring* of the concatenated
host — across subdomain, hyphen and label boundaries alike. The `mainLabel` is even
computed correctly and then ignored on this path.

A stranger site whose stated legal name shares **zero** distinctive tokens with the
applicant is admitted, and its `E-WEB-*` evidence enters the ledger as the applicant's
own history — precisely the B1 outcome invariant 3 exists to prevent.

Confirmed against the deployed `index.ts` (secure expectation for every row is
**reject**; all four return `true` = admit):

| Applicant | Stranger site (0 shared legal-name tokens) | Domain | `mainLabel` | Admitted? |
|---|---|---|---|---|
| Art Care | SmartCare Inc (health SaaS) | `smartcare.com` | `smartcare` | **yes** — `smartcarecom` ⊇ `art`,`care` |
| Arts Reach Collective | Smarts Outreach Limited (agency) | `smartsoutreach.com` | `smartsoutreach` | **yes** — `sm`**arts**`out`**reach** |
| Arts Reach | Smarts Data Ltd | `reach.smartsdata.io` | `smartsdata` | **yes** — subdomain merged into host |
| Art Care | Smart Care Centre | `smart-carecentre.org` | `smart-carecentre` | **yes** — hyphen merged into host |

Neither `art` nor `care` is a label of `smartcare.com`; both are substrings of the
single label `smartcare`. The applicant is an art-therapy charity; the site is an
unrelated health-tech vendor. The gate imports the vendor's site wholesale.

### Failing case (drop-in for `adv2_grounding_test.ts`, section 3)

```ts
ok(!admits("Art Care", "SmartCare Inc", "smartcare.com"),
  "a two-token org does not admit a stranger site by coincidental substring ('art'+'care' inside 'smartcare')");
ok(!admits("Arts Reach Collective", "Smarts Outreach Limited", "smartsoutreach.com"),
  "two tokens both substrings of an unrelated host ('smartsoutreach') do not admit");
ok(!admits("Arts Reach", "Smarts Data Ltd", "reach.smartsdata.io"),
  "the multi-token branch must not merge a subdomain into the host (reach.smartsdata.io)");
ok(!admits("Art Care", "Smart Care Centre", "smart-carecentre.org"),
  "the multi-token branch must not merge a hyphen component into the host (smart-carecentre.org)");
```

Each fails against trunk today (all four `admits(...)` return `true`).

### Fix spec

Apply the single-token branch's own principle to the multi-token branch: match tokens
against the **registrable main label**, split on label boundaries, never against the
concatenated host by substring. Concretely, replace the `host.includes(t)` test with
one of:

1. Require the main label to be exactly the org tokens joined (any order/permitted
   separator) — `registrableMainLabel(domain)` split on `-` equals `want` as a set —
   so `brightfutures.org`/`bright-futures.org` (main `brightfutures` / `bright-futures`)
   admit the real *Bright Futures*, while `smartcare.com` (main `smartcare`) does not
   admit *Art Care*; **or**
2. At minimum, test `host.includes(t)` only on the **main label** (not the whole
   concatenated host), and require each org token to align to a label/word boundary
   there rather than sit as an arbitrary infix.

Discard-on-doubt, consistent with the rest of the function: a coincidental multi-substring
is ambiguous and must reject.

## Verdict

**BROKEN** — the coordinator's three named fixes each held under re-attack, but the
same function carries an untested sibling path (the ≥2-token domain branch,
`index.ts:521`) that re-admits a stranger's website by coincidental substring. This is
not one of the accepted residuals (it is neither an exotic phone format nor a
single-common-word same-name coincidence): it admits a site whose legal name shares
zero tokens with the applicant. No model spend; deterministic. **$0.00.**
