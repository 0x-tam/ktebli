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
ok(!/Who are you/.test(a.text), "the donor's own question heading is not the applicant's words");
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
ok(/Halewater Commons Trust/.test(b.text), "an unmarked Q1 line is still a heading");
ok(!/Staff \| 1000/.test(b.text), "an unmarked Budget line still ends the counted span");

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

console.log(bad ? `\n${bad} FAILURE(S)` : "\nALL WORD-LIMIT TESTS PASSED");
if (bad) Deno.exit(1);
