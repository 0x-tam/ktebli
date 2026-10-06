"use client";
import { createAuthClient } from "@neondatabase/auth";
import { BetterAuthReactAdapter } from "@neondatabase/auth/react/adapters";

// The Next convenience client always targets /api/auth. The account lives at
// /account, so use Neon's supported adapter with the explicit same-origin path.
const origin =
  typeof window === "undefined"
    ? "http://localhost:3100"
    : window.location.origin;
export const authClient = createAuthClient(`${origin}/account/api/auth`, {
  adapter: BetterAuthReactAdapter(),
});
