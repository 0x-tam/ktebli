# The Magpie Project — public-materials intake provenance

Applicant: **The Magpie Project** (themagpieproject.org), charity 1176267 — supports mothers and
children under five in temporary/insecure accommodation in Newham, East London.

Rule applied: every recorded fact traces to a specific page that was actually fetched (URL below).
Where a value could not be found on a fetched page, it is left blank/`null` and listed under
"What the applicant would realistically have to supply themselves." Nothing is invented.

## Fetched sources (what each one is)

| # | Source URL | Type | Fetched OK? |
|---|------------|------|-------------|
| S1 | https://themagpieproject.org (home) | Own site | Yes |
| S2 | https://themagpieproject.org/about/ | Own site — "What we do" | Yes |
| S3 | https://themagpieproject.org/contact/ | Own site — "Who we are" (team/trustees) | Yes |
| S4 | https://themagpieproject.org/our-work-our-plans/ | Own site — partners & plans | Yes |
| S5 | https://themagpieproject.org/our-funders-and-supporters/ | Own site — funders | Yes |
| S6 | https://themagpieproject.org/latest-news/ | Own site — news | Yes |
| S7 | https://themagpieproject.org/media-and-press/ | Own site — press list | Yes |
| S8 | https://themagpieproject.org/home-2/ | Own site — landing | Yes |
| S9 | https://themagpieproject.org/wp-content/uploads/2021/03/Annual-accounts-2019-20.pdf | **Primary** — Trustees' Annual Report, period 01 Jul 2018 – 30 Jun 2019 (file is labelled 2019-20 but content is the 2018-19 report) | Yes (PDF, text extracted) |
| S10 | https://www.nesta.org.uk/feature/new-radicals-2018/magpie-project/ | Third-party (Nesta, 2018) | Yes |
| S11 | https://charici.org/the-magpie-project | Third-party aggregator of Charity Commission data | Yes |
| X1 | https://register-of-charities.charitycommission.gov.uk/... (detail, full-print, financial-history, Giving is Great) | Primary register | **BLOCKED — HTTP 403 to the fetch tool on every path/host variant** |
| X2 | https://findthatcharity.uk, https://charitybase.uk, https://opencharities.org | Aggregators | **Failed (socket hang up / 404 / DNS timeout)** |

## Fact → source

