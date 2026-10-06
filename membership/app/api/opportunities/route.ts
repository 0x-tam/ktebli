import { handle, requireUser, json, HttpError } from "@/lib/http";
import { catalogueFiltersSchema, catalogueData } from "@/lib/dashboard";
export const GET = (request: Request) =>
  handle(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const allowed = new Set([
      "q",
      "cursor",
      "saved",
      "kind",
      "source",
      "status",
      "deadline",
    ]);
    if ([...url.searchParams.keys()].some((key) => !allowed.has(key)))
      throw new HttpError(400, "Invalid catalogue filter");
    const saved = url.searchParams.get("saved");
    if (saved !== null && saved !== "1")
      throw new HttpError(400, "Invalid saved filter");
    return json(
      await catalogueData(
        user.id,
        catalogueFiltersSchema.parse({
          query: url.searchParams.get("q") ?? "",
          cursor: url.searchParams.get("cursor") || undefined,
          kind: url.searchParams.get("kind") ?? "all",
          source: url.searchParams.get("source") ?? "all",
          status: url.searchParams.get("status") ?? "all",
          deadline: url.searchParams.get("deadline") ?? "all",
          saved: saved === "1",
        }),
      ),
    );
  });
