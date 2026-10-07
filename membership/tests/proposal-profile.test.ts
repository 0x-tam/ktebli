import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(
  new URL("../../index.html", import.meta.url),
  "utf8",
);
function functionSource(name: string, next: string) {
  return source.slice(
    source.indexOf(`function ${name}(`),
    source.indexOf(next, source.indexOf(`function ${name}(`)),
  );
}
function profileFixture() {
  const fields: Record<
    string,
    {
      value: string;
      dataset: Record<string, string>;
      hidden?: boolean;
      textContent?: string;
      dispatchEvent: () => void;
    }
  > = {};
  for (const id of [
    "w-name",
    "w-email",
    "w-org",
    "w-applicant-type",
    "profile-prefill-note",
  ]) {
    fields[id] = { value: "", dataset: {}, dispatchEvent() {} };
  }
  fields["w-applicant-type"].value = "individual";
  const context = {
    accountProfile: {
      account: { id: "account-a", name: "A Person", email: "a@example.test" },
      profile: { organization_name: "Example NGO", organization_type: "ngo" },
    },
    ownerTestInvite: null,
    taskDraft: null as object | null,
    document: { getElementById: (id: string) => fields[id] },
    Event: class {},
  };
  const apply = () =>
    runInNewContext(
      `${functionSource("applyAccountProfile", "async function loadAccountProfile")} applyAccountProfile();`,
      context,
    );
  return { fields, context, apply };
}

test("saved profile fills contact and applicant fields without inventing extra facts", () => {
  const { fields, apply } = profileFixture();
  apply();
  assert.equal(fields["w-name"].value, "A Person");
  assert.equal(fields["w-email"].value, "a@example.test");
  assert.equal(fields["w-org"].value, "Example NGO");
  assert.equal(fields["w-applicant-type"].value, "organisation");
  assert.equal(fields["profile-prefill-note"].hidden, false);
});

test("saved profile preserves edited, deliberately cleared, and restored applicant values", () => {
  const { fields, context, apply } = profileFixture();
  fields["w-name"].value = "Different contact";
  fields["w-email"].dataset.userEdited = "true";
  context.taskDraft = {};
  apply();
  assert.equal(fields["w-name"].value, "Different contact");
  assert.equal(fields["w-email"].value, "");
  assert.equal(fields["w-applicant-type"].value, "individual");
});

test("proposal drafts only restore for the verified owner, including explicit guests", () => {
  const validate = functionSource("validTaskDraft", "function clearTaskDraft");
  const saved = {
    version: 1,
    owner: "account-a",
    savedAt: Date.now(),
    step: 0,
    tier: "draft",
    fields: {},
  };
  const valid = (draft: object, owner: string | null) =>
    runInNewContext(`${validate} validTaskDraft(saved);`, {
      saved: draft,
      taskOwner: owner,
      TASK_DRAFT_AGE: 6 * 60 * 60 * 1000,
      document: {},
      REP: {},
    });
  assert.equal(valid(saved, "account-a"), true);
  assert.equal(valid(saved, "account-b"), false);
  assert.equal(valid(saved, null), false);
  assert.equal(valid({ ...saved, owner: null }, null), true);
  assert.equal(valid({ ...saved, owner: undefined }, null), false);
  assert.equal(
    valid({ ...saved, savedAt: Date.now() - 7 * 60 * 60 * 1000 }, "account-a"),
    false,
  );
});

test("missing profile keeps the authenticated contact and individual applicant", () => {
  const { fields, context, apply } = profileFixture();
  context.accountProfile.profile =
    null as unknown as typeof context.accountProfile.profile;
  apply();
  assert.equal(fields["w-name"].value, "A Person");
  assert.equal(fields["w-org"].value, "");
  assert.equal(fields["w-applicant-type"].value, "individual");
});

test("account requests use same-origin private reads and fail quietly with a bounded timeout", async () => {
  const load = `async ${functionSource("loadAccountProfile", "function suspendAccountProfile")}`;
  for (const mode of ["guest", "error", "timeout"] as const) {
    let timerCleared = false;
    let timeoutMs = 0;
    const result = await runInNewContext(`${load} loadAccountProfile();`, {
      ownerTestInvite: null,
      AbortController,
      fetch: async (url: string, options: RequestInit) => {
        assert.equal(url, "/account/api/profile");
        assert.equal(options.credentials, "same-origin");
        assert.equal(options.cache, "no-store");
        if (mode === "timeout") return new Promise(() => {});
        if (mode === "error") throw new Error("offline");
        return { status: 401 };
      },
      setTimeout: (callback: () => void, ms: number) => {
        timeoutMs = ms;
        if (mode === "timeout") queueMicrotask(callback);
        return 1;
      },
      clearTimeout: () => {
        timerCleared = true;
      },
    });
    assert.equal(result, mode === "guest" ? null : undefined);
    assert.equal(timeoutMs, 5000);
    assert.equal(timerCleared, true);
  }
});

