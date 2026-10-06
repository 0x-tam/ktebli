"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { accountPath } from "@/lib/paths";

type CheckoutState = "loading" | "error" | "needs-login" | "start";

export default function ProposalCheckout() {
  const [state, setState] = useState<CheckoutState>("loading");
  const [message, setMessage] = useState("Preparing your membership credit…");
  const prepared = useRef(false);
  const mounted = useRef(false);
  const request = useRef<{
    controller: AbortController;
    timeout: number;
  } | null>(null);

  const run = useCallback(async () => {
    if (!mounted.current || request.current) return;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 30_000);
    const attempt = { controller, timeout };
    request.current = attempt;
    const isCurrent = () => mounted.current && request.current === attempt;
    setState("loading");
    setMessage("Preparing your membership credit…");

    try {
      if (!prepared.current) {
        const fragment = new URLSearchParams(window.location.hash.slice(1));
        const token = fragment.get("token");
        const tier = fragment.get("tier");
        if (token && tier) {
          sessionStorage.setItem(
            "ktebli-member-checkout",
            JSON.stringify({ token, tier }),
          );
          history.replaceState(null, "", window.location.pathname);
        }
        prepared.current = true;
      }

      const stored = sessionStorage.getItem("ktebli-member-checkout");
      if (!stored) {
        if (isCurrent()) {
          setState("start");
          setMessage(
            "Start your proposal from the opportunity board to use your credit.",
          );
        }
        return;
      }

      const response = await fetch(accountPath("/api/proposal-checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stored,
        signal: controller.signal,
      });
      if (!isCurrent() || controller.signal.aborted) return;
      const data = await response.json();
      if (!isCurrent() || controller.signal.aborted) return;
      if (response.status === 401) {
        setState("needs-login");
        setMessage("Sign in with the same email you used for this proposal.");
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "Checkout unavailable");
      if (!isCurrent()) return;
      sessionStorage.removeItem("ktebli-member-checkout");
      window.location.assign(data.url);
    } catch (error) {
      if (isCurrent()) {
        setState("error");
        setMessage(
          timedOut
            ? "This is taking longer than expected. Your credit details are saved; try again to continue."
            : error instanceof Error
              ? error.message
              : "Please try again",
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (request.current === attempt) request.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => void run(), 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
      const activeRequest = request.current;
      request.current = null;
      if (activeRequest) window.clearTimeout(activeRequest.timeout);
      activeRequest?.controller.abort();
    };
  }, [run]);

  return (
    <main className="auth-shell">
      <Link
        className="brand"
        href="https://ktebli.vercel.app"
        aria-label="Ktebli home"
      >
        KTEBLI<span className="brand-mark">!</span>
      </Link>
      <section className="auth-card" aria-busy={state === "loading"}>
        <h1>Your $20 head start.</h1>
        <p role={state === "error" ? "alert" : "status"}>{message}</p>
        {state === "loading" ? (
          <p className="auth-progress" aria-live="polite">
            Please wait while we prepare the secure checkout.
          </p>
        ) : state === "needs-login" ? (
          <Link className="button" href="/auth">
            Sign in
          </Link>
        ) : state === "start" ? (
          <Link className="button" href="/">
            Browse opportunities
          </Link>
        ) : (
          <div className="checkout-recovery">
            <button className="button" type="button" onClick={() => void run()}>
              Try again
            </button>
          </div>
        )}
        <Link className="checkout-back" href="/dashboard">
          Back to your workspace
        </Link>
      </section>
    </main>
  );
}
