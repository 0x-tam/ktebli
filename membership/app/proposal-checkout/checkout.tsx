"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { accountPath } from "@/lib/paths";
import { authPath, safeAccountReturn } from "@/lib/navigation";
import { creditQuote } from "@/lib/contracts";
import {
  readCheckoutIntent,
  saveCheckoutIntent,
  validCheckoutIntent,
  type CheckoutIntent,
} from "@/lib/checkout-intent";

type CheckoutState =
  | "checking"
  | "ready"
  | "loading"
  | "error"
  | "needs-login"
  | "start"
  | "unavailable";

export default function ProposalCheckout({
  creditCheckoutEnabled,
}: {
  creditCheckoutEnabled: boolean;
}) {
  const [state, setState] = useState<CheckoutState>("checking");
  const [message, setMessage] = useState("Checking your proposal credit…");
  const [returnTo, setReturnTo] = useState(accountPath("/dashboard"));
  const [intent, setIntent] = useState<CheckoutIntent | null>(null);
  const intentRef = useRef<CheckoutIntent | null>(null);
  const mounted = useRef(false);
  const request = useRef<{
    controller: AbortController;
    timeout: number;
  } | null>(null);

  const run = useCallback(async () => {
    if (!mounted.current || request.current || !creditCheckoutEnabled) return;
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
      let currentIntent = intentRef.current;
      if (!currentIntent) {
        try {
          currentIntent = readCheckoutIntent(window.sessionStorage);
        } catch {
          currentIntent = null;
        }
      }
      if (!validCheckoutIntent(currentIntent)) {
        if (isCurrent()) {
          setState("start");
          setIntent(null);
          setMessage(
            "This checkout handoff expired. Return to your proposal review to request a new one.",
          );
        }
        return;
      }

      const response = await fetch(accountPath("/api/proposal-checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: currentIntent.token,
          tier: currentIntent.tier,
        }),
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
  }, [creditCheckoutEnabled]);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setTimeout(() => {
      const candidate = safeAccountReturn(
        new URLSearchParams(window.location.search).get("returnTo"),
      );
      setReturnTo(
        candidate?.startsWith(accountPath("/dashboard"))
          ? candidate
          : accountPath("/dashboard"),
      );
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = fragment.get("token");
      const tier = fragment.get("tier");
      let currentIntent: CheckoutIntent | null = null;
      if (token && tier) {
        const candidate = { token, tier, savedAt: Date.now() };
        if (validCheckoutIntent(candidate)) {
          currentIntent = candidate;
          try {
            saveCheckoutIntent(
              window.sessionStorage,
              token,
              tier,
              candidate.savedAt,
            );
          } catch {
            // Validated details remain available in memory for this page.
          }
        }
        history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
      } else {
        try {
          currentIntent = readCheckoutIntent(window.sessionStorage);
        } catch {
          currentIntent = null;
        }
      }
      intentRef.current = currentIntent;
      setIntent(currentIntent);
      if (currentIntent) {
        if (creditCheckoutEnabled) {
          setState("ready");
          setMessage(
            new URLSearchParams(window.location.search).get("payment") ===
              "canceled"
              ? "Checkout canceled. Your selected package is still here."
              : "Check your selected package before continuing.",
          );
        } else {
          setState("unavailable");
          setMessage(
            "Membership credit checkout is not open yet. No payment has started.",
          );
        }
      } else {
        setState("start");
        setMessage(
          "Start from your proposal review to check a membership credit.",
        );
      }
    }, 0);
    return () => {
      mounted.current = false;
      window.clearTimeout(timer);
      const activeRequest = request.current;
      request.current = null;
      if (activeRequest) window.clearTimeout(activeRequest.timeout);
      activeRequest?.controller.abort();
    };
  }, [creditCheckoutEnabled]);

  return (
    <main className="auth-shell">
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- Public home is outside this app's /account basePath. */}
      <a className="brand" href="/" aria-label="Ktebli home">
        KTEBLI<span className="brand-mark">!</span>
      </a>
      <section
        className="auth-card"
        aria-busy={state === "loading" || state === "checking"}
      >
        <h1>Check your proposal credit.</h1>
        <p role={state === "error" ? "alert" : "status"}>{message}</p>
        {intent && (
          <div className="checkout-summary">
            <strong>
              {intent.tier === "full"
                ? "Full"
                : intent.tier === "draft"
                  ? "Draft"
                  : "Competitive"}{" "}
              proposal
            </strong>
            <p>Package price: ${creditQuote(intent.tier).listCents / 100}</p>
            <p>Potential membership credit: −$20</p>
            <p>
              Price if eligible: ${creditQuote(intent.tier).totalCents / 100}
            </p>
            <small>
              We check your account, credit and proposal before opening payment.
            </small>
          </div>
        )}
        {state === "loading" || state === "checking" ? (
          <p className="auth-progress" aria-live="polite">
            {state === "checking"
              ? "Checking saved checkout details…"
              : "Please wait while we prepare the secure checkout."}
          </p>
        ) : state === "needs-login" ? (
          <Link
            className="button"
            href={authPath(accountPath("/proposal-checkout")).slice(
              "/account".length,
            )}
          >
            Sign in
          </Link>
        ) : state === "start" ? (
          <Link className="button" href={returnTo.slice("/account".length)}>
            Browse opportunities
          </Link>
        ) : state === "ready" ? (
          <button className="button" type="button" onClick={() => void run()}>
            Check credit and continue
          </button>
        ) : state === "unavailable" ? null : (
          <div className="checkout-recovery">
            <button className="button" type="button" onClick={() => void run()}>
              Try again
            </button>
          </div>
        )}
        <Link
          className="checkout-back"
          href={returnTo.slice("/account".length)}
        >
          Back to opportunities
        </Link>
      </section>
    </main>
  );
}
