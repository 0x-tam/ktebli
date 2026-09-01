# Provenance — Nourish Community Foodbank (public-materials intake)

Applicant: **Nourish Community Foodbank Limited**, Tunbridge Wells / south Tonbridge, Kent.
Every recorded fact below traces to a specific page that was actually fetched. Nothing is invented.
Where a fact could not be found on a fetched public page it is left blank/`null` and listed under
"What the applicant would realistically have to supply themselves".

## Sources fetched

- **S1** — Org annual report PDF (year ending 31 March 2025), downloaded and text-extracted with `pdftotext`:
  https://www.nourishcommunityfoodbank.org.uk/wp-content/uploads/Nourish-Annual-Report-2024-2025.pdf
- **S2** — Org website, About Us: https://www.nourishcommunityfoodbank.org.uk/about-us/
- **S3** — Org website, Home: https://www.nourishcommunityfoodbank.org.uk/
- **S4** — Org website, News listing: https://www.nourishcommunityfoodbank.org.uk/news/
- **S5** — Org news item "Nourish appoints new Chair of Trustees and wins Kent Charity Award":
  https://www.nourishcommunityfoodbank.org.uk/news/nourish-annual-review-reports-busiest-year-in-the-charitys-history/
- **S6** — Local press (mytunbridgewells.com), Queen's Award article: https://mytunbridgewells.com/nourish-community-foodbank/
- **S7** — Charity Commission register entry, charity 1154716 (content surfaced via search summary of the
  register page; the page itself returns HTTP 403 to automated fetch):
  https://register-of-charities.charitycommission.gov.uk/charity-details/?regid=1154716&subid=0

## Fact → source

| Fact (as recorded) | Source(s) |
| --- | --- |
| org_name = Nourish Community Foodbank Limited | S1 (cover: "Nourish Community Foodbank Limited is a Registered Limited Company (08303764)…"; accounts style "Nourish Community Food Bank Ltd"), S7 |
| registration_number = 1154716 (charity); company 08303764 | S1 ("Registered Charity Number … 1154716", "Registered Company number 08303764"), S7 |
| legal_form = charitable company limited by guarantee | S1 ("constitutes a limited company, limited by guarantee, as defined by the Companies Act 2006") |
| annual_income = £303,659 | S1 (Statement of Financial Activities, Total income 2025 = £303,659); corroborated by S7 (total income £303,659) |
| income_band = £250,000–£500,000 | Derived from annual_income £303,659 (S1); S1 examiner note confirms "gross income exceeded £250,000" |
| accounts_period = year ending 31 March 2025 | S1 ("Annual Report for the year ending 31st March 2025") |
| Total expenditure £461,798 | S1 (SOFA, Total expenditure 2025 = £461,798); corroborated by S7 |
| site_place = Tunbridge Wells / south Tonbridge, ~300 km2 | S1 ("across the borough of Tunbridge Wells and south Tonbridge … We serve an area of almost 300 km2") |
| site_venue = Unit 5, Kingstanding Way / North Farm Industrial Estate, TN2 3UP (since 2021) | S1 ("Our warehouse on the Tunbridge Wells North Farm Industrial Estate, occupied since 2021"; registered office "Unit 5, Kingstanding Way, Tunbridge Wells, Kent TN2 3UP") |
| site_activity = sort donations, make up parcels, deliver Mon–Fri all year | S1 ("Volunteers prepare food parcels Monday to Friday, every week of the year"; "volunteers receive and sort food donations … and make up food parcels") |
| last_delivery (142,812 meals / 15,868 deliveries / 46% children) | S1 ("year in numbers"; parcel = "three nutritious meals a day for three days"); corroborated by S2 and S3 ("142,000 meals", "15,868 deliveries", "46% are children under 18") |
| local_trigger = cost-of-living crisis; benefits/Universal Credit leading referral reason; fuel-voucher demand up | S1 ("the leading reason for referral was changes to clients' benefits … increase in those identifying Universal Credit"; "demand for fuel vouchers has increased"); S3 ("2 in 5 needed food after a change in their benefits") |
| bank_account_own_name = true | S1 ("Bankers: CAF Bank …; NatWest Bank …; Metro Bank PLC …" — charity's own accounts named) |
| board_independent = true | S1 (14 named unpaid "Volunteer Trustees" with appointments/resignations); S7 ("no trustees receive any remuneration, payments or benefits") |
| key_people — Dawn Stanford (Operations Director) | S1 ("Dawn Stanford, our Operations Director"), S2 |
| key_people — Gina Gifford (Admin Assistant & PA) | S2 |
| key_people — Simon Vincent (Chair) | S1 ("Simon Vincent, Chair of Trustees"), S5 |
| key_people — Richard Williams (Treasurer, appt 1.10.24) | S1 ("Richard Williams – Treasurer (appointed 1.10.24)") |
| key_people — Puranik (Vice-Chair) | S2 (Vice-Chair); S1 (listed as trustee) |
| key_people — Tofts, Roy, Packer, Lowe, Weller, Smith, Conroy, Gwinnell (Trustees) | S1 (Board of Trustees list; Smith noted as former Chair; Gwinnell appointed 1.6.25) |
| programmes — emergency food parcels; self-referral (2024 trial); fuel vouchers; signposting | S1 ("Following a successful 2024 trial, we also offer a self-referral system"; "£104,016 in vouchers"; "More than food" signposting) |
| results — food purchased £106,294; fuel vouchers £104,016 | S1 (year in numbers; "£104,016 in vouchers"); S2 ("£106,294 of food purchased", "£104,016 of fuel vouchers") |
| results — 3,685 clients referred | S1 (year in numbers), S2 |
| results — Kent Charity Award (Use of Volunteers), 5 Sep 2024 | S5 ("The Charity of the Year Award – Use of Volunteers"; event "Thursday, 5 September" 2024) |
| results — Queen's Award for Voluntary Service, 2021 | S6 (Queen's Award for Voluntary Service; garden party May 2021) |
| partnerships — Citizens Advice, Age UK, SAHA, Crosslight, Town & Country Housing, TW Borough Council, RTW Round Table, Rotary Club of TW, Sainsbury's/Asda | S1 ("charities like Citizens Advice and Age UK"; "Salvation Army Housing Association (SAHA)"; "Crosslight helped Malcolm…"; "Twelve Days of Christmas appeal — supported by the Tunbridge Wells Round Table and Rotary Club"; "collections at Sainsbury's and Asda"; grant-makers list incl. "Tunbridge Wells Borough Council Community Support Fund") |

