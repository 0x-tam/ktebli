"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { accountPath } from "@/lib/paths";
export default function ProposalCheckout() {
  const [message, setMessage] = useState("Preparing your membership credit…");
  const [needsLogin, setNeedsLogin] = useState(false);
  useEffect(() => {
    async function run() {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = fragment.get("token"),
        tier = fragment.get("tier");
      if (token && tier) {
        sessionStorage.setItem(
          "ktebli-member-checkout",
          JSON.stringify({ token, tier }),
        );
        history.replaceState(null, "", window.location.pathname);
      }
      const stored = sessionStorage.getItem("ktebli-member-checkout");
      if (!stored) {
        setMessage(
          "Start your proposal from the opportunity board to use your credit.",
        );
        return;
      }
      try {
        const response = await fetch(accountPath("/api/proposal-checkout"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: stored,
        });
        const data = await response.json();
        if (response.status === 401) {
          setNeedsLogin(true);
          setMessage("Sign in with the same email you used for this proposal.");
          return;
        }
        if (!response.ok) throw new Error(data.error ?? "Checkout unavailable");
        sessionStorage.removeItem("ktebli-member-checkout");
        window.location.assign(data.url);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Please try again");
      }
    }
    void run();
  }, []);
  return (
    <main className="auth-shell">
      <Link className="brand" href="https://ktebli.vercel.app">
        ktebli
      </Link>
      <section className="auth-card">
        <h1>Your $20 head start.</h1>
        <p role="status">{message}</p>
        {needsLogin ? (
          <Link className="button" href="/auth">
            Sign in ↗
          </Link>
        ) : (
          <Link className="button" href="/dashboard">
            Back to your workspace ↗
          </Link>
        )}
      </section>
    </main>
  );
}
