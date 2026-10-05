import { load } from "cheerio";
import { clean, dateOnly, hash } from "./adapters.mjs";
import { allowedUrl, blockedBody, CrawlError, SafeHttp } from "./safe-http.mjs";

export const MAWRED_URL =
  "https://mawred.org/artistic-creativity/production-awards/?lang=en";
export const MAWRED_SCOPE =
  "One official Culture Resource Production Awards page; no wider grant discovery claim";
function evidenceChunks(text, maximum = 1500) {
  const chunks = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + maximum, text.length);
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > start + maximum / 2) end = space;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks;
}

export function parseMawredAwards(
  html,
  url,
  fetchedAt = new Date().toISOString(),
) {
  if (blockedBody(html)) throw new CrawlError("access_blocked");
  if (allowedUrl(url).href !== MAWRED_URL)
    throw new CrawlError("unexpected_awards_url");
  const $ = load(html);
  if (clean($("h1").first().text()) !== "Production Awards")
    throw new CrawlError("award_schema_changed");
  const text = clean($(".post-content").first().text());
  if (!text || text.length > 12000)
    throw new CrawlError("award_content_exceeds_contract");
  const extract = (pattern) => text.match(pattern)?.[0] ?? null;
  const program = extract(
    /The Production Awards Program, launched in 2004, supports young artists and writers[^.]+\./i,
  );
  const applicationWindow = extract(/Open Call:\s*\d{1,2} [A-Za-z]+,? 20\d\d/);
  const deadlineStatement = extract(
    /Deadline to Apply:\s*\d{1,2} [A-Za-z]+ 20\d\d,\s*\d{1,2}:\d\d Beirut Time/i,
  );
  const birth = extract(
    /Applicants who are born between January 1992 and December 2011\./i,
  );
  const origin = extract(
    /Applicants who originate from an Arab country[^.]+\./i,
  );
  const exclusion = extract(
    /The program does not cover the following domains:[^.]+TV series\./i,
  );
  if (
    !program ||
    !applicationWindow ||
    !deadlineStatement ||
    !birth ||
    !origin ||
    !exclusion
  )
    throw new CrawlError("award_schema_changed");
  const deadline = dateOnly(deadlineStatement);
  const hour = deadlineStatement.match(
    /,\s*([01]?\d|2[0-3]):([0-5]\d) Beirut Time/i,
  );
  const opened = dateOnly(applicationWindow.replace(/,\s*(20\d\d)$/, " $1"));
  if (!deadline || !hour || !opened)
    throw new CrawlError("invalid_award_dates");
  const year = deadline.slice(0, 4);
  const sourceUrl = MAWRED_URL;
  const evidence = [
    { label: "Program", text: program, url: sourceUrl },
    { label: "Open call", text: applicationWindow, url: sourceUrl },
    { label: "Application deadline", text: deadlineStatement, url: sourceUrl },
    { label: "Eligibility: Applicant age", text: birth, url: sourceUrl },
    { label: "Eligibility: Applicant origin", text: origin, url: sourceUrl },
    {
      label: "Eligibility: Excluded activities and organizations",
      text: exclusion,
      url: sourceUrl,
    },
    ...evidenceChunks(text).map((part, index) => ({
      label: `Publisher program content ${index + 1}`,
      text: part,
      url: sourceUrl,
    })),
  ];
  const description = `${program} ${birth} ${origin} ${exclusion}`;
  const content = {
    source: "mawred",
    sourceKey: `mawred:production-awards:${year}`,
    sourceUrl,
    title: `Production Awards ${year} application call`,
    description,
    publishedAt: null,
    deadline,
    deadlineLocal: `${deadline}T${hour[1].padStart(2, "0")}:${hour[2]}`,
    deadlinePrecision: "local_datetime",
    deadlineTimezone: "Asia/Beirut",
    kind: "grant",
    evidence,
    applicationStatus:
      deadline < fetchedAt.slice(0, 10) ? "closed" : "needs_verification",
  };
  return {
    ...content,
    fetchedAt,
    contentHash: hash(content),
    detailStatus: "verified",
    locales: [
      {
        locale: "en",
        sourceUrl,
        title: content.title,
        description,
        publishedAt: null,
        deadline,
        evidence,
        detailStatus: "verified",
        detailFetchedAt: fetchedAt,
      },
    ],
  };
}

export async function crawlMawredAwards({
  state,
  save,
  http = new SafeHttp(),
  now = new Date().toISOString(),
  ttlMs = 24 * 60 * 60 * 1000,
}) {
  if (state.version !== 1) throw new Error("Unsupported Mawred state version");
  const due =
    !state.record ||
    !Number.isFinite(Date.parse(state.record.fetchedAt)) ||
    Date.parse(now) - Date.parse(state.record.fetchedAt) >= ttlMs;
  if (due) {
    state.attemptedAt = now;
    try {
      const response = await http.get(MAWRED_URL);
      state.record = parseMawredAwards(response.body, response.url, now);
      delete state.error;
    } catch (error) {
      state.error = error.code || "request_failed";
    }
    await save(state);
  }
  const fresh = Boolean(
    state.record &&
    !state.error &&
    Date.parse(now) - Date.parse(state.record.fetchedAt) < ttlMs,
  );
  const records = state.record
    ? [
        fresh
          ? state.record
          : {
              ...state.record,
              detailStatus: "partial",
              locales: state.record.locales.map((locale) => ({
                ...locale,
                detailNeedsRefresh: true,
              })),
            },
      ]
    : [];
  return {
    records,
    coverage: {
      status: fresh ? "complete" : "incomplete",
      scope: MAWRED_SCOPE,
      selectedPages: 1,
      freshVerifiedRecords: Number(fresh),
      pendingPages: Number(!fresh),
      attemptedThisRun: Number(due),
      error: state.error ?? null,
      updatedAt: now,
    },
  };
}
