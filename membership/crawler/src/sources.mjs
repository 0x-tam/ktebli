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
  },
  {
    id: "cdr",
    enabled: false,
    urls: ["https://www.cdr.gov.lb/en-US/Procurment.aspx"],
    status: "browser_transport_required",
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
  },
];