## Notes / discrepancies (not invented, flagged for honesty)

- **Meals figure.** The independently-examined annual report (S1) and the current website (S2, S3)
  give **142,812 meals** for 2024-25 (46% children). A separate "Nourish Appeal Summer 2025" item on
  the news listing (S4) quotes **"159,498 meals … 45% … children"** for "last year". Because the two
  disagree, the recorded fact uses the figure from the formal annual report / current site (142,812);
  the 159,498 figure is noted here but **not** recorded as fact.
- **Meals-per-parcel.** Recorded parcel content ("three meals a day for three days") is S1's wording;
  the S2 About page phrases a parcel as "at least 9 meals". Consistent, not extrapolated.
- **Government grant.** S7's search summary states income "includes £20,000 from 1 government grant."
  Not independently visible on a directly-fetched page, so noted here only, not recorded in the intake.
- **Trustee committee roles.** S2 (About page) labels Adrian Tofts "Treasurer"; the more recent,
  independently-examined S1 names Richard Williams as Treasurer (appointed Oct 2024). The intake follows
  S1 for Treasurer and records the others as plain "Trustee" to avoid asserting a stale sub-role.
- Charity Commission page (S7) blocks automated fetch (HTTP 403); its figures were only available as a
  search-engine summary, and every figure it gave matches the annual report (S1), which is the primary source.

## What the applicant would realistically have to supply themselves (not public)

These are legitimate grant-eligibility facts that are **not** publicly evidenced on any fetched page.
They are left blank / `null` in the intake and must come from the applicant, not from a guess:

- **Safeguarding policy** existence, and the **safeguarding lead's name, role and training**. The annual
  report describes working with vulnerable clients, confidentiality and an equality/non-discrimination
  policy, but does **not** publish a safeguarding policy or a named safeguarding lead. (`safeguarding_policy = null`,
  lead fields blank.)
- **Public liability / employers' liability insurance** — no public statement found. (`public_liability_insurance = null`.)
- **No conflicting grant / duplicate-funding declaration** — cannot be verified from public sources. (`no_conflicting_grant = null`.)
- **Lived-experience governance** — no public statement that trustees/staff have lived experience of food
  poverty; left blank rather than assumed. (`lived_experience_governance = ""`.)
- Bank-account-in-own-name and board-independence are recorded `true` **only** because they are directly
  evidenced on a fetched page (named bankers; unpaid multi-member volunteer board with CC "no remuneration"
  statement). If a funder needs formal confirmation (bank letter, insurance certificate, signed policies),
  the applicant must still supply the documents.
- Any specific project budget, outputs/outcomes for the proposed grant, beneficiary numbers for a future
  period, and named delivery locations beyond the warehouse — all applicant-supplied.

## Research time

Approx. 20 minutes of automated research (2 web searches for discovery; ~8 page/PDF fetches; one 4.1 MB
annual-report PDF downloaded and parsed locally with `pdftotext`). The Charity Commission register page
required a search-summary fallback because it returns HTTP 403 to automated fetching.
