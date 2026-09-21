import { limitScopeFrom, limitedText } from "../../supabase/functions/worker/word_limit.ts";

let bad = 0;
const ok = (c: boolean, m: string) => { c ? console.log(`  ok  ${m}`) : (console.error(`  FAIL ${m}`), bad++); };
const words = (s: string) => s.replace(/[|#*`>]/g, "").split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

console.log("SCOPE IS CONSERVATIVE BY DEFAULT — invariant 5 runs one way");
ok(limitScopeFrom("") === "whole", "no guidelines at all: strict");
ok(limitScopeFrom("Keep it under 1000 words.") === "whole",
  "a bare limit with no scoping language: strict");
ok(limitScopeFrom("The narrative must not exceed 1,200 words.") === "whole",
  "a limit on 'the narrative' alone does not narrow the scope");

console.log("\nand narrows only when the donor says so");
// The exact wording from the ukyouth fixture.
const UKY = `Answer the five questions below in order, using each question as a heading,
exactly as written. The five answers together must not exceed 1,400 words. Applications
over the limit are returned unread. A one-page budget table must be attached, showing
direct costs by category, the overhead line, and any match funding.`;
ok(limitScopeFrom(UKY) === "answers", "answers-scoped limit + attached budget table");
ok(limitScopeFrom("The word count excludes the budget table and the declaration.") === "answers",
  "an explicit exclusion narrows the scope");

console.log("\nWHOLE scope is byte-identical to today's behaviour");
const DOC = `## Q1. Who are you?

We run a supper club in Marlpit.

## Budget table

| Item | Cost |
| --- | --- |
| Staff | 1000 |

## Declaration

I confirm the above is true.`;
ok(limitedText(DOC, "whole").text === DOC, "whole scope returns the document unchanged");

console.log("\nANSWERS scope drops what the donor attached");
const a = limitedText(DOC, "answers");
ok(!/Staff \| 1000/.test(a.text), "the attached budget table is not counted");
ok(!/I confirm/.test(a.text), "the declaration is not counted");
ok(/supper club in Marlpit/.test(a.text), "the answer prose IS counted");
// CHANGED 2026-08-27, and it moves STRICTER. This used to assert that every heading
// left the count. A heading only leaves the count when it reproduces wording the
// DONOR supplied; with no donorHeadings passed, nothing here is provably the donor's,
// so the heading is counted. Under-counting the applicant's own words is the failure
// mode invariant 5 forbids.
ok(/Who are you/.test(a.text), "an unattributed heading is the applicant's words and is counted");
ok(!/Who are you/.test(limitedText(DOC, "answers", ["Q1. Who are you?"]).text),
  "the same heading leaves the count once the donor is shown to have written it");
ok(a.excludedHeadings.length === 2, `both attached sections recorded (got ${a.excludedHeadings.length})`);

console.log("\nan attachment named in prose cannot truncate the count");
const TRAP = `## Q1. Who are you?

Our budget table is attached separately, and the declaration follows donor format.
We work in Marlpit with fifteen volunteers.

## Q2. What is the problem?

Waste accumulates in the alleyways.`;
const t = limitedText(TRAP, "answers");
ok(/fifteen volunteers/.test(t.text) && /alleyways/.test(t.text),
  "prose mentioning the budget and declaration is still counted");
ok(t.excludedHeadings.length === 0, "nothing was dropped");

console.log("\nbare section markers, which real generators emit");
const BARE = `Q1. Who are you and what do you do?

We are Halewater Commons Trust in Kelverton.

Budget

| Item | Cost |
| --- | --- |
| Staff | 1000 |`;
const b = limitedText(BARE, "answers");
ok(/Halewater Commons Trust/.test(b.text), "the answer prose under a bare marker is counted");
// CHANGED 2026-08-27, and it moves STRICTER. This used to assert that a bare
// unmarked "Budget" line ended the counted span. That is the document steering its
// own count: one unmarked word deletes everything after it. Only a real heading --
// ATX or a whole-line bold label -- can now end the span, so the table is counted.
ok(/Staff \| 1000/.test(b.text), "an unmarked Budget line no longer deletes what follows it");
ok(b.excludedHeadings.length === 0, "and nothing was dropped unrecorded");
ok(!/Staff \| 1000/.test(limitedText(BARE.replace(/^Budget$/m, "## Budget"), "answers").text),
  "the same table marked as a real heading is excluded");

console.log("\nTHE MEASURED DEFECT — a compliant document read as over-length");
// ukyouth-A: 669 words of answers, 1658 words of whole document, 1,400 limit.
const REAL = `## Q1. Who are you?

${"word ".repeat(650)}

## Budget table

${Array.from({ length: 60 }, (_, i) => `| Budget line item ${i} | ${i * 100} | staff cost detail for this category |`).join("\n")}

## Declaration

${"declaration ".repeat(400)}`;
const whole = words(limitedText(REAL, "whole").text);
const answers = words(limitedText(REAL, "answers").text);
ok(whole > 1400, `whole document reads as over the 1,400 limit (${whole})`);
ok(answers < 1400, `the answers the donor actually counts are inside it (${answers})`);
ok(whole - answers > 400, "the gap is the attached material, not prose");

console.log("\nTHE DOCUMENT MAY NOT CHOOSE ITS OWN COUNTED SPAN — invariant 5");
// 1. An ordered list is answer prose. FORMAT_RULES instructs the generator to use
//    exactly this shape for phased delivery, so this is the mainline document.
const PHASED = `## Q2. What will you do?

1. Months one to three: recruit two part-time outreach workers, agree referral routes with the two secondary schools, and open the Thursday drop-in at the community centre.
2. Months four to nine: deliver forty weekly sessions, each attended by up to fifteen young people.
3. Months ten to eighteen: move to a peer-led model and train twelve young volunteers as session leads.
`;
const ph = limitedText(PHASED, "answers", ["Q2. What will you do?"]);
ok(/outreach workers/.test(ph.text) && /peer-led model/.test(ph.text),
  "numbered answer items are inside the counted span");
ok(words(ph.text) >= words(PHASED) - 6,
  `a numbered answer loses at most the donor's heading (whole ${words(PHASED)}, counted ${words(ph.text)})`);

// 2. Prefix matching is gone. "Budget and value for money" is a donor question.
const VFM = `## Q5. How will the work continue?

### Budget and value for money

Seventy-one pence in every pound goes to frontline delivery. The two outreach posts are
the only new salaries; everything else is met from existing overhead.
`;
const vfm = limitedText(VFM, "answers");
ok(/frontline delivery/.test(vfm.text), "prose under 'Budget and value for money' is counted");
ok(vfm.excludedHeadings.length === 0, "a donor question is not reclassified as an attachment");

// 3. An attachment carrying prose is a section wearing an attachment's name. The
//    whole section returns to the count, and the exclusion record is withdrawn.
const FAKE = `## Q1. Who are you?

We run a supper club.

## Annex

| Row | 1 |

Marlpit Supper Club has served eleven thousand meals since two thousand and nineteen from the
parish hall on Weaver Street, and the trustees have signed off every set of accounts on time.
`;
const fake = limitedText(FAKE, "answers");
ok(/eleven thousand meals/.test(fake.text), "prose hidden under 'Annex' is counted");
ok(/Row \| 1/.test(fake.text), "and so is the rest of that section, from its heading");
ok(fake.excludedHeadings.length === 0, "the withdrawn exclusion is not left in the record");

// 4. Every word that leaves the count is recorded (invariant 9).
const acct = (md: string, hs: string[] = []) => {
  const r = limitedText(md, "answers", hs);
  return words(md) > words(r.text) ? r.excludedHeadings.length > 0 || hs.length > 0 : true;
};
ok(acct(DOC) && acct(TRAP) && acct(PHASED, ["Q2. What will you do?"]) && acct(VFM) && acct(FAKE),
  "no document loses words with an empty exclusion record");


console.log("\nF2 — the section-exclusion hole found by the parser audit");
// A per-paragraph prose test was defeated by pressing Enter: an "## Annex" heading
// followed by paragraphs each under PROSE_LINE_WORDS hid 541 words of a 550-word
// document and the limit counted 9. The test is now cumulative over the SECTION, with
// an independent size cap behind it.
const HIDDEN = `## Q1. Who are you?

We are a small charity.

## Annex

` + Array.from({ length: 45 }, (_, i) =>
  `Paragraph ${i} carries real argument about the work and the people served.`).join("\n\n");
const hidWhole = words(limitedText(HIDDEN, "whole").text);
const hidCount = words(limitedText(HIDDEN, "answers").text);
ok(hidCount === hidWhole, `prose relabelled as an annex is still counted (${hidCount}/${hidWhole})`);

console.log("\nand a genuine attachment still leaves the count");
const REAL_ATTACH = `## Q1. Who are you?

We run a supper club in Marlpit and have done since 2016, four evenings a week.

## Budget table

| Item | Cost |
| --- | --- |
${Array.from({ length: 30 }, (_, i) => `| Line item ${i} | ${i * 100} |`).join("\n")}

## Declaration

I confirm the information given above is true and complete to the best of my knowledge.`;
const realCount = words(limitedText(REAL_ATTACH, "answers").text);
ok(realCount < 40, `a real budget table and declaration are excluded (${realCount})`);
ok(/supper club in Marlpit/.test(limitedText(REAL_ATTACH, "answers").text), "the answer survives");

console.log("\na table-only section is not prose however long it runs");
const LONG_TABLE = `## Q1. Who are you?

We work in Marlpit.

## Annex

| Item | Cost |
| --- | --- |
${Array.from({ length: 120 }, (_, i) => `| Line ${i} | ${i} |`).join("\n")}`;
ok(words(limitedText(LONG_TABLE, "answers").text) < 20,
  "120 table rows do not re-enter the count");

console.log(bad ? `\n${bad} FAILURE(S)` : "\nALL WORD-LIMIT TESTS PASSED");
if (bad) Deno.exit(1);