function accountRevalidationFixture() {
  const events: string[] = [];
  let resolveProfile: (value: unknown) => void = () => {};
  const fields = { name: "Edited contact", email: "" };
  const context = {
    ownerTestInvite: null,
    document: { visibilityState: "visible" },
    accountNeedsRefresh: true,
    accountProfileReady: true,
    accountRefreshPromise: null as Promise<void> | null,
    accountSessionEpoch: 0,
    accountProofUnavailable: false,
    accountStartupPending: false,
    showProfileRetry: () => events.push("retry"),
    accountProfile: { account: { id: "account-a" } } as unknown,
    taskOwner: "account-a" as string | null,
    pendingProfileOpen: null,
    profileLoading: (loading: boolean) =>
      events.push(loading ? "hidden" : "visible"),
    saveTaskDraft() {
      try {
        throw new Error("Storage blocked");
      } catch {
        /* Production also tolerates unavailable storage. */
      }
    },
    wiz: { invalidateCheckout: () => events.push("invalidate"), open() {} },
    loadAccountProfile: () => {
      events.push("fetch");
      return new Promise((resolve) => {
        resolveProfile = resolve;
      });
    },
    clearTaskDraft: () => events.push("clear"),
    resetProposalTask: () => {
      fields.name = "";
      fields.email = "";
      events.push("reset");
    },
  };
  const script = functionSource(
    "suspendAccountProfile",
    "function readTaskDraft",
  );
  return {
    context,
    fields,
    events,
    run: (call = "revalidateAccountProfile();") =>
      runInNewContext(script + call, context),
    resolve: (value: unknown) => resolveProfile(value),
  };
}

test("returning to a tab with blocked storage clears an old owner's details before revealing the form", async () => {
  const f = accountRevalidationFixture();
  f.run();
  const completion = f.context.accountRefreshPromise;
  f.run(); // visibility and focus often arrive together.
  assert.equal(f.events.filter((event) => event === "fetch").length, 1);
  assert.equal(f.context.accountProfileReady, false);
  assert.equal(f.events[0], "hidden");
  f.resolve({ account: { id: "account-b" } });
  await completion;
  assert.equal(f.context.taskOwner, "account-b");
  assert.equal(f.fields.name, "");
  assert.ok(f.events.indexOf("reset") < f.events.indexOf("visible"));
});

test("same-owner revalidation preserves edited and deliberately empty fields", async () => {
  const f = accountRevalidationFixture();
  f.run();
  const completion = f.context.accountRefreshPromise;
  f.resolve({ account: { id: "account-a" } });
  await completion;
  assert.deepEqual(f.fields, { name: "Edited contact", email: "" });
  assert.equal(f.events.includes("reset"), false);
  assert.equal(f.context.accountProfileReady, true);
});

test("a sign-out epoch prevents a late revalidation response from repopulating account data", async () => {
  const f = accountRevalidationFixture();
  f.run();
  const completion = f.context.accountRefreshPromise;
  f.context.accountSessionEpoch++;
  f.context.accountProfile = null;
  f.context.taskOwner = null;
  f.resolve({ account: { id: "account-a" } });
  await completion;
  assert.equal(f.context.accountProfile, null);
  assert.equal(f.context.taskOwner, null);
});

test("an inconclusive recheck keeps the old owner's draft and edits concealed for retry", async () => {
  const f = accountRevalidationFixture();
  f.run();
  const completion = f.context.accountRefreshPromise;
  f.resolve(undefined);
  await completion;
  assert.equal(f.context.taskOwner, "account-a");
  assert.deepEqual(f.fields, { name: "Edited contact", email: "" });
  assert.equal(f.events.includes("clear"), false);
  assert.equal(f.events.includes("visible"), false);
  assert.equal(f.context.accountProfileReady, false);
  assert.equal(f.context.accountProofUnavailable, true);
  assert.equal(f.events.at(-1), "retry");
  f.run();
  const retryCompletion = f.context.accountRefreshPromise;
  f.resolve({ account: { id: "account-a" } });
  await retryCompletion;
  assert.equal(f.context.accountProfileReady, true);
  assert.equal(f.events.at(-1), "visible");
  assert.equal(f.fields.name, "Edited contact");
});

test("a confirmed signed-out session clears previous account details", async () => {
  const f = accountRevalidationFixture();
  f.run();
  const completion = f.context.accountRefreshPromise;
  f.resolve(null);
  await completion;
  assert.equal(f.context.taskOwner, null);
  assert.equal(f.fields.name, "");
  assert.ok(f.events.indexOf("reset") < f.events.indexOf("visible"));
});

test("startup outage keeps an owner-bound stored proposal untouched until identity can be verified", () => {
  const calls: string[] = [];
  const context = {
    hasOwnedTaskDraft: () => true,
    accountProofUnavailable: false,
    accountNeedsRefresh: false,
    accountStartupPending: true,
    accountProfileReady: false,
    showProfileRetry: () => calls.push("retry"),
    readTaskDraft: () => calls.push("read"),
  };
  runInNewContext(
    `${functionSource("finishAccountProfileStartup", "loadAccountProfile().then(function(data){")} finishAccountProfileStartup(undefined);`,
    context,
  );
  assert.deepEqual(calls, ["retry"]);
  assert.equal(context.accountProfileReady, false);
  assert.equal(context.accountStartupPending, true);
  assert.equal(context.accountProofUnavailable, true);
});
