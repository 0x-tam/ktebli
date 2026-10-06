import { handle, requireUser, requireMember, readJson, json } from "@/lib/http";
import { userTransaction } from "@/lib/db";
import { uuidSchema } from "@/lib/contracts";
import { z } from "zod";
export const POST = (request: Request) =>
  handle(async () => {
    const user = await requireUser(request);
    await requireMember(user.id);
    const { id } = z
      .object({ id: uuidSchema })
      .strict()
      .parse(await readJson(request));
    await userTransaction(user.id, (db) =>
      db.query(
        "UPDATE membership.alerts SET read_at=now() WHERE id=$1 AND user_id=$2",
        [id, user.id],
      ),
    );
    return json({ ok: true });
  });
