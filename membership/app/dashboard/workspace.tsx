"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { runBoundedAuthCall } from "@/lib/auth/flow";
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
  locations: {
    countryCodes: string[];
    scope: "countries" | "worldwide" | "unknown";
    evidence: { label: string; text: string; url: string }[];
  };
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
  countries: string[];
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
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
const countryName = (code: string) => countryNames.of(code) ?? code;
const sourceLabels: Record<string, string> = {
  ppa: "PPA",
  ungm: "UNGM",
  mawred: "Mawred",
  worldbank: "World Bank",
  cdr: "CDR",
  "grants-gov": "Grants.gov",
  "sam-gov": "SAM.gov",
};
const sourceName = (source: string) =>
  sourceLabels[source] ?? source.toUpperCase();
const date = (value: string) =>
  new Date(
    value.length === 10 ? value + "T12:00:00" : value,
  ).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M11.5 3.5h5v5M16.2 3.8 9 11" />
      <path d="M15 10.5v4A1.5 1.5 0 0 1 13.5 16h-9A1.5 1.5 0 0 1 3 14.5v-9A1.5 1.5 0 0 1 4.5 4h4" />
    </svg>
  );
}

function BookmarkIcon({ saved = false }: { saved?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill={saved ? "currentColor" : "none"}
      aria-hidden="true"
    >
      <path d="M5 3.5h10v13L10 13.4l-5 3.1v-13Z" />
    </svg>
  );
}

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
  const detailsDialog = useRef<HTMLDialogElement | null>(null);
  const detailsTrigger = useRef<HTMLButtonElement | null>(null);
  const stale = now - new Date(o.fetched_at).getTime() > 24 * 60 * 60 * 1000;
  const deadlineLabel = o.deadline_conflict
    ? "Conflicting dates — check source"
    : o.deadline
      ? "Listed deadline " + date(o.deadline)
      : "Deadline needs review";
  const locationLabel =
    o.locations.scope === "worldwide"
      ? "Worldwide scope"
      : o.locations.scope === "countries" && o.locations.countryCodes.length
        ? o.locations.countryCodes.map(countryName).join(", ")
        : "Country not listed";
  return (
    <article className="opportunity opportunity-row">
      <div className="opportunity-row-main">
        <div className="opportunity-row-kicker">
          <span className="source-tag">
            {sourceName(o.source)} ·{" "}
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
          <span>Opportunity country: {locationLabel}</span>
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
          Prepare proposal <ExternalLinkIcon />
        </a>
        <div className="opportunity-row-secondary">
          <a href={o.source_url} target="_blank" rel="noreferrer">
            Original notice <ExternalLinkIcon />
          </a>
          <button
            ref={detailsTrigger}
            className="text-button"
            type="button"
            onClick={() => detailsDialog.current?.showModal()}
          >
            Details
          </button>
          {active && (
            <button
              type="button"
              disabled={busy}
              aria-pressed={o.saved}
              onClick={onSave}
            >
              <BookmarkIcon saved={o.saved} />
              {o.saved ? "Saved" : "Save"}
            </button>
          )}
        </div>
      </div>
      <dialog
        className="opportunity-details-dialog"
        ref={detailsDialog}
        aria-labelledby={`opportunity-details-${o.id}`}
        onClose={() => detailsTrigger.current?.focus()}
      >
        <div className="opportunity-details-dialog-header">
          <div>
            <p className="eyebrow">
              {sourceName(o.source)} · OPPORTUNITY DETAILS
            </p>
            <h2 id={`opportunity-details-${o.id}`} dir="auto">
              {o.title}
            </h2>
          </div>
          <button
            className="dialog-close"
            type="button"
            aria-label="Close opportunity details"
            onClick={() => detailsDialog.current?.close()}
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </div>
        <div className="opportunity-details-summary">
          <p>{deadlineLabel}</p>
          <p>Opportunity country: {locationLabel}</p>
          <p>
            {o.board_status === "current"
              ? "Deadline ahead — verify with the issuer"
              : o.board_status === "closed"
                ? "Closed or past deadline"
                : "Needs review before you decide"}
          </p>
        </div>
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
            {(o.reasons ?? o.evidence).map((item, index) => (
              <p dir="auto" key={index}>
                <strong>{item.label}</strong> — {item.text}{" "}
                <a href={item.url} target="_blank" rel="noreferrer">
                  Source <ExternalLinkIcon />
                </a>
              </p>
            ))}
          </div>
        )}
        {o.locations.evidence.length > 0 && (
          <div className="opportunity-row-evidence">
            <strong>Location evidence</strong>
            {o.locations.evidence.map((item, index) => (
              <p dir="auto" key={index}>
                <strong>{item.label}</strong> — {item.text}{" "}
                <a href={item.url} target="_blank" rel="noreferrer">
                  Source <ExternalLinkIcon />
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
                {locale.locale === "ar" ? "العربية" : "English"}{" "}
                <ExternalLinkIcon />
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
                    {sourceName(alias.source)}: {alias.title}{" "}
                    <ExternalLinkIcon />
                  </a>
                </p>
              ))}
          </div>
        )}
        <div className="opportunity-details-dialog-actions">
          <a
            className="button"
            href={`${proposalOrigin}/?prepare=${encodeURIComponent(o.id)}`}
          >
            Prepare proposal <ExternalLinkIcon />
          </a>
          <a href={o.source_url} target="_blank" rel="noreferrer">
            Open original notice <ExternalLinkIcon />
          </a>
          <button type="button" onClick={() => detailsDialog.current?.close()}>
            Done
          </button>
        </div>
      </dialog>
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
    country: "all",
  });
  const activeSecondaryFilters =
    Number(filters.source !== "all") + Number(filters.deadline !== "all");
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
          "kind" | "source" | "status" | "deadline" | "country";
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
  const [noticeKind, setNoticeKind] = useState<"success" | "error">("success");
  const [busyAction, setBusyAction] = useState("");
  const actionInFlight = useRef(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationError, setVerificationError] = useState("");
  const verificationCodeInput = useRef<HTMLInputElement | null>(null);
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
      country: nextFilters.country,
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
  async function act(
    fn: () => Promise<void>,
    action = "",
    onError?: (error: unknown) => void,
  ) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setBusyAction(action);
    setNotice("");
    try {
      await fn();
    } catch (error) {
      if (onError) onError(error);
      else {
        setNoticeKind("error");
        setNotice(error instanceof Error ? error.message : "Please try again");
      }
    } finally {
      actionInFlight.current = false;
      setBusyAction("");
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
      setNoticeKind("success");
      setNotice("Profile saved. Fresh matches will use these details.");
    }, "profile");
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
            title={busyAction === "signout" ? "Signing out" : "Sign out"}
            aria-label={busyAction === "signout" ? "Signing out" : "Sign out"}
            disabled={busy}
            aria-busy={busy && busyAction === "signout"}
            onClick={() =>
              void act(async () => {
                const result = await authClient.signOut();
                if (result.error) throw new Error(result.error.message);
                router.replace("/");
                router.refresh();
              }, "signout")
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
            <h1>
              {tab === "profile"
                ? "Your profile"
                : tab === "saved"
                  ? "Saved opportunities"
                  : tab === "alerts"
                    ? "Alerts"
                    : "Opportunities"}
            </h1>
            <p className="muted">
              {tab === "profile"
                ? "Add the details you want to use for matching."
                : tab === "alerts"
                  ? "New matches appear here when matching and alerts are available."
                  : tab === "saved"
                    ? "Your saved public opportunities."
                    : "Browse opportunities across the countries represented in the catalogue. Eligibility varies by notice."}
            </p>
          </div>
          <span className="status-pill">
            {active ? "Member" : "Account ready"}
          </span>
        </header>
        {notice && (
          <p
            role={noticeKind === "error" ? "alert" : "status"}
            className={`notice notice-${noticeKind}`}
          >
            {notice}
          </p>
        )}
        {!verified && (
          <div className="notice">
            Verify your email before subscribing.{" "}
            {!verificationSent ? (
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const result = await runBoundedAuthCall((signal) =>
                      authClient.emailOtp.sendVerificationOtp({
                        email,
                        type: "email-verification",
                        fetchOptions: { signal },
                      }),
                    );
                    if (result.error) throw new Error(result.error.message);
                    setVerificationSent(true);
                    setTimeout(() => verificationCodeInput.current?.focus(), 0);
                  }, "verification")
                }
              >
                {busy && busyAction === "verification"
                  ? "Sending code…"
                  : "Send verification code"}
              </button>
            ) : (
              <form
                className="verification-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act(
                    async () => {
                      const result = await runBoundedAuthCall((signal) =>
                        authClient.emailOtp.verifyEmail({
                          email,
                          otp: verificationCode,
                          fetchOptions: { signal },
                        }),
                      );
                      if (result.error) throw new Error(result.error.message);
                      const session = await runBoundedAuthCall((signal) =>
                        authClient.getSession({ fetchOptions: { signal } }),
                      );
                      if (!session.data?.user?.emailVerified) {
                        throw new Error(
                          "Your email was confirmed, but the session could not be updated. Please refresh and try again.",
                        );
                      }
                      window.location.reload();
                    },
                    "verification",
                    (error) => {
                      setVerificationError(
                        error instanceof Error
                          ? error.message
                          : "We could not check that code. Please try again.",
                      );
                      requestAnimationFrame(() =>
                        verificationCodeInput.current?.focus(),
                      );
                    },
                  );
                }}
              >
                <p className="verification-help" role="status">
                  If this address can receive a verification code, check your
                  inbox and spam.
                </p>
                <label>
                  Verification code
                  <input
                    ref={verificationCodeInput}
                    required
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-invalid={Boolean(verificationError)}
                    aria-describedby={
                      verificationError ? "verification-code-error" : undefined
                    }
                    value={verificationCode}
                    onChange={(event) => {
                      setVerificationCode(event.target.value);
                      setVerificationError("");
                    }}
                  />
                  {verificationError && (
                    <small id="verification-code-error" role="alert">
                      {verificationError}
                    </small>
                  )}
                </label>
                <button disabled={busy || !verificationCode.trim()}>
                  {busy && busyAction === "verification"
                    ? "Verifying…"
                    : "Verify email"}
                </button>
                <button
                  type="button"
                  className="verification-resend"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await runBoundedAuthCall((signal) =>
                        authClient.emailOtp.sendVerificationOtp({
                          email,
                          type: "email-verification",
                          fetchOptions: { signal },
                        }),
                      );
                      if (result.error) throw new Error(result.error.message);
                      setVerificationError("");
                      setNoticeKind("success");
                      setNotice(
                        "If this address needs verification, check your inbox and spam for a new code.",
                      );
                    }, "verification")
                  }
                >
                  {busy && busyAction === "verification"
                    ? "Sending a new code…"
                    : "Send a new code"}
                </button>
              </form>
            )}
          </div>
        )}
        {active ? (
          <section className="membership-strip">
            <div>
              <p className="eyebrow">YOUR MEMBERSHIP</p>
              <h2>Make the most of your next move.</h2>
              <p>
                {data.credit
                  ? `$20 proposal credit ${data.credit.state === "reserved" ? "reserved" : "available"} · expires ${date(data.credit.expires_at)}`
                  : "Your next credit arrives with your next paid month."}
              </p>
              <details className="membership-terms">
                <summary>Credit and membership details</summary>
                <p>
                  One credit per paid cycle toward an eligible Ktebli proposal.
                  Credits expire with that cycle and do not stack or roll over.
                  Fit scores are guidance, never odds of winning.{" "}
                  <Link href="/membership-details">
                    Read membership details
                  </Link>
                  .
                </p>
              </details>
            </div>
            <button
              disabled={busy}
              aria-busy={busy && busyAction === "portal"}
              className="button"
              onClick={() =>
                void act(async () => {
                  const r = await api("/api/billing/portal");
                  window.location.assign(r.url);
                }, "portal")
              }
            >
              {busy && busyAction === "portal" ? (
                "Opening membership…"
              ) : (
                <>
                  Manage membership <ExternalLinkIcon />
                </>
              )}
            </button>
          </section>
        ) : null}
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
                Sectors <small>Optional · separate with commas</small>
                <input
                  maxLength={1000}
                  placeholder="Water, education, construction"
                  value={sectorsText}
                  onChange={(e) => setSectorsText(e.target.value)}
                />
              </label>
              <label>
                Where you work <small>Optional · separate with commas</small>
                <input
                  maxLength={1000}
                  value={locationsText}
                  onChange={(e) => setLocationsText(e.target.value)}
                />
              </label>
              <details className="profile-more">
                <summary>
                  More about your work <span>(optional)</span>
                </summary>
                <div className="profile-optional-fields">
                  <label>
                    Qualifications{" "}
                    <small>Optional · separate with commas</small>
                    <input
                      value={qualificationsText}
                      maxLength={2000}
                      onChange={(e) => setQualificationsText(e.target.value)}
                    />
                  </label>
                  <label>
                    Interests <small>Optional · separate with commas</small>
                    <input
                      value={interestsText}
                      maxLength={2000}
                      onChange={(e) => setInterestsText(e.target.value)}
                    />
                  </label>
                  <label>
                    Excluded work or capability gaps{" "}
                    <small>Optional · separate with commas</small>
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
                        setProfile({
                          ...profile,
                          team_capacity: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Working languages{" "}
                    <small>Optional · separate with commas</small>
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
                        setProfile({
                          ...profile,
                          alerts_enabled: e.target.checked,
                        })
                      }
                    />
                    Notify me in this workspace about new strong matches
                  </label>
                </div>
              </details>
              <button
                className="button"
                disabled={busy}
                aria-busy={busy && busyAction === "profile"}
              >
                {busy && busyAction === "profile"
                  ? "Saving profile…"
                  : "Save profile"}
              </button>
            </form>
          </section>
        ) : tab === "alerts" ? (
          <section className="alerts-panel">
            {!active ? (
              <div className="empty">
                <span className="empty-icon" aria-hidden="true">
                  <svg viewBox="0 0 32 32" fill="none">
                    <path d="M24 12a8 8 0 0 0-16 0c0 9-3 9-3 11h22c0-2-3-2-3-11ZM13 27h6" />
                  </svg>
                </span>
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
                        {alert.title} <ExternalLinkIcon />
                      </a>
                    </h2>
                  </div>
                  {!alert.read_at && (
                    <button
                      disabled={busy}
                      aria-busy={busy && busyAction === `alert:${alert.id}`}
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
                        }, `alert:${alert.id}`)
                      }
                    >
                      {busy && busyAction === `alert:${alert.id}`
                        ? "Marking read…"
                        : "Mark read"}
                    </button>
                  )}
                </article>
              ))
            ) : (
              <div className="empty">
                <span className="empty-icon" aria-hidden="true">
                  <svg viewBox="0 0 32 32" fill="none">
                    <path d="M24 12a8 8 0 0 0-16 0c0 9-3 9-3 11h22c0-2-3-2-3-11ZM13 27h6" />
                  </svg>
                </span>
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
            <span className="empty-icon" aria-hidden="true">
              <BookmarkIcon />
            </span>
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
              Open opportunity board <ExternalLinkIcon />
            </button>
          </section>
        ) : (
          <>
            <div className="list-toolbar">
              <div>
                <p className="muted">
                  {boardResetting
                    ? "Loading filtered notices…"
                    : boardError
                      ? "Results unavailable. Previous results remain visible."
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
              className="board-filter-controls"
              role="group"
              aria-label="Filter opportunity board"
            >
              <div className="catalogue-primary-filters">
                <label>
                  Opportunity country
                  <select
                    data-filter="country"
                    value={filters.country}
                    onChange={(e) =>
                      void loadMore(true, tab === "saved", {
                        ...filters,
                        country: e.target.value,
                      })
                    }
                  >
                    <option value="all">Worldwide · all opportunities</option>
                    {[...data.countries]
                      .sort((a, b) =>
                        countryName(a).localeCompare(countryName(b)),
                      )
                      .map((code) => (
                        <option key={code} value={code}>
                          {countryName(code)}
                        </option>
                      ))}
                  </select>
                </label>
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
              </div>
              <p className="board-location-hint">
                Opportunity country reflects the notice scope; eligibility
                varies by notice.
              </p>
              <details className="catalogue-secondary-filters">
                <summary>
                  More filters
                  {activeSecondaryFilters > 0 && (
                    <span>{activeSecondaryFilters} active</span>
                  )}
                </summary>
                <div className="catalogue-filters">
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
                      <option value="grants-gov">Grants.gov</option>
                      <option value="sam-gov">SAM.gov</option>
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
              </details>
            </div>
            {boardBusy && (
              <p role="status" className="muted">
                Loading notices…
              </p>
            )}
            {boardError && (
              <div role="alert" className="notice">
                {boardError} Previous results remain visible.{" "}
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
            <section
              className={`opportunity-grid${boardResetting ? " is-refreshing" : ""}`}
              aria-busy={boardBusy}
              inert={boardResetting || Boolean(boardError)}
            >
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
                  <span className="empty-icon" aria-hidden="true">
                    <BookmarkIcon />
                  </span>
                  <h2>
                    {tab === "saved"
                      ? "Room for your next big idea."
                      : "No notices match these filters."}
                  </h2>
                  <p>
                    {tab === "saved"
                      ? "Save interesting notices from Discover and come back when you’re ready."
                      : "Try another country, type, source, status, deadline, or search term."}
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
                          country: "all",
                        });
                      }
                    }}
                  >
                    {tab === "saved" ? (
                      <>
                        Explore opportunities <ExternalLinkIcon />
                      </>
                    ) : (
                      <>
                        Clear filters <ExternalLinkIcon />
                      </>
                    )}
                  </button>
                </div>
              )}
            </section>
            {!boardError && !boardResetting && data.nextCursor && (
              <button
                className="button subtle"
                disabled={boardBusy}
                onClick={() => void loadMore(false)}
              >
                Load more opportunities
              </button>
            )}
            {(filters.source === "grants-gov" ||
              visible.some(
                (o) =>
                  o.source === "grants-gov" ||
                  o.source_aliases.some(
                    (alias) => alias.source === "grants-gov",
                  ),
              )) && (
              <p className="catalogue-attribution">
                This product uses the Grants.gov API but is not endorsed or
                certified by the U.S. Department of Health and Human Services.
              </p>
            )}
          </>
        )}
        {!active && (
          <aside className="membership-strip membership-quiet">
            <p>
              <strong>Membership:</strong>{" "}
              {billingEnabled
                ? "$20/month checkout is open."
                : "Checkout is not open yet."}{" "}
              Browse public opportunities for free.{" "}
              <Link href="/membership-details">Details</Link>
            </p>
            {billingEnabled && (
              <button
                disabled={busy}
                aria-busy={busy && busyAction === "checkout"}
                className="button subtle"
                onClick={() =>
                  void act(async () => {
                    const r = await api("/api/billing/checkout");
                    window.location.assign(r.url);
                  }, "checkout")
                }
              >
                {busy && busyAction === "checkout"
                  ? "Opening checkout…"
                  : "Join membership"}
              </button>
            )}
          </aside>
        )}
        <footer>
          Built for the work ahead. <span>Ktebli · Lebanon</span>
        </footer>
      </main>
    </div>
  );
}
