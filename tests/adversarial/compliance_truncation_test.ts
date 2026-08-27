// ADVERSARIAL — invariant 5: "compliance never traded, NEVER satisfied by truncation".
//
// Four routes by which a document that a donor would reject on its own stated
// limits clears every gate Ktebli applies. Every case below was RUN against the
// code as it stands on 2026-08-27 before it was written down; none is
// hypothetical. This file therefore FAILS against current code by construction,
// and is the specification for the fixes in
// scratchpad/qloop/unblocked/patch-compliance-limits.md.
//
// Pure: no model, no network, no production. Run:
//   npx --yes deno@2.9.5 run --allow-read tests/adversarial/compliance_truncation_test.ts

import { limitScopeFrom, limitedText } from "../../supabase/functions/worker/word_limit.ts";

let bad = 0;
const ok = (c: boolean, m: string) => { c ? console.log(`  ok   ${m}`) : (console.error(`  FAIL ${m}`), bad++); };

// index.ts:565-567, verbatim. The gate's own counter.
const wordCount = (md: string): number =>
  md.replace(/[|#*`>]/g, "").split(/\s+/).filter((w) => /[A-Za-z0-9؀-ۿ]/.test(w)).length;

// The donor's own words, from the ukyouth benchmark fixture. tests/word-limit
// asserts that this text resolves to "answers", so this scope is reachable.
const DONOR = `Answer the five questions below in order, using each question as a heading,
exactly as written. The five answers together must not exceed 1,400 words. Applications
over the limit are returned unread. A one-page budget table must be attached.`;
const SCOPE = limitScopeFrom(DONOR);
ok(SCOPE === "answers", `the fixture's guidelines still resolve to "answers" (got "${SCOPE}")`);

// ---------------------------------------------------------------------------
// 1. Answer prose written as a numbered sequence is not counted at all.
//    FORMAT_RULES (index.ts:59-67) tells the generator to express phased
//    delivery as "a numbered sequence", so this is the mainline shape, not an
//    exotic one. headingOf() in word_limit.ts treats any line matching
//    /^Q?\s*[1-9][.)]\s/ as a heading and drops the WHOLE line.
// ---------------------------------------------------------------------------
console.log("\n1. ORDERED-LIST ANSWER PROSE MUST BE COUNTED");
const LIST_ANSWER = `## Q2. What will you do?

1. Months one to three: recruit two part-time outreach workers, agree referral routes with the two secondary schools, and open the Thursday drop-in at the community centre.
2. Months four to nine: deliver forty weekly sessions, each attended by up to fifteen young people, with a keyworker assigned to every participant who asks for one.
3. Months ten to eighteen: move to a peer-led model, train twelve young volunteers as session leads, and hand the Thursday slot to the youth committee.
`;
const listCounted = limitedText(LIST_ANSWER, SCOPE).text;
ok(/outreach workers/.test(listCounted), "the first numbered answer item is inside the counted span");
ok(/peer-led model/.test(listCounted), "the last numbered answer item is inside the counted span");
ok(wordCount(listCounted) >= wordCount(LIST_ANSWER) - 6,
  `a numbered answer loses at most the donor's own question heading ` +
  `(whole ${wordCount(LIST_ANSWER)}, counted ${wordCount(listCounted)})`);

// ---------------------------------------------------------------------------
// 2. A section heading that merely BEGINS with an attachment word swallows
//    every word under it. "Budget and value for money" is a routine donor
//    question, and the pipeline packages the real budget as a separate
//    Budget.xlsx (index.ts:1897-1908), so a budget heading inside the narrative
//    is answer prose, not an attachment.
// ---------------------------------------------------------------------------
console.log("\n2. AN ANSWER SECTION NAMED AFTER AN ATTACHMENT MUST STILL BE COUNTED");
const BUDGET_ANSWER = `## Q5. How will the work continue after the grant ends?

The Thursday slot passes to the youth committee in month twelve.

### Budget and value for money

Seventy-one pence in every pound goes to frontline delivery. The two outreach posts are
the only new salaries; everything else is met from existing overhead, and the borough
has confirmed the room at no charge for the whole eighteen months of the project.
`;
const bud = limitedText(BUDGET_ANSWER, SCOPE);
ok(/frontline delivery/.test(bud.text), "prose under a 'Budget and value for money' heading is counted");
ok(!bud.excludedHeadings.includes("Budget and value for money"),
  "a donor question is not silently reclassified as an attachment");

// A genuine attached table and declaration must still be excluded — the fix may
// only ever count MORE, never less.
const REAL_ATTACHMENT = `## Q1. Who are you?

We run a supper club in Marlpit.

## Budget table

| Item | Cost |
| --- | --- |
| Staff | 1000 |

## Declaration

I confirm the above is true.`;
const att = limitedText(REAL_ATTACHMENT, SCOPE);
ok(!/Staff \| 1000/.test(att.text) && !/I confirm/.test(att.text),
  "a real attached budget table and declaration are still excluded");

// ---------------------------------------------------------------------------
// 3. Nothing may be dropped from the count without an audit trail (invariant 9).
// ---------------------------------------------------------------------------
console.log("\n3. EVERY DROPPED WORD IS OBSERVABLE");
const dropped = wordCount(LIST_ANSWER) - wordCount(listCounted);
ok(dropped <= 6 || limitedText(LIST_ANSWER, SCOPE).excludedHeadings.length > 0,
  `${dropped} words left the count with excludedHeadings = ` +
  `${JSON.stringify(limitedText(LIST_ANSWER, SCOPE).excludedHeadings)}`);

// ---------------------------------------------------------------------------
// 4. Source assertions against index.ts, for gates that live inline in the
//    worker and cannot be imported (index.ts calls Deno.serve at module scope).
//    Same technique as tests/delivery-gate and tests/sufficiency.
// ---------------------------------------------------------------------------
console.log("\n4. THE INLINE GATES IN index.ts");
const SRC = await Deno.readTextFile(new URL("../../supabase/functions/worker/index.ts", import.meta.url));

// 4a. A donor-mandated heading may be satisfied by ANY substring of itself.
//     `needle.includes(h)` means the heading "Q" clears
//     "Q1. What problem will this project address, and for whom?" — five donor
//     questions satisfied by one letter. The donor's rule is "exactly as written".
ok(!/needle\.includes\(h\)/.test(SRC),
  "the required-section check no longer accepts a heading that is a substring of the donor's wording");

// 4b. normalizeFmt (index.ts:355-373) requires `typeof x === "number"`. jsonOf is
//     a bare JSON.parse, so a donor limit the analyze model emits as "1,400"
//     becomes null — and a null limit is not a refusal, it is NO GATE, in
//     generation, in validate, at package, and on the page-limit block that is
//     the only thing standing in for the undeployed render service.
ok(/numLike|limit_unparsed|unparsed_limit/.test(SRC),
  "a donor limit that arrives as a string is coerced or refused, never silently dropped");

// 4c. The narrative is counted at "answers" scope during generation and validate
//     (narrativeOpts, index.ts:1210-1211) and at "whole" scope at package
//     (index.ts:1926, which omits limitScope). One document, two spans, two
//     verdicts. The span must be computed once.
const packOpts = SRC.match(/const opts: ContentOpts = isNarrative[\s\S]{0,320}?;/);
// Accepts either naming limitScope explicitly or spreading narrativeOpts wholesale.
// The spread is the STRONGER form: it carries limitScope, donorHeadings and
// attachments together, so a future span input cannot be added to generation and
// forgotten at package. Widened for that reason, not to let the old code through --
// an opts object built from scratch still fails this.
ok(!!packOpts && /limitScope|\.\.\.narrativeOpts/.test(packOpts[0]),
  "package counts the narrative over the same span generation did");

console.log(`\n${bad === 0 ? "ALL HELD" : `${bad} ASSERTION(S) FAILED`}`);
Deno.exit(bad === 0 ? 0 : 1);
