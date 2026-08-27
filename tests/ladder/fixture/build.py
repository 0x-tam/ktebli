# Builds the SYNTHETIC ladder fixture. Deterministic: rerunning overwrites identically.
import json, os

D = "/tmp/claude-0/-home-user-ktebli/a5730b80-e79d-5cf6-9f2d-4acbf3040436/scratchpad/qloop/ladder"

ORG = {
  "legal_name": "Halewater Commons Trust",
  "country": "United Kingdom",
  "town_or_city": "Kelverton",
  "website": "halewatercommons.org.uk",
  "self_description": (
    "SYNTHETIC FIXTURE ORGANISATION - Halewater Commons Trust does not exist. Neither the "
    "organisation, the town of Kelverton, the neighbourhoods, the partners, the venues, the "
    "vendors, the named people nor any figure below is a fact about any real body, and the "
    "domain halewatercommons.org.uk is part of the fixture and must never be crawled or cited "
    "as a source. "
    "The fixture describes a small community organisation in Kelverton, a post-industrial town "
    "of about 41,000 people in northern England. It is a charitable incorporated organisation "
    "constituted in 2016, with six paid staff (4.2 full-time equivalent), about 25 regular "
    "volunteers and annual expenditure of GBP 214,000. It runs open-access youth sessions for "
    "11-19 year olds, a weekly supper club, and a small advice desk for families, across two "
    "neighbourhoods on the east side of the town. It has an ordinary small-charity website: a "
    "few pages, a news feed and two annual report PDFs. It is deliberately the kind of applicant "
    "Ktebli actually sells to, rather than a national federation."
  ),
  "synthetic": True,
}

GUIDELINES = """THE WREN HILL FOUNDATION - NEIGHBOURHOOD FUTURES FUND, ROUND 3
Guidance for applicants (read in full before you start; this guidance is the only document we assess against)

ABOUT THE FUND
The Neighbourhood Futures Fund backs small community organisations doing sustained work in single neighbourhoods in the United Kingdom. We make about 25 awards a round. We are a small independent grant-maker with no delivery arm and no regional offices, so we rely entirely on what an applicant tells us about its own place. We fund delivery. We do not fund research, one-off events, festivals, capital works, vehicles, premises purchase, or the general running costs of an organisation that has no specific plan attached to them.

WHAT WE ARE LOOKING FOR IN ROUND 3
Round 3 has three stated priorities. An application that addresses fewer than two of them is not taken to assessment.
1. Work rooted in a named place. We want to know which streets, estates, wards or buildings the work happens in, who else operates there, and why that place and not the next one over. Applications that describe "the local community" without naming it score poorly on this criterion; assessors are instructed to treat unnamed geography as a gap in the plan, not as a stylistic preference.
2. Progression to a defined next step. We fund work that moves a person to something specific and nameable - a course, a qualification, a job, a return to education, a named local service that takes them on. Attendance counts are not an outcome for this fund. Tell us what the next step is, who provides it, and how many people you expect to reach it.
3. Something that outlasts the grant. We would rather fund a practice somebody keeps doing after the money stops than an activity that ends on the last day of the grant period. Say what continues, who owns it, what it costs to run without us, and who pays for it.

WHO CAN APPLY
Applicants must be a charity, charitable incorporated organisation, community interest company or constituted community group registered in the United Kingdom, with at least two years of filed accounts and total income under GBP 1.5 million in the last financial year. We do not accept applications from individuals, from statutory bodies, from organisations with total income above that ceiling, or from any organisation that holds a current Neighbourhood Futures award. Consortium bids are accepted; one organisation must be named as lead and accountable body and must meet the eligibility test in its own right.

WHAT WE WILL FUND
Awards are between GBP 25,000 and GBP 75,000, over a period of up to 18 months. Direct delivery costs, staff time, participant costs, venue hire, transport, training, evaluation and a proportionate share of overheads are eligible. Overhead recovery is capped at 12 per cent of direct costs and must appear as a single separate line. We do not fund deficits, retrospective costs, or activity already funded from another source. Match funding is welcome but not required, and an application is not scored more highly for having it.

HOW TO APPLY
Answer the five questions below, in order, using each question as a heading, exactly as written. The five answers together must not exceed 1,200 words. This is a hard limit: applications over it are returned unread and cannot be resubmitted in the same round. Headings, the budget table and the declaration are not counted towards the limit.

Q1. Who are you and what do you do? Your organisation, the people you already work with, and the geography you work in.
Q2. What is the problem, and how do you know? Be specific about place and population. Describe the causes you intend to act on, not only the symptoms, and say what your evidence for them is.
Q3. What will you do? The activities, the sequence, who delivers each part, where each part happens, and how many people take part. Show how the activities follow from the causes in Q2.
Q4. What will change, and how will you know? Intended outcomes, the numbers you expect, how you will measure them, and what you would count as this work not having worked.
Q5. What happens after the grant? Name what continues, who owns it, what it costs and who pays.

BUDGET AND DECLARATION
Attach a one-page budget table showing direct costs by category, the single overhead line, and any match funding with its source and status (secured or pending). In the declaration the signatory confirms: that the organisation is in good standing with its regulator; that it holds a bank account in the organisation's own name; that neither the organisation nor any trustee is debarred or under investigation; and that safeguarding and equal opportunities policies are in place and were reviewed within the last two years. These are self-certifications; no supporting evidence is required at application stage.

HOW WE ASSESS
Two independent assessors score each application against the published criteria and weights below. Each criterion is scored 1-5. A score of 1 on any single criterion removes the application from the round regardless of the total.

DEADLINE
Applications close at 17:00 GMT on Friday 27 November 2026. Late applications are not considered. Decisions are communicated by 12 February 2027."""

