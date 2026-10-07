import { accountPath } from "./paths";
import { ISO_COUNTRY_CODES } from "./contracts";

export type BoardTab = "discover" | "saved" | "alerts" | "profile";
export type BoardFilters = {
  query: string;
  kind: string;
  source: string;
  status: string;
  deadline: string;
  country: string;
};

export const defaultBoardFilters: BoardFilters = {
  query: "",
  kind: "all",
  source: "all",
  status: "all",
  deadline: "all",
  country: "all",
};

const allowed: Record<
  Exclude<keyof BoardFilters, "query" | "country">,
  string[]
> = {
  kind: ["all", "procurement", "grant", "unknown"],
  source: [
    "all",
    "ppa",
    "ungm",
    "mawred",
    "worldbank",
    "cdr",
    "grants-gov",
    "sam-gov",
  ],
  status: ["all", "current", "needs_review", "closed"],
  deadline: ["all", "future", "today", "past", "unknown"],
};

export function parseBoardView(params: URLSearchParams): {
  tab: BoardTab;
  filters: BoardFilters;
} {
  const rawTab = params.get("tab");
  const tab: BoardTab =
    rawTab === "saved" || rawTab === "alerts" || rawTab === "profile"
      ? rawTab
      : "discover";
  const filters = { ...defaultBoardFilters };
  filters.query = (params.get("q") ?? "").slice(0, 180);
  for (const key of ["kind", "source", "status", "deadline"] as const) {
    const value = params.get(key);
    if (value && allowed[key].includes(value)) filters[key] = value;
  }
  const country = params.get("country");
  if (
    country &&
    ISO_COUNTRY_CODES.includes(country as (typeof ISO_COUNTRY_CODES)[number])
  )
    filters.country = country;
  return { tab, filters };
}

export function boardPath(tab: BoardTab, filters: BoardFilters): string {
  const params = new URLSearchParams();
  if (tab !== "discover") params.set("tab", tab);
  if (filters.query) params.set("q", filters.query.slice(0, 180));
  for (const key of [
    "kind",
    "source",
    "status",
    "deadline",
    "country",
  ] as const) {
    if (filters[key] !== "all") params.set(key, filters[key]);
  }
  const suffix = params.toString();
  return `${accountPath("/dashboard")}${suffix ? `?${suffix}` : ""}`;
}

// Return destinations are deliberately narrow. Never forward auth or payment
// callbacks to an arbitrary URL supplied by the browser.
export function safeAccountReturn(
  value: string | null | undefined,
): string | null {
  if (
    !value ||
    !value.startsWith("/account/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return null;
  try {
    const url = new URL(value, "https://ktebli.invalid");
    if (url.origin !== "https://ktebli.invalid" || url.hash) return null;
    if (url.pathname === accountPath("/proposal-checkout")) {
      return accountPath("/proposal-checkout");
    }
    if (url.pathname !== accountPath("/dashboard")) return null;
    const { tab, filters } = parseBoardView(url.searchParams);
    return boardPath(tab, filters);
  } catch {
    return null;
  }
}

export function authPath(returnTo?: string): string {
  const safe = safeAccountReturn(returnTo);
  return `${accountPath("/auth")}${safe ? `?returnTo=${encodeURIComponent(safe)}` : ""}`;
}