| Fact recorded | Value | Source |
|---|---|---|
| org_name | The Magpie Project | S1, S3, register title (via search) |
| registration_number | 1176267 | S1, S2, S3 (shown on every page footer) |
| legal_form | Charitable Incorporated Organisation (CIO) | **S9 primary** ("How the charity is constituted: Charitable Incorporated Organisation (CIO)"); corroborated S11 |
| accounts_period | Financial year end 31 August | S11 ("financial year ending 31st Aug 2025"); note S9 primary used an older 30 June year-end that has since changed |
| site_place | Newham (Stratford, E15) | S2, S8 |
| site_venue | Grassroots Centre, Memorial Park, Memorial Avenue, London E15 3DB | S1, S2, S3, S8 |
| site_activity | Weekly stay-and-play + baby bank + meals + on-site advice | S2 (services list), S4 (Shelter/health visitors/children's centre) |
| last_delivery_what/when | 'Help and Hope on Hold' SEND report launch, 6 July 2026 | S6 |
| local_trigger | ~2,000 under-fives in temporary accommodation in Newham | S10 |
| lived_experience_governance | Magpie Mums (former service users) on REACH team + steering committee; some volunteer, one employed | S3, S8 |
| board_independent = true | Independent volunteer board of external professionals, none remunerated | S3 (7 named external trustees); S9 primary ("No trustees receive any remuneration") |
| key_people (staff + trustees) | 15 named with roles | S3 (all); Amy Ross cross-confirmed by S9 primary (listed as Chair, 2018-19) |
| programmes | Stay-and-play, REACH, Story Sandwich, Newham Nurture, Kitchen campaign, Graduation, FCA guide | S2, S3, S4, S8 |
| results (dated) | See magpie.json — Year-1 184 mums/~210 pre-schoolers | S10 |
| results (dated) | 32 rehoused / 32 immigration review / 21 right-to-remain / 68 new Shelter families / >£80k in-kind, year to 30 Jun 2019 | **S9 primary** |
| results | "at least 100 families" with Shelter advisers since start; 8 section-17 complaints all upheld | S4 |
| results | Homeless Link "Excellence in Supporting People" award | S2 |
| partnerships | Shelter, Newham Health Visitors, Newham Children's Centres, London Black Women's Project, Discover, NCT/Alternatives Trust/Compost, Praxis, UCL Law, Project 17, Hackney Migrant Centre, Queen's Nursing Institute, FCA, Bethany Williams, Fairshare | S2, S4, S9 (Fairshare) |
| extra_links | Own-domain pages + on-site accounts PDF | listed for the crawler |

### Verification catches (why cross-checking mattered)
- The press-page extraction (S7) wrongly implied **Bethany Williams** is the founder. The
  authoritative team page (S3) and primary report (S9) both state the founder/CEO is
  **Jane Williams**; Bethany Williams is a fashion-designer *collaborator* (S4). Recorded correctly.
- **Amy Ross** appears both as a current trustee (S3) and as Chair in the 2018-19 primary report
  (S9) — this cross-source match is strong evidence the S3 team-page extraction is faithful, not
  confabulated. Name spellings on S3 should still be confirmed by the applicant before use in a bid.

## Income — deliberately left blank (not invented)

The primary source of record (Charity Commission register) returned **HTTP 403 on every path and
host variant** (detail page, full-print, financial-history, and the Commission's own "Giving is
Great" factsheet), so no primary income figure could be fetched. The figures that surfaced conflict
and could not be reconciled from a fetched, corroborated page:

- **£68,803 gross income / £93,844 total receipts**, year to **30 Jun 2019** — the only figure from
  a **primary fetched document** (S9), but 7 years stale and unrepresentative of current scale.
- **£429,907** income, £446,580 expenditure, FYE **31 Aug 2023** — from a Google/Bing *synthesis* of
  the register's Trustees' Annual Report; **not** a page I fetched.
- **~£457,130** ("£457.13k"), FYE **31 Aug 2024** — from a search synthesis of the register's
  financial-history page; **not** a page I fetched.
- **£625,512** income, £564,278 expenditure, FYE **31 Aug 2025** — from a **fetched** aggregator
  (S11), but a targeted search for that exact figure returned nothing, and it conflicts with the
  2024-latest picture above; it straddles a band boundary, so `income_band` is also left blank.

Because a wrong figure is worse than a blank one, `annual_income` and `income_band` are left empty.
All sources agree only on order of magnitude (mid-six-figures, growing). The applicant must supply
the latest audited figure.

## What the applicant would realistically have to supply themselves

These are not public (or not verifiable from a fetched primary page) and must come from the charity:

- **Latest audited annual income / expenditure and the exact accounts period** (see above — register
  was 403-blocked; aggregators conflict). Applicant to give the figure from their own filed accounts.
- **Safeguarding policy in force, and the safeguarding lead's name, role and training** — not public
  on the fetched pages (`safeguarding_policy: null`, lead fields blank).
- **Bank account held in the charity's own name** — internal admin fact, not public (`null`).
- **Public liability insurance in place** — internal admin fact, not public (`null`).
- **Confirmation of no conflicting/duplicate grant for the same activity** — cannot be known from
  public pages (`no_conflicting_grant: null`).
- **Confirmation of current trustee roster and exact name spellings** — team page (S3) gives a
  current list, but the register (which is authoritative for trustees) could not be fetched.
- **Current-year impact numbers** (families/mums/children supported this year) — the fetched pages
  publish qualitative results and older annual-report figures, but no current headline count.

## Research time

~10 minutes of active research (2026-09-01, ~15:30–15:40), ~15 fetch/search calls. Time lost to the
Charity Commission register 403-blocking the fetch tool on every path; routed around it with the
org's own on-site primary PDF, the Nesta feature, and one aggregator, and left income blank rather
than record an unverifiable number.
