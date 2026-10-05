"use client";
import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import { accountPath } from "@/lib/paths";
export default function AuthPage() {
  const [mode, setMode] = useState<"signIn" | "signUp" | "otp" | "verify">(
    "signIn",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (mode === "verify") {
        const result = await authClient.emailOtp.verifyEmail({
          email,
          otp: code,
        });
        if (result.error)
          throw new Error(result.error.message ?? "Could not verify email");
        const session = await authClient.getSession();
        if (session.data?.user?.emailVerified) {
          window.location.assign(
            accountPath(
              sessionStorage.getItem("ktebli-member-checkout")
                ? "/proposal-checkout"
                : "/dashboard",
            ),
          );
        } else {
          setMode("signIn");
          setMessage("Email verified. Sign in to continue.");
        }
        return;
      }
      if (mode === "otp" && !sent) {
        const result = await authClient.emailOtp.sendVerificationOtp({
          email,
          type: "sign-in",
        });
        if (result.error)
          throw new Error(result.error.message ?? "Could not send code");
        setSent(true);
        setMessage("Check your email for a sign-in code.");
        return;
      }
      if (mode === "signUp") {
        const result = await authClient.signUp.email({ email, password, name });
        if (result.error)
          throw new Error(result.error.message ?? "Could not create account");
        setMode("verify");
        setCode("");
        setMessage(
          "Account created. Enter the verification code sent to your email.",
        );
        return;
      }
      const result =
        mode === "otp"
          ? await authClient.signIn.emailOtp({ email, otp: code })
          : await authClient.signIn.email({ email, password });
      if (result.error?.code === "EMAIL_NOT_VERIFIED") {
        setMode("verify");
        setCode("");
        setMessage("Check your email for a verification code.");
        return;
      }
      if (result.error)
        throw new Error(result.error.message ?? "Could not sign in");
      if (!result.data?.user?.emailVerified) {
        setMode("verify");
        setCode("");
        setMessage("Verify your email to continue.");
        return;
      }
      const session = await authClient.getSession();
      if (!session.data?.user?.emailVerified) {
        setMessage(
          "Your session could not be confirmed. Please sign in again.",
        );
        return;
      }
      window.location.assign(
        accountPath(
          sessionStorage.getItem("ktebli-member-checkout")
            ? "/proposal-checkout"
            : "/dashboard",
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again");
    } finally {
      setBusy(false);
    }
  }
  async function resendVerification() {
    setBusy(true);
    setMessage("");
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });
      if (result.error)
        throw new Error(result.error.message ?? "Could not send code");
      setMessage("A new verification code was sent to your email.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please try again");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <Link className="brand" href="https://ktebli.vercel.app">
        ktebli
      </Link>
      <section className="auth-card">
        <p className="eyebrow">A LITTLE MORE POSSIBILITY</p>
        <h1>
          {mode === "signUp"
            ? "Make yourself known."
            : mode === "verify"
              ? "Verify your email."
              : mode === "otp"
                ? "Check your inbox."
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
              disabled={busy}
              onClick={() => {
                setMode(value);
                setMessage("");
                setSent(false);
                setCode("");
              }}
            >
              {value === "signIn"
                ? "Sign in"
                : value === "signUp"
                  ? "Create account"
                  : "Email code"}
            </button>
          ))}
        </div>
        <form onSubmit={submit}>
          {mode === "signUp" && (
            <label>
              Your name
              <input
                required
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
              type="email"
              maxLength={254}
              autoComplete="email"
              readOnly={mode === "verify"}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setSent(false);
                setCode("");
              }}
            />
          </label>
          {mode !== "otp" && mode !== "verify" && (
            <label>
              Password
              <input
                required
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
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          )}
          <button className="button" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "signUp"
                ? "Create account"
                : mode === "otp" && !sent
                  ? "Send sign-in code"
                  : mode === "verify"
                    ? "Verify email"
                    : "Sign in"}{" "}
            <span>↗</span>
          </button>
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
    </main>
  );
}
