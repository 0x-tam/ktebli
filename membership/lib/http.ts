import "server-only";
import { currentUser } from "./auth/server";
import { checkOrigin } from "./contracts";
import { ZodError } from "zod";
import { userTransaction } from "./db";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function requireUser(request?: Request) {
  if (request && request.method !== "GET") {
    try {
      checkOrigin(request, process.env.APP_ORIGIN ?? "http://localhost:3100");
    } catch {
      throw new HttpError(403, "Request origin is not allowed");
    }
  }
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Please sign in");
  return user;
}
export async function requireMember(userId: string) {
  const result = await userTransaction(userId, (db) =>
    db.query(
      "SELECT 1 FROM membership.subscriptions WHERE user_id=$1 AND state='active' AND paid_until>now()",
      [userId],
    ),
  );
  if (!result.rowCount)
    throw new HttpError(402, "An active paid membership is required");
}
export async function readBody(request: Request, maxBytes = 16000) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes)
    throw new HttpError(413, "Request is too large");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, "Request is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "JSON is required");
  const raw = await readBody(request);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
export const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function handle(
  fn: () => Promise<Response>,
  onError?: () => void,
) {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof HttpError) || error.status >= 500) onError?.();
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return json({ error: "Please check the submitted fields" }, 400);
    return json(
      { error: "This request could not be completed. Please try again." },
      503,
    );
  }
}
