import assert from "node:assert/strict";
import test from "node:test";
import {
  profileDraftKey,
  readProfileDraft,
  saveProfileDraft,
  type ProfileDraftFields,
} from "../lib/profile-draft";

const fields: ProfileDraftFields = {
  profile: {
    organization_name: "Unsaved organization",
    organization_type: "company",
    sectors: ["Education"],
    capabilities: "",
    locations: ["Lebanon"],
    alerts_enabled: true,
    qualifications: [],
    interests: [],
    excluded_work: [],
    opportunity_types: ["grant"],
    past_work: "",
    team_capacity: "",
    languages: [],
    budget_min: null,
    budget_max: null,
  },
  sectorsText: "Education",
  locationsText: "Lebanon",
  qualificationsText: "",
  interestsText: "",
  exclusionsText: "",
  languagesText: "",
};

test("unfinished profile survives a tab-local remount for the same account", () => {
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
    removeItem: () => {
      raw = null;
    },
  };
  saveProfileDraft(
    storage,
    "member@example.test",
    {
      ...fields,
      profile: {
        ...fields.profile,
        revision: 4,
      } as ProfileDraftFields["profile"],
    },
    1000,
  );
  assert.equal(profileDraftKey, "ktebli-profile-draft-v1");
  assert.equal(
    readProfileDraft(storage, "member@example.test", 2000)?.profile
      .organization_name,
    "Unsaved organization",
  );
  assert.equal(JSON.parse(raw ?? "{}").profile.revision, undefined);
  assert.equal(readProfileDraft(storage, "other@example.test", 2000), null);
  assert.equal(raw, null);
});

test("expired or malformed profile drafts are discarded", () => {
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, value: string) => {
      raw = value;
    },
    removeItem: () => {
      raw = null;
    },
  };
  saveProfileDraft(storage, "member@example.test", fields, 1000);
  assert.equal(
    readProfileDraft(
      storage,
      "member@example.test",
      1000 + 6 * 60 * 60 * 1000 + 1,
    ),
    null,
  );
  assert.equal(raw, null);
  raw = "{";
  assert.equal(readProfileDraft(storage, "member@example.test"), null);
});