GRANT = {
  "case_id": "ladder",
  "synthetic": True,
  "synthetic_note": (
    "SYNTHETIC FIXTURE. The Wren Hill Foundation and the Neighbourhood Futures Fund do not "
    "exist. The call is written to be real-shaped so that it exercises the same machinery a "
    "real call would, and for no other purpose."
  ),
  "grant": {
    "funder": "The Wren Hill Foundation (synthetic)",
    "programme": "Neighbourhood Futures Fund - Round 3 (synthetic)",
    "full_guidelines_text": GUIDELINES,
    "word_limit": 1200,
    "required_sections": [
      "Q1. Who are you and what do you do?",
      "Q2. What is the problem, and how do you know?",
      "Q3. What will you do?",
      "Q4. What will change, and how will you know?",
      "Q5. What happens after the grant?",
      "Budget table (one page, excluded from the word limit)",
      "Declaration (self-certifications, excluded from the word limit)",
    ],
    "budget_range": "GBP 25,000 - GBP 75,000 over up to 18 months; overhead recovery capped at 12% of direct costs",
    "deadline": "17:00 GMT, Friday 27 November 2026",
    "published_criteria": (
      "Published assessment criteria and weights (Wren Hill Foundation, Neighbourhood Futures "
      "Fund Round 3). Each criterion is scored 1-5 by two independent assessors; a score of 1 "
      "on any criterion is disqualifying.\n"
      "- Work rooted in a named place, with the geography, partners and venues identified - 25%\n"
      "- Quality and coherence of the project design (problem, causes, activities, outcomes) - 30%\n"
      "- Capability of the applicant to deliver what is described, evidenced by what it has already done - 20%\n"
      "- Value for money at the requested amount - 15%\n"
      "- Credibility of what continues after the grant - 10%"
    ),
  },
  "organisation": ORG,
}

# ---------------------------------------------------------------- constant block
# Byte-identical in all five ledgers. Carries the applicant's identity and nothing
# that counts as a named referent below city level.
CONST = [
  ("E-INTAKE-1", "intake",
   "The applicant is Halewater Commons Trust (synthetic fixture; the organisation does not exist and no statement in this ledger is a fact about any real body)."),
  ("E-INTAKE-2", "intake",
   "Legal form: charitable incorporated organisation, constituted 2016. Registered charity number: deliberately not instantiated in this fixture, because any realistic-looking number could collide with a real entry on a real register. Treat registration as confirmed for eligibility purposes."),
  ("E-INTAKE-3", "intake",
   "Website supplied on the order form: halewatercommons.org.uk (synthetic; the domain is part of the fixture and must not be crawled)."),
  ("E-INTAKE-4", "intake",
   "The applicant is based in Kelverton, a post-industrial town of about 41,000 people in northern England, in the United Kingdom. The town of Kelverton is itself synthetic."),
  ("E-INTAKE-5", "intake",
   "Staffing: six paid staff (4.2 full-time equivalent) and about 25 regular volunteers."),
  ("E-INTAKE-6", "intake",
   "What the organisation does, in its own words on the order form: 'we run open-access youth sessions for 11 to 19 year olds, a weekly supper club, and a small advice desk for families, on the east side of town.'"),
  ("E-INTAKE-7", "intake",
   "Total expenditure in the last filed financial year was GBP 214,000, and two years of accounts are filed."),
  ("E-INTAKE-8", "intake",
   "Customer directions supplied with the order: none. The applicant pasted the call and left the project field blank."),
]

