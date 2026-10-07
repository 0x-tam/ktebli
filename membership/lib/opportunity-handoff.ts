import "server-only";
import type { PoolClient } from "pg";
import { sourceUrlSchema } from "./contracts";
import { HttpError } from "./http";

// The regular one-off intake receives only a public source hint. Paid credits,
// profile fields, and any authority to skip source review are never returned.
export async function loadPublicOpportunityHandoff(db: PoolClient, id: string) {
  const result = await db.query(
    `SELECT o.id,o.title,o.description,o.source,o.source_url,o.kind,
            o.deadline::text AS deadline,o.deadline_conflict,
            CASE
              WHEN o.application_status IN ('closed','not_open_competition') OR o.deadline<CURRENT_DATE THEN 'closed'
              WHEN o.deadline>CURRENT_DATE AND o.detail_status='verified'
                AND NOT o.deadline_conflict AND o.fetched_at>now()-interval '24 hours'
                AND NOT EXISTS (
                  SELECT 1 FROM membership.opportunities sibling
                  WHERE sibling.identity_key=o.identity_key AND sibling.id<>o.id
                    AND sibling.detail_status='verified'
                    AND sibling.fetched_at>now()-interval '24 hours'
                    AND (sibling.deadline IS DISTINCT FROM o.deadline
                      OR sibling.kind IS DISTINCT FROM o.kind
                      OR sibling.application_status IN ('closed','not_open_competition')
                      OR sibling.deadline_conflict)
                ) THEN 'current'
              ELSE 'needs_review'
            END AS status
     FROM membership.opportunities o WHERE o.id=$1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new HttpError(404, "Opportunity not found");
  return {
    id: row.id as string,
    title: (row.title as string).slice(0, 240),
    description: (row.description as string).slice(0, 500),
    source: row.source as string,
    sourceUrl: sourceUrlSchema.parse(row.source_url),
    kind: row.kind as string,
    deadline: row.deadline as string | null,
    deadlineConflict: row.deadline_conflict as boolean,
    status: row.status as string,
  };
}
