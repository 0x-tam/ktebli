import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";
let instance: ReturnType<typeof createNeonAuth> | undefined;
export function auth() {
  if (!instance) {
    const baseUrl = process.env.NEON_AUTH_BASE_URL;
    const secret = process.env.NEON_AUTH_COOKIE_SECRET;
    if (!baseUrl || !secret || secret.length < 32)
      throw new Error("Authentication is not configured");
    instance = createNeonAuth({
      baseUrl,
      cookies: { secret, sessionDataTtl: 1 },
    });
  }
  return instance;
}
export async function currentUser() {
  const { data } = await auth().getSession();
  return data?.user?.emailVerified ? data.user : null;
}
