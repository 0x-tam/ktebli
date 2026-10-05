// Account-authenticated local provisioning only. Never deploy this script.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";

const cli = "/Users/Tamam/.nvm/versions/node/v20.19.4/bin/neon";
const project = "green-shadow-66380714";
const branch = "br-falling-thunder-b19x4p2p";
const scope = ["--project-id", project, "--branch", branch];
const reportPath = "reports/neon-provisioning.json";
function neon(args: string[]) {
  return execFileSync(cli, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function envFile(path: string) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}
function saveEnv(path: string, values: Record<string, string>) {
  writeFileSync(
    path,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  chmodSync(path, 0o600);
}
const report: Record<string, unknown> = {
  projectId: project,
  projectName: "Ktebli",
  region: "aws-eu-central-1",
  branchId: branch,
  branchName: "dev-membership",
  dashboardUrl: `https://console.neon.tech/app/projects/${project}`,
  compute: {
    minCU: 0.25,
    maxCU: 0.25,
    suspendTimeoutSetting: 0,
    policy: "account default; explicit 300 rejected without project creation",
  },
  productionDeployment: false,
  liveBillingOrMatchingCalls: false,
  authSignupSigninAndEmailDeliveryVerified: false,
};
async function run() {
  const meta = JSON.parse(
    neon(["branch", "get", branch, "--project-id", project, "-o", "json"]),
  );
  const info = meta.branch ?? meta;
  if (
    info.id !== branch ||
    info.name !== "dev-membership" ||
    info.default ||
    info.primary
  )
    throw new Error("Isolated branch guard failed");
  const ownerPath = ".env.migrations.local";
  let owner: string;
  if (existsSync(ownerPath)) owner = envFile(ownerPath).DATABASE_URL_UNPOOLED;
  else {
    owner = neon([
      "connection-string",
      branch,
      "--project-id",
      project,
      "--role-name",
      "neondb_owner",
      "--database-name",
      "neondb",
    ]);
    saveEnv(ownerPath, { DATABASE_URL_UNPOOLED: owner });
  }
  if (
    new URL(owner).hostname !==
    "ep-autumn-feather-b1fk17te.c-5.eu-central-1.aws.neon.tech"
  )
    throw new Error("Direct development endpoint guard failed");
  execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], {
    env: {
      ...process.env,
      DATABASE_URL_UNPOOLED: owner,
      CONFIRM_MEMBERSHIP_BRANCH: "yes",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const roles = [
    [
      "ktebli_membership_app",
      "membership_runtime",
      "DATABASE_URL",
      ".env.local",
    ],
    [
      "ktebli_membership_billing",
      "membership_billing",
      "BILLING_DATABASE_URL",
      ".env.local",
    ],
    [
      "ktebli_membership_worker",
      "membership_worker",
      "WORKER_DATABASE_URL",
      ".env.worker.local",
    ],
  ];
  const local = existsSync(".env.local")
    ? envFile(".env.local")
    : envFile(".env.example");
  const worker = existsSync(".env.worker.local")
    ? envFile(".env.worker.local")
    : {};
  delete local.DATABASE_URL_UNPOOLED;
  delete local.WORKER_DATABASE_URL;
  local.NEON_AUTH_COOKIE_SECRET ||= randomBytes(32).toString("hex");
  local.MEMBERSHIP_BILLING_ENABLED = "false";
  local.MEMBERSHIP_MATCHING_ENABLED = "false";
  local.MEMBERSHIP_CREDIT_BRIDGE_ENABLED = "false";
  local.MEMBERSHIP_MATCHING_BUDGET_USD = "0";
  const admin = new Pool({ connectionString: owner });
  try {
    for (const [login, role, key, file] of roles) {
      const values = file === ".env.local" ? local : worker;
      const found = (
        await admin.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [login])
      ).rowCount;
      if (found && !values[key])
        throw new Error(
          "Existing login has no saved local credential; refusing password reset",
        );
      if (!values[key]) {
        const url = new URL(owner);
        url.username = login;
        url.password = randomBytes(32).toString("hex");
        url.hostname = url.hostname.replace(".c-5.", "-pooler.c-5.");
        values[key] = url.toString();
        saveEnv(file, values);
      }
      const url = new URL(values[key]);
      if (
        url.username !== login ||
        url.hostname !==
          "ep-autumn-feather-b1fk17te-pooler.c-5.eu-central-1.aws.neon.tech"
      )
        throw new Error("Saved runtime credential endpoint guard failed");
      // Password is generated hex and is used only in memory, never command arguments.
      if (!found) {
        const password = decodeURIComponent(url.password);
        if (!/^[0-9a-f]{64}$/.test(password))
          throw new Error("Unexpected generated password format");
        await admin.query(
          `CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`,
        );
      }
      await admin.query(
        `GRANT ${role} TO ${login} WITH INHERIT FALSE, SET TRUE, ADMIN FALSE`,
      );
    }
    const attributes = (
      await admin.query(
        "SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit FROM pg_roles WHERE rolname LIKE 'ktebli_membership_%' ORDER BY rolname",
      )
    ).rows;
    if (
      attributes.length !== 3 ||
      attributes.some(
        (r) =>
          r.rolsuper ||
          r.rolcreatedb ||
          r.rolcreaterole ||
          r.rolreplication ||
          r.rolbypassrls ||
          r.rolinherit,
      )
    )
      throw new Error("Login role privilege check failed");
    const memberships = (
      await admin.query(
        "SELECT member.rolname AS login, granted.rolname AS role, m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles granted ON granted.oid=m.roleid WHERE member.rolname LIKE 'ktebli_membership_%' ORDER BY member.rolname",
      )
    ).rows;
    if (
      memberships.length !== 3 ||
      memberships.some(
        (r) =>
          r.admin_option ||
          r.inherit_option ||
          !r.set_option ||
          !roles.some(([login, role]) => login === r.login && role === r.role),
      )
    )
      throw new Error("Login membership isolation check failed");
    report.roles = { attributes, memberships };
    report.schema = (
      await admin.query(
        "SELECT count(*)::int AS tables, count(*) FILTER (WHERE relrowsecurity AND relforcerowsecurity)::int AS forcedRlsTables FROM pg_class JOIN pg_namespace ON pg_namespace.oid=relnamespace WHERE nspname='membership' AND relkind='r'",
      )
    ).rows[0];
    report.migrationVersions = (
      await admin.query(
        "SELECT version FROM membership.migrations ORDER BY version",
      )
    ).rows.map((r) => r.version);
    report.schemaOwnerIsSeparate =
      (
        await admin.query(
          "SELECT count(*)::int AS count FROM pg_class JOIN pg_namespace ON pg_namespace.oid=relnamespace JOIN pg_roles ON pg_roles.oid=relowner WHERE nspname='membership' AND rolname LIKE 'ktebli_membership_%'",
        )
      ).rows[0].count === 0;
  } finally {
    await admin.end();
  }
  saveEnv(".env.local", local);
  saveEnv(".env.worker.local", worker);
  report.databaseSetup = "passed";
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  const auth = JSON.parse(
    neon([
      "neon-auth",
      "enable",
      ...scope,
      "--database-name",
      "neondb",
      "-o",
      "json",
    ]),
  );
  // The CLI enable response may contain internal credentials; retain none in reports.
  const candidates: string[] = [];
  function findUrls(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (
        typeof child === "string" &&
        /url|endpoint/i.test(key) &&
        child.startsWith("https://") &&
        child.includes("neonauth")
      )
        candidates.push(child);
      else findUrls(child);
    }
  }
  findUrls(auth);
  if (!candidates.length) {
    const status = JSON.parse(
      neon(["neon-auth", "status", ...scope, "-o", "json"]),
    );
    findUrls(status);
  }
  const baseUrl =
    candidates.find((url) => url.endsWith("/auth")) ?? candidates[0];
  if (!baseUrl)
    throw new Error(
      "Managed Auth provisioned; endpoint response could not be identified",
    );
  local.NEON_AUTH_BASE_URL = baseUrl;
  saveEnv(".env.local", local);
  neon([
    "neon-auth",
    "config",
    "email-password",
    "update",
    ...scope,
    "--enabled",
    "--require-email-verification",
    "--email-verification-method",
    "otp",
    "--send-verification-email-on-sign-up",
    "--send-verification-email-on-sign-in",
    "-o",
    "json",
  ]);
  const config = JSON.parse(
    neon([
      "neon-auth",
      "config",
      "email-password",
      "get",
      ...scope,
      "-o",
      "json",
    ]),
  );
  const safeConfig = Object.fromEntries(
    [
      "enabled",
      "email_verification_method",
      "require_email_verification",
      "auto_sign_in_after_verification",
      "send_verification_email_on_sign_up",
      "send_verification_email_on_sign_in",
      "disable_sign_up",
    ].map((key) => [key, config[key]]),
  );
  report.auth = {
    enabled: true,
    baseUrl,
    emailPasswordConfig: safeConfig,
    signupSigninAndEmailDeliveryVerified: false,
  };
  report.completedAt = new Date().toISOString();
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    "Neon branch, schema, dedicated roles and Managed Auth provisioned. Sanitized report saved.",
  );
}
run().catch((error) => {
  // Never render child-process stderr or database statements: both can contain secrets.
  report.failure = {
    name: error?.name ?? "Error",
    code: error?.code ?? null,
    phase: report.databaseSetup ? "Managed Auth" : "database setup",
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.error(
    "Provisioning stopped; sanitized phase and error code saved in report.",
  );
  process.exitCode = 1;
});
