import { handle, HttpError, json, requireUser } from "@/lib/http";
import { uuidSchema } from "@/lib/contracts";
import { loadPublicOpportunityHandoff } from "@/lib/opportunity-handoff";
import { userTransaction } from "@/lib/db";

// A catalogue ID is a source hint for the ordinary proposal intake. It never
// carries a package, credit, customer identity or permission to skip review.
export const GET = (request: Request) =>
  handle(async () => {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => key !== "id"))
      throw new HttpError(400, "Invalid opportunity reference");
    const parsed = uuidSchema.safeParse(params.get("id"));
    if (!parsed.success)
      throw new HttpError(400, "Invalid opportunity reference");
    return json(
      await userTransaction(user.id, (db) =>
        loadPublicOpportunityHandoff(db, parsed.data),
      ),
    );
  });
