// Research watchlist; only qualified adapters are enabled. A watch URL is not an
// active call, and a future adapter must get its own robots/allowlist review.
export const sources = [
  {
    id: "ppa",
    enabled: true,
    urls: [
      "https://www.ppa.gov.lb/ar/tenders",
      "https://www.ppa.gov.lb/en/tenders",
    ],
    status: "listing_adapter",
    coverage:
      "Complete bilingual listings; detail verification is a separate, incomplete backlog",
  },
  {
    id: "cdr",
    enabled: false,
    urls: ["https://www.cdr.gov.lb/en-US/Procurment.aspx"],
    status: "automated_access_blocked_403",
    coverage:
      "43 Ongoing notices captured manually; unattended collection is unavailable",
    stages: ["Ongoing", "Archive", "Others"],
  },
  {
    id: "japan-ggp",
    enabled: false,
    url: "https://www.lb.emb-japan.go.jp/itpr_en/ggpweb.html",
    status: "watchlist_only",
  },
  {
    id: "australia-dap",
    enabled: false,
    url: "https://lebanon.embassy.gov.au/birt/development_cooperat.html",
    status: "watchlist_only",
  },
  {
    id: "czech-ssp",
    enabled: false,
    url: "https://mzv.gov.cz/beirut/en/humanitarian_development_cooperation/call_for_proposals_small_scale_projects.html",
    status: "watchlist_only",
  },
  {
    id: "canada-cfli",
    enabled: false,
    url: "https://www.international.gc.ca/country-pays/lebanon-liban/beirut-beyrouth.aspx?lang=eng",
    status: "watchlist_only",
  },
  {
    id: "eeas",
    enabled: false,
    url: "https://www.eeas.europa.eu/eeas/tenders_en?s=325",
    status: "watchlist_only",
  },
  {
    id: "aics",
    enabled: false,
    url: "https://trasparenzabeirut.aics.gov.it/index.php?id_sezione=952",
    status: "watchlist_only",
  },
  {
    id: "undp",
    enabled: false,
    url: "https://procurement-notices.undp.org/",
    status: "watchlist_only",
  },
  {
    id: "ungm",
    enabled: false,
    url: "https://www.ungm.org/Public/Notice",
    status: "watchlist_only",
    adapter: "curated_detail_urls_only",
    coverage:
      "11 reviewed official detail URLs; public discovery is unqualified",
  },
  {
    id: "mawred",
    enabled: true,
    url: "https://mawred.org/artistic-creativity/production-awards/?lang=en",
    status: "fixed_page_adapter",
    coverage:
      "One verified current Production Awards call; no broader Mawred discovery",
  },
  {
    id: "worldbank",
    enabled: true,
    url: "https://search.worldbank.org/api/v2/procnotices",
    status: "lebanon_api_adapter",
    coverage:
      "Current procurement notices with explicit project country Lebanon; bidder eligibility unverified",
  },
  {
    id: "eu-funding-tenders",
    enabled: false,
    url: "https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis",
    status: "api_unqualified_http_500",
    coverage:
      "Two bounded public API probes failed; no Lebanon eligibility field qualified",
  },
  {
    id: "afac",
    enabled: false,
    url: "https://www.arabculturefund.org/Programs/",
    status: "watch_closed_rounds",
    coverage: "Listed 2026 open-call deadlines had passed by 2026-10-06",
  },
];
