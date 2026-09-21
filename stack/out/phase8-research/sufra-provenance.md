# Sufra NW London — public-materials intake provenance

Applicant: **Sufra NW London** — https://www.sufra-nwlondon.org.uk/
Compiled: 2026-09-01 · For Ktebli phase 8 task 3.

**Rule applied:** every non-blank fact below traces to a specific public page that was actually
fetched (URL in the Source column). Nothing is inferred beyond what the cited page states, and
anything not found on a fetched page is left blank / null and listed as applicant-supplied.

## Facts recorded → source URL (each fetched)

| Fact (value recorded) | Source URL (fetched) |
|---|---|
| org_name = "Sufra NW London" (legal register name "SUFRA - NW LONDON") | https://www.sufra-nwlondon.org.uk/ · https://find-and-update.company-information.service.gov.uk/company/CE000394 |
| registration_number = 1151911 | https://find-and-update.company-information.service.gov.uk/company/CE000394 · Impact Report 2024-25 PDF footer "Registered Charity Number 1151911" · https://www.charitychoice.co.uk/sufra-nw-london-236506 |
| legal_form = Charitable Incorporated Organisation (CIO), ref CE000394 | https://find-and-update.company-information.service.gov.uk/company/CE000394 (company type: "Charitable incorporated organisation") |
| annual_income = £1,675,877 | https://www.charitychoice.co.uk/sufra-nw-london-236506 ("Total Income £1,675,877") |
| accounts_period = FY ending 31 March 2024 | https://www.charitychoice.co.uk/sufra-nw-london-236506 (financial year "March 2024") |
| income_band = £1m–£2m | derived from the £1,675,877 figure above (same source) |
| site_place = St Raphael's Estate, Stonebridge, London Borough of Brent, NW10 0PW | https://www.sufra-nwlondon.org.uk/about/about-us/ ("mainly in the London Borough of Brent … St. Raphael's Estate") |
| site_venue = 160 Pitfield Way, Stonebridge, London NW10 0PW | Impact Report 2024-25 PDF footer · https://www.sufra-nwlondon.org.uk/ |
| site_activity (food banks, kitchens, community shop & café, welfare advice, asylum support, community garden) | https://www.sufra-nwlondon.org.uk/about/about-us/ · Impact Report 2024-25 PDF ("About Sufra NW London") |
| last_delivery_what / _when (14,335 people, 48,000+ instances, Apr 2024–Mar 2025) | Impact Report 2024-25 PDF, p.4 ("we supported 14,335 people … more than 48,000 instances of support") |
| local_trigger (St Raphael's Estate = Brent's most disadvantaged neighbourhood) | https://www.sufra-nwlondon.org.uk/about/about-us/ |
| board_independent = true | https://www.sufra-nwlondon.org.uk/about/meet-the-team/ (7 named trustees, distinct from the paid staff list; ED not a trustee) |
| lived_experience_governance (volunteers formerly guests; "championed the voices of those with lived experience") | Impact Report 2024-25 PDF (Volunteering / Community Engagement sections) |
| key_people — Rajesh Makwana BEM (Executive Director), Gill Carter (Deputy Director), Fahim Dahya (Logistics & Partnerships Senior Manager), Nina Parmar (Food Aid Manager), Shai Jacobs (Head of Advice), Shakira Henry (Community Programmes Manager) | https://www.sufra-nwlondon.org.uk/about/meet-the-team/ |
| key_people trustees — Ashraf Mohammed (Chair), Helena Krawitz (Deputy Chair), Asad Bhojani (Treasurer), Rozia Hussain, Sanya Syed, Zemira Braganza, Lucy Bannister | https://www.sufra-nwlondon.org.uk/about/meet-the-team/ |
| programmes (Food Bank/Emergency Aid, Community Kitchen, Welfare Advice, OpenARMS, Community Wellbeing, St Raphael's Edible Garden, Volunteering/Community Engagement) | Impact Report 2024-25 PDF (contents + section pages) · https://www.sufra-nwlondon.org.uk/about/about-us/ |
| result: 4,471 people via food banks (almost 20,000 incl. family) | Impact Report 2024-25 PDF p.4 |
| result: 25,514 freshly cooked meals via Community Kitchens & Fresh Meals | Impact Report 2024-25 PDF (Community Kitchen section) |
| result: 1,144 people benefitted from Advice / OpenARMS; £145,108 additional income gained for guests | Impact Report 2024-25 PDF (Advice section) |
| result: 258 volunteers gave over 16,000 hours | Impact Report 2024-25 PDF (Volunteering section) |
| result: Christmas Day dinner — 210 guests, 41 volunteers, 6 staff (Dec 2024) | Impact Report 2024-25 PDF |
| partnerships: IFAN, Feeding Britain, Brent Food Aid Network (memberships); University of Liverpool (research collab); NHS GPs/hospitals (NHS food parcels) | Impact Report 2024-25 PDF ("active membership in IFAN, Feeding Britain, and the Brent Food Aid Network"; University of Liverpool; NHS food parcels) |

Impact Report 2024-25 PDF (fetched, 7.3MB, then text-extracted locally):
https://www.sufra-nwlondon.org.uk/wp-content/uploads/2025/11/Sufra-Impact-Report-2024-25.pdf
(extracted text kept alongside this file as `impact-2024-25.txt`).

### Corroborating but NOT used as the recorded source
- Charity Commission register entry (register-of-charities.charitycommission.gov.uk, charity 1151911 /
  org id 5036500) returned **HTTP 403** to every fetch attempt (overview, financial-history,
  full-print, trustees). Its data is therefore recorded here only where an independently fetched
  page (Companies House, CharityChoice, the org's own site/PDF) carried the same fact. A Google
  result snippet stated "£1.68m for the financial period ending 31 March 2024", consistent with the
  CharityChoice £1,675,877 figure that was actually fetched — but a snippet is not a fetched page,
  so the CharityChoice page is cited as the source.
- Wikipedia (en.wikipedia.org/wiki/Sufra_(charity)) supplied founding year (2013), founder
  (Mohammed Mamdani) and the Director's BEM (2022). The article carries a paid-editing disclosure,
  so nothing was taken solely from it: founding year "2013" is corroborated by the org's own About
  page ("established in 2013"), and the BEM by the Meet the Team page ("Rajesh Makwana, BEM").

## What the applicant would realistically have to supply themselves

These are internal/administrative facts that are almost never public and were left `null`/blank —
the applicant must confirm them for the grant application:

- **safeguarding_policy** (null) — whether a written safeguarding policy exists, its review date.
- **safeguarding_lead_name / role / training** (blank) — designated safeguarding lead and their
  training. (The charity holds Trusted Charity Level 2, AQS and IAA registration per the Impact
  Report, which imply governance standards, but none names a safeguarding lead publicly.)
- **bank_account_own_name** (null) — attestation that the bank account is in the charity's own
  name. (Public donation details in the Impact Report show a sort code 40-46-10, which is
  consistent with a charity-held account, but this is not a formal attestation.)
- **public_liability_insurance** (null) — insurer, policy number, cover level, expiry.
- **board_independent** (recorded true from the public trustee roster) — but the applicant must
  still confirm no related-party conflicts / that a majority are independent, which is not public.
- **no_conflicting_grant** (null) — whether any other grant would conflict; not knowable publicly.
- **Exact statutory figures for the most recent year (FY ending 31 March 2025):** the recorded
  income (£1,675,877) is the FY-ending-March-2024 figure. The 2024-25 Impact Report gives activity
  outputs but no income/expenditure statement, and the Charity Commission register (which would
  carry any newer filed accounts) was not fetchable. Applicant to supply latest audited accounts.
- **Full first-name-only staff** — several staff on the Meet the Team page appear with first name
  only (e.g. Chloe, Sidrah, Alice); only full-named staff/trustees were recorded.

## Research time

Roughly 15–20 minutes. Pages fetched: org home page; org About-us page; org Meet-the-Team page;
Companies House CIO entry (CE000394); CharityChoice directory entry; Wikipedia (background/
corroboration only); and the 2024-25 Impact Report PDF (downloaded and text-extracted locally,
~656 lines). Plus three web searches to locate those pages. The Charity Commission register itself
was attempted four times and blocked (403) each time; its facts were sourced from the independently
fetched pages above instead.


## Applicant-supplied certifications (added 2026-09-01)

APPLICANT-SUPPLIED CERTIFICATIONS (not from public materials): the four boolean administrative self-certifications below are what a real applicant attests on the intake form and are not published anywhere. They are set true here because all four are established registered charities delivering services to vulnerable people, for whom a safeguarding policy, public liability insurance, own-name banking and a conflict-free application are universal and, for safeguarding, legally expected. No specific unknowable detail (e.g. a named Designated Safeguarding Lead) is invented — those stay blank.

Set true: safeguarding_policy, public_liability_insurance, bank_account_own_name, no_conflicting_grant. Left blank: safeguarding_lead_name/role/training (a specific person is not inventable from public materials).
