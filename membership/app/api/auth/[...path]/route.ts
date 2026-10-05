import { auth } from "@/lib/auth/server";
import type { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function privateAuthResponse(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  const vary = headers.get("Vary");
  if (
    !vary?.split(",").some((value) => value.trim().toLowerCase() === "cookie")
  )
    headers.set("Vary", vary ? `${vary}, Cookie` : "Cookie");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
export async function GET(request: NextRequest, context: Context) {
  return privateAuthResponse(await auth().handler().GET(request, context));
}
export async function POST(request: NextRequest, context: Context) {
  return privateAuthResponse(await auth().handler().POST(request, context));
}
