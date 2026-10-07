import { z } from "zod";

export const profileDraftKey = "ktebli-profile-draft-v1";
const maxAgeMs = 6 * 60 * 60 * 1000;
const text = z.string().max(5000);
const list = z.array(z.string().max(100)).max(20);
const profile = z.object({
  organization_name: text,
  organization_type: text,
  sectors: list,
  capabilities: text,
  locations: list,
  alerts_enabled: z.boolean(),
  qualifications: list,
  interests: list,
  excluded_work: list,
  opportunity_types: list,
  past_work: text,
  team_capacity: text,
  languages: list,
  budget_min: z.number().finite().nullable(),
  budget_max: z.number().finite().nullable(),
});

const draft = z
  .object({
    version: z.literal(1),
    email: z.string().max(254),
    savedAt: z.number().finite(),
    profile,
    sectorsText: text,
    locationsText: text,
    qualificationsText: text,
    interestsText: text,
    exclusionsText: text,
    languagesText: text,
  })
  .strict();

export type ProfileDraftFields = Omit<
  z.infer<typeof draft>,
  "version" | "email" | "savedAt"
>;

export function readProfileDraft(
  storage: Pick<Storage, "getItem" | "removeItem">,
  email: string,
  now = Date.now(),
): ProfileDraftFields | null {
  try {
    const raw = storage.getItem(profileDraftKey);
    if (!raw) return null;
    if (raw.length > 32_000) {
      storage.removeItem(profileDraftKey);
      return null;
    }
    const parsed = draft.safeParse(JSON.parse(raw));
    if (
      parsed.success &&
      parsed.data.email === email &&
      parsed.data.savedAt <= now &&
      now - parsed.data.savedAt <= maxAgeMs
    ) {
      const {
        version: _version,
        email: _email,
        savedAt: _savedAt,
        ...fields
      } = parsed.data;
      void _version;
      void _email;
      void _savedAt;
      return fields;
    }
    storage.removeItem(profileDraftKey);
  } catch {
    try {
      storage.removeItem(profileDraftKey);
    } catch {
      // Storage itself may be unavailable.
    }
  }
  return null;
}

export function saveProfileDraft(
  storage: Pick<Storage, "setItem">,
  email: string,
  fields: ProfileDraftFields,
  now = Date.now(),
): void {
  const parsed = draft.safeParse({
    version: 1,
    email,
    savedAt: now,
    ...fields,
  });
  if (!parsed.success) return;
  const raw = JSON.stringify(parsed.data);
  if (raw.length > 32_000) return;
  try {
    storage.setItem(profileDraftKey, raw);
  } catch {
    // The profile remains editable in memory when storage is blocked.
  }
}