# ------------------------------------------------------- the twelve referents
# Ordered so that the first 3 are n03, the first 6 are n06, and so on. Every fact
# carries a NAME, a DATE or a NUMBER, and a PLACE.
REF = [
  ("E-WEB-1", "sub_city_place", "Marlpit",
   "The open-access youth sessions run three evenings a week in Marlpit, the ward on the east bank of the river, where 38 per cent of households sat in the lowest income decile at the 2021 census."),
  ("E-WEB-2", "partner_org", "Dunmore Sixth Form College",
   "Since 2023 the organisation has referred school-leavers to Dunmore Sixth Form College, a mile from the Marlpit site; 27 young people were referred in the 2024-25 academic year and 18 enrolled."),
  ("E-WEB-3", "dated_result", "Second Chances",
   "A twelve-week progression course called Second Chances ran in Marlpit from January to April 2025; of the 24 young people who started, 19 finished and 11 moved into a college place, an apprenticeship or paid work."),
  ("E-WEB-4", "venue", "St Aidan's Parish Hall",
   "The weekly supper club uses St Aidan's Parish Hall in Marlpit, hired at GBP 40 an evening, where 46 sittings were served in the year to March 2025."),
  ("E-WEB-5", "person_with_role", "Priya Raval",
   "The youth work is led by Priya Raval, delivery coordinator since 2019, who holds a level 3 youth work qualification and personally runs four of the six weekly sessions in Marlpit."),
  ("E-WEB-6", "vendor", "Northgate Minibus Hire",
   "Transport to off-site activity is bought from Northgate Minibus Hire at GBP 95 a trip; 14 trips ran between April 2024 and March 2025, every one of them picking up in Marlpit."),
  ("E-WEB-7", "sub_city_place", "Ferry Bank",
   "A second delivery site opened in Ferry Bank, the estate north of the old goods yard, in October 2024; 31 young people attended in its first term."),
  ("E-WEB-8", "partner_org", "Barrowfield Youth Justice Team",
   "Referrals also come from Barrowfield Youth Justice Team, which sent nine young people to the organisation between April 2024 and March 2025, six of them living in Ferry Bank."),
  ("E-WEB-9", "venue", "Wharfside Boathouse",
   "Summer activity in 2024 and in 2025 used Wharfside Boathouse on the Ferry Bank side of the river, hired for 18 days across the two summers at GBP 120 a day."),
  ("E-WEB-10", "person_with_role", "Delroy Ferguson",
   "The board is chaired by Delroy Ferguson, a retired further education lecturer, a trustee since 2018, who lives in Ferry Bank and signs off the safeguarding review each year."),
  ("E-WEB-11", "vendor", "Redgate Catering",
   "Food for the supper club is supplied by Redgate Catering, a firm on the Marlpit industrial estate, at GBP 2.40 a head across 46 sittings in the year to March 2025."),
  ("E-WEB-12", "dated_result", "Night Kitchen",
   "A cook-and-eat course called Night Kitchen ran twice in Ferry Bank during 2025, in February and again in June; 22 adults completed it and 15 went on to volunteer at the supper club."),
]

# ---------------------------------------------- the thin arm: same six names, stripped
THIN = [
  ("E-WEB-1", "sub_city_place", "The organisation works in Marlpit."),
  ("E-WEB-2", "partner_org", "The organisation has a relationship with Dunmore Sixth Form College."),
  ("E-WEB-3", "dated_result", "The organisation has run a programme called Second Chances."),
  ("E-WEB-4", "venue", "The organisation has used St Aidan's Parish Hall."),
  ("E-WEB-5", "person_with_role", "One of the people involved is Priya Raval."),
  ("E-WEB-6", "vendor", "The organisation has used a supplier called Northgate Minibus Hire."),
]

def meta(name, n, arm):
    return {
      "id": "E-META-0",
      "source": "fixture-meta",
      "fact": (
        f"synthetic fixture, ledger '{name}'. halewater commons trust does not exist and nothing "
        f"in this file is a fact about any real organisation. named referents in this ledger: {n}. "
        f"arm: {arm}. this item is metadata, not evidence - filter on source == 'fixture-meta' "
        f"before building any prompt packet. counting method is in fixture-readme.md."
      ),
      "referent_kind": "meta",
    }

def build(name, refs, arm, n):
    rows = [meta(name, n, arm)]
    rows += [{"id": i, "source": s, "fact": f, "referent_kind": "none"} for (i, s, f) in CONST]
    rows += refs
    with open(os.path.join(D, f"ledger-{name}.json"), "w") as fh:
        json.dump(rows, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

spec = [{"id": i, "source": "web", "fact": f, "referent_kind": k} for (i, k, _n, f) in REF]
thin = [{"id": i, "source": "web", "fact": f, "referent_kind": k} for (i, k, f) in THIN]

build("n03", spec[:3],  "count-axis, specific", 3)
build("n06", spec[:6],  "count-axis, specific (also the SPECIFIC arm of the specificity axis)", 6)
build("n09", spec[:9],  "count-axis, specific", 9)
build("n12", spec[:12], "count-axis, specific", 12)
build("n06thin", thin,  "specificity axis, THIN arm - same six names as n06, every date, number and place removed", 6)

with open(os.path.join(D, "org.json"), "w") as fh:
    json.dump(ORG, fh, indent=2, ensure_ascii=False); fh.write("\n")
with open(os.path.join(D, "grant.json"), "w") as fh:
    json.dump(GRANT, fh, indent=2, ensure_ascii=False); fh.write("\n")
print("built")
