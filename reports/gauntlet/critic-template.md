# Wave-1 critic template (orchestrator reference)

Each returning workstream gets a separate critic agent, judging FROM ARTIFACTS only:
the worktree diff (git -C <worktree> diff main...HEAD), the workstream's report file,
and the executed test runs (critic re-runs them itself; it never trusts a claimed pass).

The critic must:
- name failures precisely (file:line, the exact broken claim);
- justify any PASS in writing, per the doctrine ("a critic that passes something must
  justify the pass in writing");
- check for weakened fixtures: any changed test/fixture must be argued as a correction,
  not a weakening, in the workstream's own report — silence there is a FAIL;
- check the workstream stayed inside its owned paths (diff outside them is a FAIL);
- check no secret appears in any diff or report (grep for sk-or-, key fragments);
- for model-calling workstreams: spend recorded from usage fields, inside the line.

Verdict: PASS (merge) or SEND BACK (list). The orchestrator merges only on PASS.
