"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import { accountPath } from "@/lib/paths";
import {
  AuthRequestTimeoutError,
  codeErrorMessage,
  isCodeError,
  runBoundedAuthCall,
} from "@/lib/auth/flow";
import "./auth.css";

type Mode = "signIn" | "signUp" | "otp" | "verify";
type Phase =
  | "creating"
  | "sending"
  | "verifying"
  | "signing-in"
  | "confirming"
  | "redirecting";

const phaseMessage: Record<Phase, string> = {
  creating: "Creating your account…",
  sending: "Requesting your code…",
  verifying: "Checking your code…",
  "signing-in": "Signing you in…",
  confirming: "Confirming your session…",
  redirecting: "Opening your account…",
};

function failureMessage(error: unknown, fallback: string): string {
  if (error instanceof AuthRequestTimeoutError) return error.message;
  const issue = error as { code?: string; status?: number } | null;
  if (issue?.status === 429 || issue?.code === "TOO_MANY_ATTEMPTS")
    return "Too many attempts. Wait a little before trying again.";
  if (issue?.code === "INVALID_EMAIL_OR_PASSWORD")
    return "Email or password did not match.";
  return fallback;
}
export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [message, setMessage] = useState("");
  const [codeError, setCodeError] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const busy = phase !== null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function begin(nextPhase: Phase): boolean {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPhase(nextPhase);
    setMessage("");
    setCodeError("");
    return true;
  }

  function finish() {
    inFlight.current = false;
    if (mounted.current) setPhase(null);
  }

  function focusCodeError() {
    requestAnimationFrame(() => codeInput.current?.focus());
  }

  function openAccount() {
    setPhase("redirecting");
    window.location.assign(
      accountPath(
        sessionStorage.getItem("ktebli-member-checkout")
          ? "/proposal-checkout"
          : "/dashboard",
      ),
    );
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const currentMode = mode;
    const codeAttempt =
      currentMode === "verify" || (currentMode === "otp" && sent);
    const initialPhase: Phase =
      currentMode === "signUp"
        ? "creating"
        : codeAttempt
          ? "verifying"
          : currentMode === "otp"
            ? "sending"
            : "signing-in";
    if (!begin(initialPhase)) return;
    let redirecting = false;
    try {
      if (currentMode === "verify") {
        const result = await runBoundedAuthCall((signal) =>
          authClient.emailOtp.verifyEmail({
            email,
            otp: code,
            fetchOptions: { signal },
          }),
        );
        if (!mounted.current) return;
        if (result.error) throw result.error;
        setPhase("confirming");
        const session = await runBoundedAuthCall((signal) =>
          authClient.getSession({ fetchOptions: { signal } }),
        );
        if (!mounted.current) return;
        if (session.data?.user?.emailVerified) {
          openAccount();
          redirecting = true;
        } else {
          setMode("signIn");
          setCode("");
          setMessage("Email verified. Sign in to continue.");
        }
        return;
      }
      if (currentMode === "otp" && !sent) {
        const result = await runBoundedAuthCall((signal) =>
          authClient.emailOtp.sendVerificationOtp({
            email,
            type: "sign-in",
            fetchOptions: { signal },
          }),
        );
        if (!mounted.current) return;
        if (result.error) throw result.error;
        setSent(true);
        setMessage(
          "If this address can receive a sign-in code, check your inbox and spam.",
        );
        return;
      }
      if (currentMode === "signUp") {
        const result = await runBoundedAuthCall((signal) =>
          authClient.signUp.email({
            email,
            password,
            name,
            fetchOptions: { signal },
          }),
        );
        if (!mounted.current) return;
        if (result.error) throw result.error;
        setMode("verify");
        setCode("");
        setMessage(
          "If this address needs verification, check your inbox and spam for a code. Already have an account? Select Sign in.",
        );
        return;
      }
      const result = await runBoundedAuthCall((signal) =>
        currentMode === "otp"
          ? authClient.signIn.emailOtp({
              email,
              otp: code,
              fetchOptions: { signal },
            })
          : authClient.signIn.email({
              email,
              password,
              fetchOptions: { signal },
            }),
      );
      if (!mounted.current) return;
      if (result.error?.code === "EMAIL_NOT_VERIFIED") {
        setMode("verify");
        setCode("");
        setMessage(
          "This address needs verification. Check your inbox or request a new code below.",
        );
        return;
      }
      if (result.error) throw result.error;
      if (!result.data?.user?.emailVerified) {
        setMode("verify");
        setCode("");
        setMessage("Verify your email to continue.");
        return;
      }
      setPhase("confirming");
      const session = await runBoundedAuthCall((signal) =>
        authClient.getSession({ fetchOptions: { signal } }),
      );
      if (!mounted.current) return;
      if (!session.data?.user?.emailVerified) {
        setMessage(
          "Your session could not be confirmed. Please sign in again.",
        );
        return;
      }
      openAccount();
      redirecting = true;
    } catch (error) {
      if (!mounted.current) return;
      if (codeAttempt) {
        setCodeError(
          error instanceof AuthRequestTimeoutError
            ? "Checking took too long. Your code may have worked; try signing in before requesting another."
            : isCodeError(error)
              ? codeErrorMessage(error)
              : "We could not check that code. Please try again.",
        );
        focusCodeError();
      } else {
        setMessage(
          failureMessage(
            error,
            "We could not complete this step. Please try again.",
          ),
        );
      }
    } finally {
      if (!redirecting) finish();
    }
  }
  async function resendVerification() {
    if (!begin("sending")) return;
    try {
      const result = await runBoundedAuthCall((signal) =>
        authClient.emailOtp.sendVerificationOtp({
          email,
          type: "email-verification",
          fetchOptions: { signal },
        }),
      );
      if (!mounted.current) return;
      if (result.error) throw result.error;
      setMessage(
        "If this address needs verification, check your inbox and spam for a new code.",
      );
    } catch (error) {
      if (mounted.current)
        setMessage(
          failureMessage(
            error,
            "We could not request a new code. Try again later.",
          ),
        );
    } finally {
      finish();
    }
  }
  return (
    <main className="auth-shell">
      <header className="auth-topbar">
        <Link
          className="brand"
          href="https://ktebli.vercel.app"
          aria-label="Ktebli home"
        >
          KTEBLI<span className="brand-mark">!</span>
        </Link>
        <Link className="auth-back" href="https://ktebli.vercel.app">
          Back to Ktebli
        </Link>
      </header>
      <div className="auth-layout">
        <aside className="auth-intro">
          <p className="eyebrow">MADE FOR AMBITION IN LEBANON</p>
          <h2>Find the right opportunity. Take a clearer next step.</h2>
          <p className="muted">
            Create your free account and browse public opportunities now. When
            membership opens, you can save notices and see how they fit your
            work.
          </p>
          <div className="auth-note">
            <p>Browsing is free. Membership checkout is not open yet.</p>
          </div>
        </aside>
        <section className="auth-card">
          <p className="eyebrow">A LITTLE MORE POSSIBILITY</p>
          <h1>
            {mode === "signUp"
              ? "Make yourself known."
              : mode === "verify"
                ? "Verify your email."
                : mode === "otp"
                  ? sent
                    ? "Check your inbox."
                    : "Sign in by email code."
                  : "Welcome back."}
          </h1>
          <p className="muted">
            Your next opportunity starts with a clearer picture of you.
          </p>
          <div className="tabs">
            {(["signIn", "signUp", "otp"] as const).map((value) => (
              <button
                className={mode === value ? "active" : ""}
                key={value}
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode(value);
                  setMessage("");
                  setCodeError("");
                  setSent(false);
                  setCode("");
                }}
              >
                {value === "signIn"
                  ? "Sign in"
                  : value === "signUp"
                    ? "Sign up"
                    : "Email code"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} aria-busy={busy}>
            {mode === "signUp" && (
              <label>
                Your name
                <input
                  required
                  disabled={busy}
                  maxLength={120}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            )}
            <label>
              Email address
              <input
                required
                disabled={busy}
                type="email"
                maxLength={254}
                autoComplete="email"
                readOnly={mode === "verify"}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setSent(false);
                  setCode("");
                  setCodeError("");
                  setMessage("");
                }}
              />
            </label>
            {mode !== "otp" && mode !== "verify" && (
              <label>
                Password
                <input
                  required
                  disabled={busy}
                  type="password"
                  minLength={8}
                  maxLength={128}
                  autoComplete={
                    mode === "signUp" ? "new-password" : "current-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {((mode === "otp" && sent) || mode === "verify") && (
              <label>
                {mode === "verify" ? "Verification code" : "Email code"}
                <input
                  ref={codeInput}
                  required
                  disabled={busy}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={12}
                  aria-invalid={Boolean(codeError)}
                  aria-describedby={codeError ? "auth-code-error" : undefined}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setCodeError("");
                    setMessage("");
                  }}
                />
                {codeError && (
                  <span
                    className="auth-code-error"
                    id="auth-code-error"
                    role="alert"
                  >
                    {codeError}
                  </span>
                )}
              </label>
            )}
            <button className="button auth-submit" disabled={busy}>
              {busy
                ? phaseMessage[phase]
                : mode === "signUp"
                  ? "Create account"
                  : mode === "otp" && !sent
                    ? "Send sign-in code"
                    : mode === "otp"
                      ? "Sign in with code"
                      : mode === "verify"
                        ? "Verify email"
                        : "Sign in"}{" "}
              {busy ? (
                <span className="auth-spinner" aria-hidden="true" />
              ) : (
                <span aria-hidden="true">↗</span>
              )}
            </button>
            {busy && (
              <p className="auth-progress" role="status" aria-live="polite">
                {phaseMessage[phase]}
              </p>
            )}
            {mode === "signUp" && (
              <p className="fine">
                Before creating an account, read how your{" "}
                <Link href="/data-use">account data is used</Link>.
              </p>
            )}
            {message && (
              <p role="status" className="notice">
                {message}
              </p>
            )}
          </form>
          {mode === "verify" && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={resendVerification}
            >
              Send a new code
            </button>
          )}
          <p className="fine">
            Use “Email code” to sign in without your password.
          </p>
        </section>
      </div>
    </main>
  );
}
