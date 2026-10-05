import { handle, requireUser, json, HttpError } from "@/lib/http";
import { dashboardData } from "@/lib/dashboard";
export const GET = (request: Request) =>
  handle(async () => {
    const user = await requireUser();
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "",
      cursor = url.searchParams.get("cursor") ?? "";
    if (query.length > 200 || cursor.length > 500)
      throw new HttpError(400, "Invalid search");
    return json(
      await dashboardData(user.id, {
        query,
        cursor,
        saved: url.searchParams.get("saved") === "1",
      }),
    );
  });
