"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { isMembershipActive } from "@/lib/contracts";
import { accountPath } from "@/lib/paths";
type Opportunity = {
  detail_status: string;
  deadline_conflict: boolean;
  application_status: string;
  locales: { locale: string; title: string; sourceUrl: string }[];
  id: string;
  source: string;
  title: string;
  description: string;
  source_url: string;
  deadline: string | null;
  fetched_at: string;
  kind: string;
  saved: boolean;
  fit: number | null;
  confidence: number | null;
  eligibility: string | null;
  reasons: { label: string; text: string; url: string }[] | null;
  evidence: { label: string; text: string; url: string }[];
  geography_status:
    | "lebanon_confirmed"
    | "regional_includes_lebanon"
    | "unknown"
    | "outside_lebanon";
  source_aliases: { source: string; source_url: string; title: string }[];
  group_conflict: boolean;
  board_status: "current" | "needs_review" | "closed";
};
type Profile = {
  past_work: string;
  team_capacity: string;
  languages: string[];
  budget_min: number | null;
  budget_max: number | null;
  organization_name: string;
  organization_type: string;
  sectors: string[];
  capabilities: string;
  locations: string[];
  alerts_enabled: boolean;
  qualifications: string[];
  interests: string[];
  excluded_work: string[];
  opportunity_types: string[];
};
type Data = {
  nextCursor: string | null;
  filteredCount: number;
  profile: Profile | null;
  subscription: {
    state: string;
    paid_until: string | null;
    cancel_at_period_end: boolean;
  } | null;
  credit: { amount_cents: number; expires_at: string; state: string } | null;
  opportunities: Opportunity[];
  alerts: {
    id: string;
    title: string;
    source_url: string;
    created_at: string;
    read_at: string | null;
  }[];
};
const date = (value: string) =>
  new Date(
    value.length === 10 ? value + "T12:00:00" : value,
  ).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function OpportunityRow({
  opportunity: o,
  active,
  busy,
  now,
  proposalOrigin,
  onSave,
}: {
  opportunity: Opportunity;
  active: boolean;
  busy: boolean;
  now: number;
  proposalOrigin: string;
  onSave: () => void;
}) {
  const stale = now - new Date(o.fetched_at).getTime() > 24 * 60 * 60 * 1000;
  const deadlineLabel = o.deadline_conflict
    ? "Conflicting dates — check source"
    : o.deadline
      ? "Listed deadline " + date(o.deadline)
      : "Deadline needs review";
  const geographyLabel =
    o.geography_status === "lebanon_confirmed"
      ? "Lebanon scope"
      : o.geography_status === "regional_includes_lebanon"
        ? "Regional, including Lebanon"
        : o.geography_status === "outside_lebanon"
          ? "Outside Lebanon — check scope"
          : "Lebanon scope unconfirmed";
  return (
    <article className="opportunity opportunity-row">
      <div className="opportunity-row-main">
        <div className="opportunity-row-kicker">
          <span className="source-tag">
            {o.source.toUpperCase()} ·{" "}
            {o.kind === "unknown" ? "NOTICE" : o.kind.toUpperCase()}
          </span>
          <span className={`board-status board-status-${o.board_status}`}>
            {o.board_status === "current"
              ? "Deadline ahead — verify"
              : o.board_status === "closed"
                ? "Closed or past deadline"
                : "Needs review"}
          </span>
        </div>
        <h2 dir="auto">{o.title}</h2>
        <div className="opportunity-row-meta">
          <span>{deadlineLabel}</span>
          <span>{geographyLabel}</span>
          {active && o.fit !== null && (
            <span>{Math.round(Number(o.fit))}/100 fit</span>
          )}
        </div>
        {(o.group_conflict || o.detail_status !== "verified" || stale) && (
          <p className="opportunity-row-caution">
            {o.group_conflict
              ? "Official postings disagree; check each source."
              : o.detail_status !== "verified"
                ? "Details still need verification."
                : "Details have not been checked in the past day."}
          </p>
        )}
      </div>
      <div className="opportunity-row-actions">
        <a
          className="button"
          href={`${proposalOrigin}/?prepare=${encodeURIComponent(o.id)}`}
        >
          Prepare proposal ↗
        </a>
        <div className="opportunity-row-secondary">
          <a href={o.source_url} target="_blank" rel="noreferrer">
            Original notice ↗
          </a>
          {active && (
            <button
              type="button"
              disabled={busy}
              aria-pressed={o.saved}
              onClick={onSave}
            >
              {o.saved ? "Saved ◆" : "Save ◇"}
            </button>
          )}
        </div>
      </div>
      <details className="opportunity-row-details">
        <summary>Scope and source details</summary>
        <p dir="auto">
          {o.description || "Read the original notice for full requirements."}
        </p>
        <p>
          Source checked {date(o.fetched_at)}. Confirm the deadline and
          eligibility with the issuer before payment or application.
        </p>
        {o.eligibility === "excluded" && (
          <p className="notice">
            A possible eligibility conflict needs review.
          </p>
        )}
        {active && o.fit === null && <p>Fit assessment pending.</p>}
        {(o.reasons?.length || o.evidence.length) > 0 && (
          <div className="opportunity-row-evidence">
            {(o.reasons ?? o.evidence).slice(0, 5).map((item, index) => (
              <p dir="auto" key={index}>
                <strong>{item.label}</strong> — {item.text.slice(0, 700)}{" "}
                <a href={item.url} target="_blank" rel="noreferrer">
                  Source ↗
                </a>
              </p>
            ))}
          </div>
        )}
        {o.locales?.length > 0 && (
          <div className="locale-links">
            {o.locales.map((locale) => (
              <a
                key={locale.locale}
                href={locale.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                {locale.locale === "ar" ? "العربية" : "English"} ↗
              </a>
            ))}
          </div>
        )}
        {o.source_aliases?.length > 1 && (
          <div className="opportunity-row-evidence">
            <strong>Also published by</strong>
            {o.source_aliases
              .filter((alias) => alias.source_url !== o.source_url)
              .map((alias) => (
                <p key={`${alias.source}:${alias.source_url}`}>
                  <a href={alias.source_url} target="_blank" rel="noreferrer">
                    {alias.source.toUpperCase()}: {alias.title} ↗
                  </a>
                </p>
              ))}
          </div>
        )}
      </details>
    </article>
  );
}
export default function Dashboard({
  initial,
  name,
  email,
  verified,
  billingEnabled,
  proposalOrigin,
}: {
  initial: Data;
  name: string;
  email: string;
  verified: boolean;
  billingEnabled: boolean;
  proposalOrigin: string;
}) {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<"discover" | "saved" | "profile" | "alerts">(
    "discover",
  );
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({
    query: "",
    kind: "all",
    source: "all",
    status: "all",
    deadline: "all",
  });
  const [boardBusy, setBoardBusy] = useState(false);
  const [boardResetting, setBoardResetting] = useState(false);
  const [boardError, setBoardError] = useState("");
  const boardControls = useRef<HTMLDivElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  // Browser Back can restore native form values after React hydrates fresh
  // unfiltered data. Reassert controlled values so the label matches the rows.
  useEffect(() => {
    let frame = 0;
    let pageTimer = 0;
    const reconcile = () => {
      for (const element of boardControls.current?.querySelectorAll<HTMLSelectElement>(
        "select[data-filter]",
      ) ?? []) {
        const key = element.dataset.filter as
          "kind" | "source" | "status" | "deadline";
        element.value = filters[key];
      }
      if (searchInput.current) searchInput.current.value = query;
    };
    const onPageShow = () => {
      reconcile();
      window.cancelAnimationFrame(frame);
      window.clearTimeout(pageTimer);
      frame = window.requestAnimationFrame(reconcile);
      pageTimer = window.setTimeout(reconcile, 100);
    };
    reconcile();
    const timer = window.setTimeout(reconcile, 100);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(pageTimer);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [filters, query]);
  const boardRequest = useRef(0);
  const boardAbort = useRef<AbortController | null>(null);
  const lastRequestedFilters = useRef(filters);
  const publicFilterCache = useRef(
    new Map<
      string,
      {
        at: number;
        result: Pick<Data, "opportunities" | "filteredCount" | "nextCursor">;
      }
    >(),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [profile, setProfile] = useState<Profile>(
    initial.profile ?? {
      organization_name: "",
      organization_type: "company",
      sectors: [],
      capabilities: "",
      locations: ["Lebanon"],
      alerts_enabled: true,
      qualifications: [],
      interests: [],
      excluded_work: [],
      opportunity_types: ["procurement", "grant"],
      past_work: "",
      team_capacity: "",
      languages: [],
      budget_min: null,
      budget_max: null,
    },
  );
  const [sectorsText, setSectorsText] = useState(
    initial.profile?.sectors.join(", ") ?? "",
  );
  const [locationsText, setLocationsText] = useState(
    initial.profile?.locations.join(", ") ?? "Lebanon",
  );
  const [qualificationsText, setQualificationsText] = useState(
    initial.profile?.qualifications?.join(", ") ?? "",
  );
  const [interestsText, setInterestsText] = useState(
    initial.profile?.interests?.join(", ") ?? "",
  );
  const [exclusionsText, setExclusionsText] = useState(
    initial.profile?.excluded_work?.join(", ") ?? "",
  );
  const [languagesText, setLanguagesText] = useState(
    initial.profile?.languages?.join(", ") ?? "",
  );
  const values = (text: string) =>
    text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  async function loadMore(
    reset = false,
    saved = tab === "saved",
    nextFilters = filters,
  ) {
    const requestId = ++boardRequest.current;
    boardAbort.current?.abort();
    const controller = new AbortController();
    boardAbort.current = controller;
    lastRequestedFilters.current = nextFilters;
    setBoardBusy(true);
    setBoardError("");
    setNotice("");
    if (reset) {
      setBoardResetting(true);
      setFilters(nextFilters);
    }
    const params = new URLSearchParams({
      q: nextFilters.query,
      kind: nextFilters.kind,
      source: nextFilters.source,
      status: nextFilters.status,
      deadline: nextFilters.deadline,
    });
    if (saved) params.set("saved", "1");
    if (!reset && data.nextCursor) params.set("cursor", data.nextCursor);
    const cacheKey = params.toString();
    const cached =
      reset && !saved && !active
        ? publicFilterCache.current.get(cacheKey)
        : null;
    if (cached && Date.now() - cached.at < 30_000) {
      setData((previous) => ({ ...previous, ...cached.result }));
      setFilters(nextFilters);
      setBoardBusy(false);
      setBoardResetting(false);
      return;
    }
    try {
      const response = await fetch(
        `${accountPath("/api/opportunities")}?${params}`,
        { signal: controller.signal },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not load opportunities");
      if (requestId !== boardRequest.current) return;
      if (result.paid === true) publicFilterCache.current.clear();
      if (reset && !saved && !active && result.paid === false) {
        publicFilterCache.current.set(cacheKey, {
          at: Date.now(),
          result: {
            opportunities: result.opportunities,
            filteredCount: result.filteredCount,
            nextCursor: result.nextCursor,
          },
        });
        if (publicFilterCache.current.size > 12)
          publicFilterCache.current.delete(
            publicFilterCache.current.keys().next().value!,
          );
      }
      setData((previous) => ({
        ...previous,
        ...result,
        opportunities: reset
          ? result.opportunities
          : [...previous.opportunities, ...result.opportunities],
      }));
    } catch (error) {
      if (requestId === boardRequest.current && !controller.signal.aborted)
        setBoardError(
          error instanceof Error ? error.message : "Please try again",
        );
    } finally {
      if (requestId === boardRequest.current) {
        setBoardBusy(false);
        setBoardResetting(false);
      }
    }
  }
  const active =
    data.subscription !== null &&
    isMembershipActive(data.subscription.state, data.subscription.paid_until);
  const visible = data.opportunities;
  async function api(path: string, body?: unknown, method = "POST") {
    const response = await fetch(accountPath(path as `/${string}`), {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Please try again");
    return result;
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Please try again");
    } finally {
      setBusy(false);
    }
  }
  function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    void act(async () => {
      await api(
        "/api/profile",
        {
          organizationName: profile.organization_name,
          organizationType: profile.organization_type,
          sectors: values(sectorsText),
          capabilities: profile.capabilities,
          locations: values(locationsText),
          alertsEnabled: profile.alerts_enabled,
          qualifications: values(qualificationsText),
          interests: values(interestsText),
          excludedWork: values(exclusionsText),
          opportunityTypes: profile.opportunity_types,
          pastWork: profile.past_work,
          teamCapacity: profile.team_capacity,
          languages: values(languagesText),
          budgetMin: profile.budget_min,
          budgetMax: profile.budget_max,
        },
        "PUT",
      );
      publicFilterCache.current.clear();
      setNotice("Profile saved. Fresh matches will use these details.");
    });
  }
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="brand" href={proposalOrigin} aria-label="Ktebli home">
          KTEBLI<span className="brand-mark">!</span>
        </Link>
        <p className="nav-label">YOUR WORKSPACE</p>
        <nav>
          {(
            [
              {
                id: "discover",
                label: "Discover",
                shortLabel: "Discover",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="10.8" cy="10.8" r="6.7" />
                    <path d="m16 16 4.2 4.2M8.2 10.8h5.2M10.8 8.2v5.2" />
                  </svg>
                ),
              },
              {
                id: "saved",
                label: "Saved opportunities",
                shortLabel: "Saved",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6.2 4.5h11.6v15l-5.8-3.7-5.8 3.7v-15Z" />
                  </svg>
                ),
              },
              {
                id: "alerts",
                label: "Alerts",
                shortLabel: "Alerts",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M18 9.8a6 6 0 0 0-12 0c0 7-2.4 7-2.4 8.4h16.8c0-1.4-2.4-1.4-2.4-8.4ZM9.4 21h5.2" />
                  </svg>
                ),
              },
              {
                id: "profile",
                label: "Your profile",
                shortLabel: "Profile",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="12" cy="8" r="3.3" />
                    <path d="M5.2 20c.4-3.3 3.2-5.3 6.8-5.3s6.4 2 6.8 5.3" />
                  </svg>
                ),
              },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? "selected" : ""}
              aria-label={item.label}
              aria-current={tab === item.id ? "page" : undefined}
              onClick={() => {
                setTab(item.id);
                if ((item.id === "saved" && active) || item.id === "discover")
                  void loadMore(true, item.id === "saved");
                else {
                  boardRequest.current++;
                  boardAbort.current?.abort();
                  setBoardBusy(false);
                  setBoardResetting(false);
                }
              }}
            >
              {item.icon}
              <span className="nav-label-full">{item.label}</span>
              <span className="nav-label-short">{item.shortLabel}</span>
              {item.id === "alerts" && data.alerts.some((a) => !a.read_at) && (
                <i />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar">
            {(name || email).slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{name || "Your account"}</strong>
            <small>{email}</small>
          </div>
          <button
            title="Sign out"
            aria-label="Sign out"
            onClick={() =>
              void act(async () => {
                const result = await authClient.signOut();
                if (result.error) throw new Error(result.error.message);
                router.replace("/");
                router.refresh();
              })
            }
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M10 4H5v16h10v-5M10 12h10m-4-4 4 4-4 4" />
            </svg>
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">YOUR NEXT CHAPTER</p>
            <h1>
              {tab === "profile"
                ? "The work only you can do."
                : tab === "saved"
                  ? "Worth a closer look."
                  : tab === "alerts"
                    ? "Stay in the know."
                    : `Good to see you${name ? ", " + name.split(" ")[0] : ""}.`}
            </h1>
            <p className="muted">
              {tab === "profile"
                ? "Tell us what you do well. Better context means a more useful shortlist."
                : tab === "alerts"
                  ? "New matches appear here when alerts are enabled in your profile."
                  : "A focused view of opportunities in Lebanon, with the original source always close."}
            </p>
          </div>
          <span className="status-pill">
            {active ? "Member" : "Account ready"}
          </span>
        </header>
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {!verified && (
          <div className="notice">
            Verify your email before subscribing.{" "}
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const r = await authClient.emailOtp.sendVerificationOtp({
                    email,
                    type: "email-verification",
                  });
                  if (r.error) throw new Error(r.error.message);
                  const otp = window.prompt(
                    "Enter the verification code sent to your email",
                  );
                  if (otp) {
                    const v = await authClient.emailOtp.verifyEmail({
                      email,
                      otp,
                    });
                    if (v.error) throw new Error(v.error.message);
                    window.location.reload();
                  }
                })
              }
            >
              Send verification code
            </button>
          </div>
        )}
        <section className="membership-strip">
          <div>
            <p className="eyebrow">
              {active ? "YOUR MEMBERSHIP" : "A LITTLE SUPPORT, EVERY MONTH"}
            </p>
            <h2>
              {active
                ? "Make the most of your next move."
                : "$20/month. Get $20 off one proposal each month."}
            </h2>
            <p>
              {data.credit
                ? `$20 proposal credit ${data.credit.state === "reserved" ? "reserved" : "available"} · expires ${date(data.credit.expires_at)}`
                : active
                  ? "Your next credit arrives with your next paid month."
                  : billingEnabled
                    ? "Browse the board for free before you join."
                    : "Membership opening soon. Browse the board for free today."}
            </p>
            <details className="membership-terms">
              <summary>Credit and membership details</summary>
              <p>
                One credit per paid cycle toward an eligible Ktebli proposal.
                Credits expire with that cycle and do not stack or roll over.
                Fit scores are guidance, never odds of winning.{" "}
                <Link href="/membership-details">Read membership details</Link>.
              </p>
            </details>
          </div>
          <button
            disabled={busy || (!active && !billingEnabled)}
            className="button"
            data-checkout-closed={
              !active && !billingEnabled ? "true" : undefined
            }
            onClick={() =>
              void act(async () => {
                const r = await api(
                  active ? "/api/billing/portal" : "/api/billing/checkout",
                );
                window.location.assign(r.url);
              })
            }
          >
            {active
              ? "Manage membership ↗"
              : billingEnabled
                ? "Become a member ↗"
                : "Checkout opening soon"}
          </button>
        </section>
        {tab === "profile" ? (
          <section className="profile-panel">
            <form onSubmit={saveProfile}>
              <label>
                Organization or professional name
                <input
                  required
                  maxLength={160}
                  value={profile.organization_name}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      organization_name: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Organization type
                <select
                  value={profile.organization_type}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      organization_type: e.target.value,
                    })
                  }
                >
                  <option value="company">Company</option>
                  <option value="ngo">NGO / nonprofit</option>
                  <option value="individual">Independent professional</option>
                  <option value="public_body">Public body</option>
                </select>
              </label>
              <label>
                Sectors <small>Separate with commas</small>
                <input
                  maxLength={1000}
                  placeholder="Water, education, construction"
                  value={sectorsText}
                  onChange={(e) => setSectorsText(e.target.value)}
                />
              </label>
              <label>
                Where you work <small>Separate with commas</small>
                <input
                  maxLength={1000}
                  value={locationsText}
                  onChange={(e) => setLocationsText(e.target.value)}
                />
              </label>
              <label>
                Qualifications <small>Separate with commas</small>
                <input
                  value={qualificationsText}
                  maxLength={2000}
                  onChange={(e) => setQualificationsText(e.target.value)}
                />
              </label>
              <label>
                Interests <small>Separate with commas</small>
                <input
                  value={interestsText}
                  maxLength={2000}
                  onChange={(e) => setInterestsText(e.target.value)}
                />
              </label>
              <label>
                Excluded work or capability gaps{" "}
                <small>Separate with commas</small>
                <input
                  value={exclusionsText}
                  maxLength={2000}
                  onChange={(e) => setExclusionsText(e.target.value)}
                />
              </label>
              <label>
                Opportunity preference
                <select
                  value={
                    profile.opportunity_types.length === 2
                      ? "both"
                      : profile.opportunity_types[0]
                  }
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      opportunity_types:
                        e.target.value === "both"
                          ? ["procurement", "grant"]
                          : [e.target.value],
                    })
                  }
                >
                  <option value="both">Grants and procurement</option>
                  <option value="grant">Grants</option>
                  <option value="procurement">Procurement</option>
                </select>
              </label>
              <label>
                Capabilities and relevant experience
                <textarea
                  rows={6}
                  maxLength={4000}
                  placeholder="Your services, past projects, team strengths, and certifications. Leave out confidential personal information."
                  value={profile.capabilities}
                  onChange={(e) =>
                    setProfile({ ...profile, capabilities: e.target.value })
                  }
                />
              </label>
              <label>
                Past work
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={profile.past_work}
                  onChange={(e) =>
                    setProfile({ ...profile, past_work: e.target.value })
                  }
                />
              </label>
              <label>
                Team capacity
                <input
                  maxLength={500}
                  value={profile.team_capacity}
                  onChange={(e) =>
                    setProfile({ ...profile, team_capacity: e.target.value })
                  }
                />
              </label>
              <label>
                Working languages <small>Separate with commas</small>
                <input
                  maxLength={1000}
                  value={languagesText}
                  onChange={(e) => setLanguagesText(e.target.value)}
                />
              </label>
              <label>
                Project budget range in USD — minimum
                <input
                  type="number"
                  min={0}
                  max={2147483647}
                  value={profile.budget_min ?? ""}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      budget_min: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                />
              </label>
              <label>
                Project budget range in USD — maximum
                <input
                  type="number"
                  min={profile.budget_min ?? 0}
                  max={2147483647}
                  value={profile.budget_max ?? ""}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      budget_max: e.target.value
                        ? Number(e.target.value)
                        : null,
                    })
                  }
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={profile.alerts_enabled}
                  onChange={(e) =>
                    setProfile({ ...profile, alerts_enabled: e.target.checked })
                  }
                />
                Notify me in this workspace about new strong matches
              </label>
              <button className="button" disabled={busy}>
                Save profile ↗
              </button>
            </form>
          </section>
        ) : tab === "alerts" ? (
          <section className="alerts-panel">
            {!active ? (
              <div className="empty">
                <span>◉</span>
                <h2>Alerts come with membership.</h2>
                <p>
                  You can browse the public opportunity board with your free
                  account now.
                </p>
              </div>
            ) : data.alerts.length ? (
              data.alerts.map((alert) => (
                <article key={alert.id} className="alert">
                  <div>
                    <span className="eyebrow">
                      {alert.read_at ? "READ" : "NEW MATCH"} ·{" "}
                      {date(alert.created_at)}
                    </span>
                    <h2>
                      <a
                        href={alert.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {alert.title} ↗
                      </a>
                    </h2>
                  </div>
                  {!alert.read_at && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api("/api/alerts", { id: alert.id });
                          setData({
                            ...data,
                            alerts: data.alerts.map((a) =>
                              a.id === alert.id
                                ? { ...a, read_at: new Date().toISOString() }
                                : a,
                            ),
                          });
                        })
                      }
                    >
                      Mark read
                    </button>
                  )}
                </article>
              ))
            ) : (
              <div className="empty">
                <span>◉</span>
                <h2>You’re up to date.</h2>
                <p>
                  New strong matches will appear here after your profile and
                  matching are ready.
                </p>
              </div>
            )}
          </section>
        ) : tab === "saved" && !active ? (
          <section className="empty">
            <span>◇</span>
            <h2>Saved notices come with membership.</h2>
            <p>
              You can browse every imported public notice in Discover with your
              free account.
            </p>
            <button
              onClick={() => {
                setTab("discover");
                void loadMore(true, false);
              }}
            >
              Open opportunity board ↗
            </button>
          </section>
        ) : (
          <>
            <div className="list-toolbar">
              <div>
                <h2>
                  {tab === "saved" ? "Your shortlist" : "Opportunity board"}
                </h2>
                <p className="muted">
                  {boardResetting
                    ? "Loading filtered notices…"
                    : boardError
                      ? "Results unavailable. Previous results are hidden."
                      : `${data.filteredCount} matching notices · Showing ${visible.length}. Always confirm dates and eligibility with the issuer.`}
                </p>
              </div>
              <form
                className="search catalogue-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadMore(true, tab === "saved", {
                    ...filters,
                    query: query.trim(),
                  });
                }}
              >
                <label>
                  <span className="sr-only">Search opportunities</span>
                  <input
                    ref={searchInput}
                    placeholder="Search opportunities…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <button>Search notices</button>
              </form>
            </div>
            <div
              ref={boardControls}
              className="catalogue-filters"
              aria-label="Filter opportunity board"
            >
              <label>
                Type
                <select
                  data-filter="kind"
                  value={filters.kind}
                  onChange={(e) =>
                    void loadMore(true, tab === "saved", {
                      ...filters,
                      kind: e.target.value,
                    })
                  }
                >
                  <option value="all">All types</option>
                  <option value="procurement">Procurement</option>
                  <option value="grant">Grants</option>
                  <option value="unknown">Other notices</option>
                </select>
              </label>
              <label>
                Source
                <select
                  data-filter="source"
                  value={filters.source}
                  onChange={(e) =>
                    void loadMore(true, tab === "saved", {
                      ...filters,
                      source: e.target.value,
                    })
                  }
                >
                  <option value="all">All sources</option>
                  <option value="ppa">PPA</option>
                  <option value="ungm">UNGM</option>
                  <option value="mawred">Mawred</option>
                  <option value="worldbank">World Bank</option>
                  <option value="cdr">CDR</option>
                </select>
              </label>
              <label>
                Status
                <select
                  data-filter="status"
                  value={filters.status}
                  onChange={(e) =>
                    void loadMore(true, tab === "saved", {
                      ...filters,
                      status: e.target.value,
                    })
                  }
                >
                  <option value="all">All statuses</option>
                  <option value="current">Current, source checked</option>
                  <option value="needs_review">Needs review</option>
                  <option value="closed">Closed or past deadline</option>
                </select>
              </label>
              <label>
                Deadline
                <select
                  data-filter="deadline"
                  value={filters.deadline}
                  onChange={(e) =>
                    void loadMore(true, tab === "saved", {
                      ...filters,
                      deadline: e.target.value,
                    })
                  }
                >
                  <option value="all">Any deadline</option>
                  <option value="future">After today</option>
                  <option value="today">Today — verify time</option>
                  <option value="past">Past</option>
                  <option value="unknown">Not listed</option>
                </select>
              </label>
            </div>
            {boardBusy && (
              <p role="status" className="muted">
                Loading notices…
              </p>
            )}
            {boardError && (
              <div role="alert" className="notice">
                {boardError}{" "}
                <button
                  type="button"
                  onClick={() =>
                    void loadMore(
                      true,
                      tab === "saved",
                      lastRequestedFilters.current,
                    )
                  }
                >
                  Retry
                </button>
              </div>
            )}
            {!boardResetting && !boardError && (
              <section className="opportunity-grid">
                {visible.length ? (
                  visible.map((o) => (
                    <OpportunityRow
                      key={o.id}
                      opportunity={o}
                      active={active}
                      busy={busy}
                      now={now}
                      proposalOrigin={proposalOrigin}
                      onSave={() =>
                        void act(async () => {
                          await api("/api/saved", {
                            opportunityId: o.id,
                            saved: !o.saved,
                          });
                          publicFilterCache.current.clear();
                          setData((previous) => ({
                            ...previous,
                            opportunities: previous.opportunities.map((item) =>
                              item.id === o.id
                                ? { ...item, saved: !item.saved }
                                : item,
                            ),
                          }));
                        })
                      }
                    />
                  ))
                ) : (
                  <div className="empty">
                    <span>◇</span>
                    <h2>
                      {tab === "saved"
                        ? "Room for your next big idea."
                        : "No notices match these filters."}
                    </h2>
                    <p>
                      {tab === "saved"
                        ? "Save interesting notices from Discover and come back when you’re ready."
                        : "Try another type, source, status, deadline, or search term."}
                    </p>
                    <button
                      onClick={() => {
                        if (tab === "saved") {
                          setTab("discover");
                          void loadMore(true, false);
                        } else {
                          setQuery("");
                          void loadMore(true, false, {
                            query: "",
                            kind: "all",
                            source: "all",
                            status: "all",
                            deadline: "all",
                          });
                        }
                      }}
                    >
                      {tab === "saved"
                        ? "Explore opportunities ↗"
                        : "Clear filters ↗"}
                    </button>
                  </div>
                )}
              </section>
            )}
            {!boardError && !boardResetting && data.nextCursor && (
              <button
                className="button subtle"
                disabled={boardBusy}
                onClick={() => void loadMore(false)}
              >
                Load more opportunities
              </button>
            )}
          </>
        )}
        <footer>
          Built for the work ahead. <span>Ktebli · Lebanon</span>
        </footer>
      </main>
    </div>
  );
}
