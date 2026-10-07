import assert from "node:assert/strict";
import test from "node:test";
import {
  authPath,
  boardPath,
  defaultBoardFilters,
  parseBoardView,
  safeAccountReturn,
} from "../lib/navigation";

test("board view survives URL round trip without private account fields", () => {
  const path = boardPath("saved", {
    ...defaultBoardFilters,
    query: "water access",
    country: "LB",
    kind: "grant",
    deadline: "future",
  });
  assert.equal(
    path,
    "/account/dashboard?tab=saved&q=water+access&kind=grant&deadline=future&country=LB",
  );
  const parsed = parseBoardView(
    new URL(path, "https://ktebli.test").searchParams,
  );
  assert.equal(parsed.tab, "saved");
  assert.equal(parsed.filters.query, "water access");
  assert.equal(parsed.filters.country, "LB");
  assert.equal(parsed.filters.kind, "grant");
  assert.equal(parsed.filters.deadline, "future");
});

test("auth return targets remain on approved account routes", () => {
  assert.equal(
    authPath("/account/dashboard?tab=profile"),
    "/account/auth?returnTo=%2Faccount%2Fdashboard%3Ftab%3Dprofile",
  );
  assert.equal(
    safeAccountReturn("/account/proposal-checkout?token=secret"),
    "/account/proposal-checkout",
  );
  for (const value of [
    "https://evil.example/account/dashboard",
    "//evil.example/account/dashboard",
    "/account\\@evil.example/dashboard",
    "/account/auth?returnTo=https://evil.example",
    "/account/dashboard/../auth",
    "/account/dashboard#token",
    "/account/dashboard%2F..%2Fauth",
  ]) {
    assert.equal(safeAccountReturn(value), null, value);
  }
});

test("unrecognized board values cannot survive a return handoff", () => {
  assert.equal(
    safeAccountReturn(
      "/account/dashboard?tab=unknown&source=evil&country=us&email=someone%40example.test",
    ),
    "/account/dashboard",
  );
});
