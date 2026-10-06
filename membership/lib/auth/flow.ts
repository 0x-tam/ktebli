export class AuthRequestTimeoutError extends Error {
  constructor() {
    super(
      "The request took too long. Its outcome is uncertain; check your inbox before trying again.",
    );
    this.name = "AuthRequestTimeoutError";
  }
}

export async function runBoundedAuthCall<T>(
  call: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => call(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AuthRequestTimeoutError());
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type AuthError = { code?: string; status?: number; message?: string };

function authError(error: unknown): AuthError {
  return typeof error === "object" && error !== null
    ? (error as AuthError)
    : {};
}

export function codeErrorMessage(error: unknown): string {
  const issue = authError(error);
  const code = issue.code?.toUpperCase();
  if (code === "OTP_EXPIRED")
    return "This code expired. Request a new code and try again.";
  if (code === "TOO_MANY_ATTEMPTS" || issue.status === 429)
    return "Too many attempts. Wait a little before trying again.";
  if (code === "INVALID_OTP" || code === "OTP_NOT_FOUND")
    return "That code did not work. Check the digits and try again.";
  return "We could not check that code. Please try again.";
}

export function isCodeError(error: unknown): boolean {
  const issue = authError(error);
  return (
    [
      "OTP_EXPIRED",
      "TOO_MANY_ATTEMPTS",
      "INVALID_OTP",
      "OTP_NOT_FOUND",
    ].includes(issue.code?.toUpperCase() ?? "") || issue.status === 429
  );
}
