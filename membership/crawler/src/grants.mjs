import { clean, dateOnly, hash } from "./adapters.mjs";
import { CrawlError } from "./safe-http.mjs";
// These adapters only consume explicit publisher statements, never an AI guess.
// A closed round remains useful historical context, but cannot become an open lead.
export function staticGrant(snapshot) {
  const { source, sourceUrl, text, fetchedAt } = snapshot;
  let title,
    sourceKey,
    deadline = null,
    publishedAt = null,
    applicationStatus = "needs_verification",
    evidence = [];
  if (source === "australia-dap") {
    const closure = text.match(
      /The Australian Embassy[’']s Direct Aid Program \(DAP\) (\d{4}-\d{2}) round has now closed\./,
    );
    if (!closure) throw new CrawlError("explicit_call_status_missing");
    title = `Australian Embassy Direct Aid Program ${closure[1]}`;
    sourceKey = `australia-dap:${closure[1]}`;
    applicationStatus = "closed";
    evidence = [
      { label: "Publisher round status", text: closure[0], url: sourceUrl },
    ];
  } else if (source === "czech-ssp") {
    const heading = text.match(
      /Call for Proposals: Small Scale Projects \(SSP\) (20\d\d)/,
    );
    const cutoff = text.match(
      /submit their applications.{0,140}no later than\s+(?:[A-Za-z]+,\s*)?([A-Za-z]+) (\d{1,2}), (20\d\d)\./i,
    );
    if (!heading || !cutoff)
      throw new CrawlError("explicit_call_deadline_missing");
    title = heading[0];
    sourceKey = `czech-ssp:${heading[1]}`;
    deadline = dateOnly(`${cutoff[2]} ${cutoff[1]} ${cutoff[3]}`);
    const pub = text.match(/(\d\d)\.(\d\d)\.(20\d\d)\s*\//);
    publishedAt = pub ? dateOnly(`${pub[3]}-${pub[2]}-${pub[1]}`) : null;
    if (!deadline) throw new CrawlError("invalid_call_deadline");
    applicationStatus =
      deadline < fetchedAt.slice(0, 10) ? "closed" : "needs_verification";
    evidence = [
      { label: "Submission deadline", text: cutoff[0], url: sourceUrl },
    ];
    const eligible = text.match(
      /Implementer of the SSP is a local subject.{0,180}/,
    );
    if (eligible)
      evidence.push({
        label: "Applicant eligibility",
        text: eligible[0],
        url: sourceUrl,
      });
  } else throw new CrawlError("static_grant_adapter_unavailable");
  const description = clean(text).slice(0, 6000);
  const content = {
    source,
    sourceKey,
    sourceUrl,
    title,
    description,
    publishedAt,
    deadline,
    kind: "grant",
    evidence,
    applicationStatus,
    deadlinePrecision: deadline ? "date" : "unknown",
    deadlineTimezone: null,
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
        title,
        description,
        publishedAt,
        deadline,
        evidence,
      },
    ],
  };
}
export function staticGrantArtifact(watchState) {
  const records = [],
    streams = {};
  for (const id of ["australia-dap", "czech-ssp"]) {
    const source = watchState.sources[id];
    try {
      if (source?.status !== "watch_only" || !source.snapshot)
        throw new CrawlError(source?.error || "watch_unavailable");
      records.push(staticGrant(source.snapshot));
      streams[`${id}:en`] = {
        status: "complete",
        pages: 1,
        uniqueRecords: 1,
        expectedTotal: 1,
        cursor: null,
        scope:
          "one explicit published round; not an assertion about every program",
      };
    } catch (e) {
      streams[`${id}:en`] = {
        status: "incomplete",
        error: e.code || "extraction_failed",
        pages: 0,
        uniqueRecords: 0,
        cursor: null,
      };
    }
  }
  return {
    records,
    coverage: {
      status: Object.values(streams).every((s) => s.status === "complete")
        ? "complete"
        : "incomplete",
      scope: "explicit static embassy call pages",
      uniqueRecords: records.length,
      streams,
      updatedAt: new Date().toISOString(),
    },
  };
}
