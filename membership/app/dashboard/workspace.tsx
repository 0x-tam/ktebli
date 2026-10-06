"use client";
import { useRef, useState } from "react";
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
  geography_status: "lebanon_confirmed" | "regional_includes_lebanon";
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
  const boardRequest = useRef(0);
  const boardAbort = useRef<AbortController | null>(null);
  const lastRequestedFilters = useRef(filters);
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
    if (reset) setBoardResetting(true);
    const params = new URLSearchParams({
      q: nextFilters.query,
      kind: nextFilters.kind,
      source: nextFilters.source,
      status: nextFilters.status,
      deadline: nextFilters.deadline,
    });
    if (saved) params.set("saved", "1");
    if (!reset && data.nextCursor) params.set("cursor", data.nextCursor);
    try {
      const response = await fetch(
        `${accountPath("/api/opportunities")}?${params}`,
        { signal: controller.signal },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not load opportunities");
      if (requestId !== boardRequest.current) return;
      if (reset) setFilters(nextFilters);
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
    data.subscription &&
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
      setNotice("Profile saved. Fresh matches will use these details.");
    });
  }
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="brand" href={proposalOrigin}>
          ktebli
        </Link>
        <p className="nav-label">YOUR WORKSPACE</p>
        <nav>
          {(
            [
              { id: "discover", label: "Discover", icon: "◈" },
              { id: "saved", label: "Saved opportunities", icon: "◇" },
              { id: "alerts", label: "Alerts", icon: "◉" },
              { id: "profile", label: "Your profile", icon: "◌" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? "selected" : ""}
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
              <span>{item.icon}</span>
              {item.label}
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
            onClick={() =>
              void act(async () => {
                const result = await authClient.signOut();
                if (result.error) throw new Error(result.error.message);
                router.replace("/");
                router.refresh();
              })
            }
          >
            ↗
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
                    placeholder="Search opportunities…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <button disabled={boardBusy}>Search notices</button>
              </form>
            </div>
            <div
              className="catalogue-filters"
              aria-label="Filter opportunity board"
            >
              <label>
                Type
                <select
                  value={filters.kind}
                  disabled={boardBusy}
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
                  value={filters.source}
                  disabled={boardBusy}
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
                  value={filters.status}
                  disabled={boardBusy}
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
                  value={filters.deadline}
                  disabled={boardBusy}
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
                    <article className="opportunity" key={o.id}>
                      <div className="card-top">
                        <span className="source-tag">
                          {o.source.toUpperCase()} ·{" "}
                          {o.kind === "unknown"
                            ? "NOTICE"
                            : o.kind.toUpperCase()}
                        </span>
                        <span
                          className={`board-status board-status-${o.board_status}`}
                        >
                          {o.board_status === "current"
                            ? "Current — verify eligibility"
                            : o.board_status === "closed"
                              ? "Closed or past deadline"
                              : "Needs review"}
                        </span>
                        {active && (
                          <button
                            disabled={busy}
                            aria-label={
                              o.saved ? "Remove from saved" : "Save opportunity"
                            }
                            aria-pressed={o.saved}
                            className="save-button"
                            onClick={() =>
                              void act(async () => {
                                await api("/api/saved", {
                                  opportunityId: o.id,
                                  saved: !o.saved,
                                });
                                setData({
                                  ...data,
                                  opportunities: data.opportunities.map(
                                    (item) =>
                                      item.id === o.id
                                        ? { ...item, saved: !item.saved }
                                        : item,
                                  ),
                                });
                              })
                            }
                          >
                            {o.saved ? "◆" : "◇"}
                          </button>
                        )}
                      </div>
                      <h2 dir="auto">{o.title}</h2>
                      <p dir="auto" className="description">
                        {o.description ||
                          "Read the original notice for the full scope and requirements."}
                      </p>
                      <div className="card-meta">
                        <span>
                          {o.geography_status === "lebanon_confirmed"
                            ? "Lebanon scope confirmed"
                            : o.geography_status === "regional_includes_lebanon"
                              ? "Regional call including Lebanon"
                              : o.geography_status === "outside_lebanon"
                                ? "Outside Lebanon — check scope"
                                : "Lebanon eligibility not confirmed"}
                        </span>
                        <span>
                          {o.deadline_conflict
                            ? "Conflicting dates — check source"
                            : o.deadline
                              ? "Listed deadline " + date(o.deadline)
                              : "Deadline needs review"}
                        </span>
                        <span>Checked {date(o.fetched_at)}</span>
                      </div>
                      {o.group_conflict && (
                        <p className="notice">
                          Official postings disagree on the deadline or status.
                          Check each source before acting; fit assessment is
                          paused.
                        </p>
                      )}
                      {(o.detail_status !== "verified" ||
                        now - new Date(o.fetched_at).getTime() >
                          24 * 60 * 60 * 1000) && (
                        <p className="notice">
                          {o.detail_status !== "verified"
                            ? "Notice details still need verification."
                            : "This notice has not been checked in the past day."}
                        </p>
                      )}
                      {active && (
                        <div className="fit-row">
                          {o.fit !== null ? (
                            <>
                              <strong>
                                {Math.round(Number(o.fit))}/100 fit
                              </strong>
                              <span>
                                {Math.round(Number(o.confidence) * 100)}%
                                assessment confidence
                              </span>
                            </>
                          ) : (
                            <span>Fit assessment pending</span>
                          )}
                        </div>
                      )}
                      {o.eligibility === "excluded" && (
                        <p className="notice">
                          A possible eligibility conflict needs review.
                        </p>
                      )}
                      {(o.reasons?.length || o.evidence.length) > 0 && (
                        <details>
                          <summary>View source evidence</summary>
                          {(o.reasons ?? o.evidence).slice(0, 5).map((e, i) => (
                            <p dir="auto" key={i}>
                              <strong>{e.label}</strong>
                              <br />
                              {e.text.slice(0, 700)}{" "}
                              <a href={e.url} target="_blank" rel="noreferrer">
                                Source ↗
                              </a>
                            </p>
                          ))}
                        </details>
                      )}
                      <div className="locale-links">
                        {o.locales?.map((l) => (
                          <a
                            key={l.locale}
                            href={l.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {l.locale === "ar" ? "العربية" : "English"} ↗{" "}
                          </a>
                        ))}
                      </div>
                      <a className="source-link" href={proposalOrigin}>
                        Explore proposal help <span>↗</span>
                      </a>
                      <a
                        className="source-link"
                        href={o.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Read original notice <span>↗</span>
                      </a>
                      {o.source_aliases?.length > 1 && (
                        <details>
                          <summary>
                            Also published by {o.source_aliases.length - 1}{" "}
                            source(s)
                          </summary>
                          {o.source_aliases
                            .filter(
                              (alias) => alias.source_url !== o.source_url,
                            )
                            .map((alias) => (
                              <p key={`${alias.source}:${alias.source_url}`}>
                                <a
                                  href={alias.source_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {alias.source.toUpperCase()}: {alias.title} ↗
                                </a>
                              </p>
                            ))}
                        </details>
                      )}
                    </article>
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
