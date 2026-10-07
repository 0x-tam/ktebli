import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeCrawlerState,
  encodeCrawlerState,
  ppaStreamsComplete,
  ppaNeedsListingRefresh,
} from "../lib/crawler-checkpoint";

const state = {
  version: 1,
  records: { "ppa:1": { sourceKey: "ppa:1" } },
  streams: {
    "ppa:en": {
      status: "complete",
      cursor: null,
      seen: ["ppa:1"],
      expectedTotal: 1,
    },
    "ppa:ar": {
      status: "complete",
      cursor: null,
      seen: ["ppa:1"],
      expectedTotal: 1,
    },
  },
};

test("compressed public-source checkpoints round-trip and reject corruption or mismatched locales", () => {
  const encoded = encodeCrawlerState("ppa", state);
  assert.deepEqual(
    decodeCrawlerState("ppa", encoded.gzip, encoded.sha256),
    state,
  );
  assert.equal(ppaStreamsComplete(state), true);
  assert.equal(
    ppaStreamsComplete({
      ...state,
      streams: {
        ...state.streams,
        "ppa:ar": { ...state.streams["ppa:ar"], seen: ["ppa:2"] },
      },
    }),
    false,
  );
  assert.throws(
    () => decodeCrawlerState("ppa", encoded.gzip, "0".repeat(64)),
    /digest/,
  );
  assert.throws(() => encodeCrawlerState("ungm-curated", state), /Invalid/);
});

test("a later-day backlog checkpoint refreshes current listings before retrying history", () => {
  const today = new Date("2026-10-06T02:17:00Z");
  const prior = new Date("2026-10-05T23:50:00Z");
  assert.equal(ppaNeedsListingRefresh("backlog", prior, today), true);
  assert.equal(ppaNeedsListingRefresh("backlog", today, today), false);
  assert.equal(ppaNeedsListingRefresh("imported", today, today), true);
});

test("worldwide source checkpoints require resumable pagination state", () => {
  const state = {
    version: 1,
    sources: {
      "grants-gov": {
        status: "incomplete",
        cursor: 0,
        cursorUnit: "offset",
        pages: 0,
        fingerprints: [],
        seenIds: [],
        expectedTotal: null,
        pendingPage: null,
        records: {},
        updatedAt: "2026-10-07T00:00:00.000Z",
      },
    },
  };
  const encoded = encodeCrawlerState("grants-gov", state);
  assert.deepEqual(
    decodeCrawlerState("grants-gov", encoded.gzip, encoded.sha256),
    state,
  );
  assert.throws(
    () =>
      encodeCrawlerState("sam-gov", {
        ...state,
        sources: {
          "sam-gov": { status: "incomplete", seenIds: [], records: {} },
        },
      }),
    /Invalid crawler checkpoint state/,
  );
});
