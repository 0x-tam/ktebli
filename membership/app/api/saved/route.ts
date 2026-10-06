import { handle, requireUser, requireMember, readJson, json } from "@/lib/http";
import { userTransaction } from "@/lib/db";
import { uuidSchema } from "@/lib/contracts";
import { z } from "zod";
export const POST = (request: Request) =>
  handle(async () => {
    const user = await requireUser(request);
    await requireMember(user.id);
    const { opportunityId, saved } = z
      .object({ opportunityId: uuidSchema, saved: z.boolean() })
      .strict()
      .parse(await readJson(request));
    await userTransaction(user.id, (db) =>
      saved
        ? db.query(
            "INSERT INTO membership.saved_opportunities(user_id,opportunity_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            [user.id, opportunityId],
          )
        : db.query(
            `DELETE FROM membership.saved_opportunities
             WHERE user_id=$1 AND opportunity_id IN (
               SELECT alias.id FROM membership.opportunities selected
               JOIN membership.opportunities alias ON
                 (selected.identity_key IS NOT NULL AND alias.identity_key=selected.identity_key)
                 OR alias.id=selected.id
               WHERE selected.id=$2
             )`,
            [user.id, opportunityId],
          ),
    );
    return json({ ok: true });
  });
